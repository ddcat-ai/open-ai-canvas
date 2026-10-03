package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCommerceNewTurnRestoresOnlyExplicitOwnedFailedItemForRetry(t *testing.T) {
	s, db, run, state := pausedCommerceApprovalFixture(t)
	plan := state.CommercePlan
	taskID := cloudAgentCommerceTaskID("user", plan, "hero", state.Request.SessionID)
	input, _ := json.Marshal(map[string]any{"metadata": map[string]any{
		"agentRunId": run.ID, "commercePlanId": plan.PlanID, "commerceVersion": plan.Version,
		"commerceItemId": "hero", "commercePlanHash": cloudAgentCommercePlanHash(plan),
	}})
	if err := db.Create(&model.Task{ID: taskID, UserID: "user", Type: "canvas_video", Status: model.TaskStatusFailed, InputJSON: string(input)}).Error; err != nil {
		t.Fatal(err)
	}
	call := cloudAgentCall{ID: "new-turn-retry"}
	call.Function.Name = "generate_media"
	raw, _ := json.Marshal(map[string]any{"mode": "video", "commercePlanId": plan.PlanID, "commerceItemId": "hero", "retryFailedTaskId": taskID})
	call.Function.Arguments = string(raw)
	for _, scenario := range []string{"valid", "other-user", "other-session", "removed-reference", "successful-task"} {
		t.Run(scenario, func(t *testing.T) {
			fresh := cloudAgentRuntime{Request: state.Request}
			userID := "user"
			if scenario == "other-user" {
				userID = "other"
			}
			if scenario == "other-session" {
				fresh.Request.SessionID = "another-session"
			}
			if scenario == "removed-reference" {
				fresh.Request.Attachments = nil
			}
			if scenario == "successful-task" {
				if err := db.Model(&model.Task{}).Where("id = ?", taskID).Update("status", model.TaskStatusSucceeded).Error; err != nil {
					t.Fatal(err)
				}
			}
			compiled, identity, err := s.cloudAgentResolvedMediaCall(userID, &fresh, call)
			if scenario != "valid" {
				if err == nil || fresh.CommercePlan != nil {
					t.Fatalf("invalid retry restored old executable plan: %v", err)
				}
				return
			}
			if err != nil || identity.TaskID != cloudAgentCommerceRetryTaskID("user", taskID) || fresh.CommercePlan == nil || !strings.Contains(compiled.Function.Arguments, plan.Items[0].Prompt) {
				t.Fatalf("explicit failed retry lost its reviewed plan: %v %+v", err, identity)
			}
			if len(fresh.Plan) != 0 || len(fresh.Events) != 0 {
				t.Fatal("retry restoration exposed the previous full execution plan")
			}
		})
	}
}

