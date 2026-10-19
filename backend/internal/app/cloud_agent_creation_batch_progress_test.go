package app

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func creationBatchStagePlan() []cloudAgentPlanItem {
	return []cloudAgentPlanItem{{ID: "visual", Title: "锁定视觉方案", Status: "done"}, {ID: "copy", Title: "规划文案", Status: "done"}, {ID: "generate", Title: "生成最终图片", Status: "doing"}}
}

func TestCreationBatchReviewPreservesStages(t *testing.T) {
	for _, commerce := range []bool{false, true} {
		state := cloudAgentRuntime{Request: creationAgentRequest(), Plan: creationBatchStagePlan()}
		before := append([]cloudAgentPlanItem(nil), state.Plan...)
		batch := &cloudAgentCommerceBatch{PlanID: "batch", Items: []cloudAgentCommerceBatchItem{{ItemID: "picture", Args: cloudAgentMediaArgs{Title: "图片标题"}}}}
		if commerce {
			plan := commerceFixturePlan()
			cloudAgentCommerceBatchPlanEvent(&state, "run", &plan, batch)
		} else {
			cloudAgentImageBatchPlanEvent(&state, "run", batch)
		}
		if !reflect.DeepEqual(state.Plan, before) || mustMarshal(state.Events[0].Payload["items"]) != mustMarshal(before) {
			t.Fatalf("commerce=%v replaced stages with image titles: %+v", commerce, state.Events[0].Payload)
		}
	}
}

func TestCommerceReviewVisibilityKeepsFullPlanWithoutInventingStages(t *testing.T) {
	for _, show := range []bool{false, true} {
		original := commerceFixturePlan()
		original.ShowImportantInfo = &show
		call := cloudAgentCall{}
		call.Function.Arguments = mustMarshal(original)
		req := creationAgentRequest()
		req.Attachments = []CloudAgentAttachment{{ResourceID: "product-1", StorageKey: "resource:product-1", Kind: "image", Role: "product"}}
		plan, err := cloudAgentParseCommercePlan(req, call)
		if err != nil {
			t.Fatal(err)
		}
		state := cloudAgentRuntime{Request: req}
		cloudAgentCommerceBatchPlanEvent(&state, "run", plan, nil)
		var payload map[string]any
		if err := json.Unmarshal([]byte(mustMarshal(state.Events[0].Payload)), &payload); err != nil {
			t.Fatal(err)
		}
		stored := payload["plan"].(map[string]any)
		if stored["showImportantInfo"] != show || stored["intent"] != original.Intent || len(stored["items"].([]any)) != len(original.Items) {
			t.Fatal("visibility discarded complete plan or model decision")
		}
		if items, ok := payload["items"].([]any); !ok || len(items) != 0 {
			t.Fatalf("plan-less review must use empty stages, not null or image titles: %#v", payload["items"])
		}
	}
}

func TestCommerceReviewVisibilityRequiresNewDecisionAndPreservesStoredPlan(t *testing.T) {
	found := false
	for _, tool := range compileCloudAgentTools(creationAgentRequest(), false) {
		function := tool["function"].(map[string]any)
		if function["name"] != "commerce_plan_submit" {
			continue
		}
		parameters := function["parameters"].(map[string]any)
		for _, key := range parameters["required"].([]string) {
			found = found || key == "showImportantInfo"
		}
	}
	if !found {
		t.Fatal("new model calls must explicitly decide whether important information is shown")
	}
	legacy := commerceFixturePlan()
	before := cloudAgentCommercePlanHash(&legacy)
	var restored cloudAgentCommercePlan
	if err := json.Unmarshal([]byte(mustMarshal(legacy)), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.ShowImportantInfo != nil || strings.Contains(mustMarshal(restored), "showImportantInfo") || cloudAgentCommercePlanHash(&restored) != before {
		t.Fatal("restoring old plans changed visibility or their frozen plan hash")
	}
}

func TestCreationBatchFailedStageRemainsPending(t *testing.T) {
	state := cloudAgentRuntime{Plan: creationBatchStagePlan()}
	batch := &cloudAgentCommerceBatch{PlanItemIDs: cloudAgentBatchActiveStages(&state)}
	cloudAgentBatchFinishStages(&state, "run", batch, false)
	if state.Plan[0].Status != "done" || state.Plan[1].Status != "done" || state.Plan[2].Status != "pending" {
		t.Fatalf("failed batch was marked complete or left spinning: %+v", state.Plan)
	}
}

func TestCreationBatchDoesNotCompleteOtherConcurrentStages(t *testing.T) {
	state := cloudAgentRuntime{Plan: []cloudAgentPlanItem{{ID: "image", Title: "生成图片", Status: "doing"}, {ID: "video", Title: "生成视频", Status: "doing"}}}
	before := append([]cloudAgentPlanItem(nil), state.Plan...)
	batch := &cloudAgentCommerceBatch{PlanItemIDs: cloudAgentBatchActiveStages(&state)}
	cloudAgentBatchFinishStages(&state, "run", batch, true)
	if !reflect.DeepEqual(state.Plan, before) {
		t.Fatalf("one batch completed an unrelated stage: %+v", state.Plan)
	}
}

func TestCreationBatchReportsOutOfOrderSuccessBeforeSlowFirstImage(t *testing.T) {
	for _, scenario := range []struct {
		commerce   bool
		permission string
	}{{false, "auto"}, {true, "auto"}, {false, "request_approval"}, {true, "request_approval"}} {
		commerce := scenario.commerce
		t.Run(map[bool]string{false: "generic", true: "commerce"}[commerce]+"/"+scenario.permission, func(t *testing.T) {
			var s *Service
			var db *gorm.DB
			var run *model.CloudAgentExecution
			var state cloudAgentRuntime
			if commerce {
				service, database, current, fresh := commerceImageRecoveryFixture(t, scenario.permission)
				s, db, run, state = service, database, current, fresh
			} else {
				service, database, runID, call := creationContextImageBatchFixture(t, scenario.permission)
				s, db = service, database
				run, state = agentInterjectionState(t, s, runID)
				state.Calls, state.CallIndex = []cloudAgentCall{call}, 0
				state.Plan = creationBatchStagePlan()
				if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
					return cloudAgentSave(current, &state)
				}); err != nil {
					t.Fatal(err)
				}
				run, state = agentInterjectionState(t, s, run.ID)
				if err := s.advanceCloudAgentTool(run, &state); err != nil {
					t.Fatal(err)
				}
				run, state = agentInterjectionState(t, s, run.ID)
				if scenario.permission == "request_approval" {
					if state.Approval == nil {
						t.Fatal("batch omitted requested approval")
					}
					if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, "approve", ""); err != nil {
						t.Fatal(err)
					}
					run, state = agentInterjectionState(t, s, run.ID)
				}
			}
			lastID := state.CommerceBatch.Items[len(state.CommerceBatch.Items)-1].TaskID
			task, err := s.repo.TaskForUser("user", lastID)
			if err != nil {
				t.Fatal(err)
			}
			task.Status, task.ResultJSON = model.TaskStatusSucceeded, `{"images":[]}`
			if err := db.Save(task).Error; err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
			defer cancel()
			woken, err := s.waitCloudAgentMediaTask(ctx, "user", run.ID, state.MediaTaskID)
			if err != nil || woken == nil || woken.ID != lastID {
				t.Fatalf("successful last image blocked behind first: task=%v err=%v", woken, err)
			}
			for i := 0; i < 2; i++ {
				if err := s.settleCloudAgentMedia("user", run.ID); err != nil {
					t.Fatal(err)
				}
			}
			_, fresh := agentInterjectionState(t, s, run.ID)
			completed := 0
			for _, event := range fresh.Events {
				if event.Type == "generation_task_completed" && stringValue(event.Payload["taskId"]) == lastID {
					completed++
				}
			}
			if completed != 1 || fresh.CommerceBatch == nil || fresh.MediaTaskID == "" {
				t.Fatalf("partial delivery must persist exactly once while other tasks continue: events=%d batch=%v wait=%s", completed, fresh.CommerceBatch != nil, fresh.MediaTaskID)
			}
			if !commerce && !reflect.DeepEqual(fresh.Plan, creationBatchStagePlan()) {
				t.Fatalf("one success completed or replaced the whole generation stage: %+v", fresh.Plan)
			}
			for _, entry := range fresh.CommerceBatch.Items {
				task, err := s.repo.TaskForUser("user", entry.TaskID)
				if err != nil {
					t.Fatal(err)
				}
				task.Status, task.ResultJSON = model.TaskStatusSucceeded, `{"images":[]}`
				if err := db.Save(task).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := s.settleCloudAgentMedia("user", run.ID); err != nil {
				t.Fatal(err)
			}
			_, fresh = agentInterjectionState(t, s, run.ID)
			if fresh.CommerceBatch != nil || !commerce && (len(fresh.Plan) != 3 || fresh.Plan[2].Status != "done") {
				t.Fatalf("successful batch did not complete its real stage: %+v", fresh.Plan)
			}
		})
	}
}