func commerceRetryCall(t *testing.T, s *Service, runID string, plan cloudAgentCommercePlan, itemID, failedTaskID string) (*model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	run, err := s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID, state.MediaTaskID, state.Approval = "", "", nil
	state.CallIndex = 0
	state.Step++
	state.CommercePlan = &plan
	arguments := map[string]any{"mode": "video", "commercePlanId": plan.PlanID, "commerceItemId": itemID}
	if failedTaskID != "" {
		arguments["retryFailedTaskId"] = failedTaskID
	}
	raw, _ := json.Marshal(arguments)
	call := cloudAgentCall{ID: "retry-test-" + itemID + failedTaskID}
	call.Function.Name, call.Function.Arguments = "generate_media", string(raw)
	state.Calls = []cloudAgentCall{call}
	if err := s.repo.MutateCloudAgent("user", runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		current.Status = "running"
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, err = s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	return run, state
}

func TestCommerceFailedItemRetryNeedsNewApprovalAndKeepsSuccessfulDependency(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	choice := CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", Size: "9:16", DurationSeconds: 6}
	run, state := creationMediaRun(t, s, "commerce-retry-approval", cloudAgentMediaArgs{Mode: "video", Prompt: "placeholder"}, choice, "auto")
	state.Request.Budget.MaxCredits = 10
	state.Request.Budget.MaxGenerationTasks = 4
	state.Request.Budget.MaxVideoSeconds = 30
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].Type, plan.Items[0].Operation = "video", "image_to_video"
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	plan.Items[0].Prompt = "Product rotating in studio"
	detail := plan.Items[0]
	detail.ID, detail.Title = "detail", "细节视频"
	detail.Dependencies = []string{"hero"}
	final := plan.Items[0]
	final.ID, final.Title = "final", "收尾视频"
	final.Dependencies = []string{"detail"}
	plan.Items = append(plan.Items, detail, final)
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}

	for _, item := range []struct {
		id     string
		status model.TaskStatus
	}{{"hero", model.TaskStatusSucceeded}, {"detail", model.TaskStatusFailed}} {
		current, currentState := commerceRetryCall(t, s, run.ID, plan, item.id, "")
		if err := s.advanceCloudAgentTool(current, &currentState); err != nil {
			t.Fatal(err)
		}
		taskID := cloudAgentCommerceTaskID("user", &plan, item.id, currentState.Request.SessionID)
		if _, err := s.repo.TaskForUser("user", taskID); err != nil {
			t.Fatalf("%s task missing: %v", item.id, err)
		}
		if err := db.Model(&model.Task{}).Where("id = ?", taskID).Update("status", item.status).Error; err != nil {
			t.Fatal(err)
		}
		if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
			t.Fatal(err)
		}
	}
	stored, _ := s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(stored)
	heroID := cloudAgentCommerceTaskID("user", &plan, "hero", state.Request.SessionID)
	failedID := cloudAgentCommerceTaskID("user", &plan, "detail", state.Request.SessionID)
	if err := cloudAgentCommerceValidateRetryTarget(s.repo, "user", &state, "hero", heroID); err == nil {
		t.Fatal("successful task was accepted as retry source")
	}
	if err := cloudAgentCommerceValidateRetryTarget(s.repo, "user", &state, "hero", failedID); err == nil {
		t.Fatal("another item was accepted as retry source")
	}
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "final"); err == nil {
		t.Fatal("failed detail unexpectedly released final dependency")
	}

	current, currentState := commerceRetryCall(t, s, run.ID, plan, "detail", failedID)
	if err := s.advanceCloudAgentTool(current, &currentState); err != nil {
		t.Fatal(err)
	}
	view, err := s.CloudAgentRun("user", run.ID)
	if err != nil || view.Status != "waiting_approval" || view.Approval == nil {
		t.Fatalf("auto retry must request a new approval: %+v %v", view, err)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 2 {
		t.Fatalf("retry submitted before approval: %d tasks", count)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, view.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 3 {
		t.Fatalf("retry did not submit exactly one task: %d", count)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, view.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 3 {
		t.Fatalf("duplicate approval submitted another task: %d", count)
	}
	stored, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(stored)
	retryID := state.MediaTaskID
	if retryID == "" || retryID == failedID {
		t.Fatalf("new retry task missing: %q", retryID)
	}
	if retryID != cloudAgentCommerceRetryTaskID("user", failedID) {
		t.Fatalf("retry task ID is not stable: %q", retryID)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", retryID).Update("status", model.TaskStatusSucceeded).Error; err != nil {
		t.Fatal(err)
	}
	for _, taskID := range []string{heroID, failedID, retryID} {
		task, err := s.repo.TaskForUser("user", taskID)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.Task{}).Where("id = ?", taskID).Update("input_json", publicTaskInputJSON(task.InputJSON)).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	stored, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(stored)
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "final"); err != nil {
		t.Fatalf("successful retry did not release final dependency: %v", err)
	}
	hero, _ := s.repo.TaskForUser("user", heroID)
	failed, _ := s.repo.TaskForUser("user", failedID)
	if hero.Status != model.TaskStatusSucceeded || failed.Status != model.TaskStatusFailed {
		t.Fatalf("prior successful/failed records changed: hero=%s failed=%s", hero.Status, failed.Status)
	}
	current, currentState = commerceRetryCall(t, s, run.ID, plan, "detail", failedID)
	if err := s.advanceCloudAgentTool(current, &currentState); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 3 {
		t.Fatalf("same retry call created duplicate task: %d", count)
	}
}
