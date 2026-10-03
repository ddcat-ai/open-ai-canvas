package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func commerceImageRecoveryFixture(t *testing.T, permissions ...string) (*Service, *gorm.DB, *model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "image-test")
	for _, row := range []any{
		&model.ModelChannel{ID: "image-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "图片渠道"},
		&model.ChannelModel{ID: "image-cm", ChannelID: "image-channel", ModelKey: "image-test", DisplayName: "图片模型", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := creationAgentRequest()
	req.PermissionMode, req.IdempotencyKey = "auto", "commerce-image-recovery"
	if len(permissions) > 0 {
		req.PermissionMode = permissions[0]
	}
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 10, 10
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "商品图"}}
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "image-channel", ChannelModelKey: "image-test"}, ParameterMode: "manual", Size: "1024x1024"}}
	plan := commerceFixturePlan()
	plan.StyleBible = "Soft blue studio, gentle daylight, preserve the product jar"
	plan.StyleLock = &cloudAgentCommerceStyleLock{FontFamily: "Inter", Typography: "Large heading, small body", HeadingColor: "#224466", BodyColor: "#334455", AccentColor: "#66AACC", BackgroundColor: "#EEF6FA", IconStyle: "Thin blue line icons"}
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	plan.Items[0].Specs = map[string]any{"size": "1024x1024"}
	for _, id := range []string{"scene", "steps"} {
		item := plan.Items[0]
		item.ID, item.Title, item.Prompt = id, id, "Original "+id+" scene direction"
		plan.Items = append(plan.Items, item)
	}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, _ := s.repo.CloudAgent("user", root.ID)
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = ""
	raw, _ := json.Marshal(plan)
	call := cloudAgentCall{ID: "image-batch"}
	call.Function.Name, call.Function.Arguments = "commerce_plan_submit", string(raw)
	state.Calls = []cloudAgentCall{call}
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	if req.PermissionMode == "request_approval" {
		view, err := s.CloudAgentRun("user", run.ID)
		if err != nil || view.Approval == nil {
			t.Fatalf("original batch approval missing: %v", err)
		}
		if err := s.DecideCloudAgentApproval("user", run.ID, view.Approval.ID, "approve", ""); err != nil {
			t.Fatal(err)
		}
		if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
			t.Fatal(err)
		}
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, err = cloudAgentDecode(run)
	if err != nil || state.CommerceBatch == nil || state.MediaTaskID == "" {
		t.Fatalf("missing running batch: %v %+v", err, state.CommerceBatch)
	}
	return s, db, run, state
}

func failCommerceImage(t *testing.T, s *Service, db *gorm.DB, taskID string) {
	t.Helper()
	task, err := s.repo.TaskForUser("user", taskID)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "prompt may violate our content policies"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RouteAttempt{ID: taskID + "-failed-route", TaskID: taskID, RouteRun: task.RouteRun, Status: "failed", DispatchState: "rejected_no_job", FailureMessage: "prompt may violate our content policies"}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestCommerceImageFailureReachesAgentWhileOtherImagesAreStillRunning(t *testing.T) {
	s, db, run, state := commerceImageRecoveryFixture(t)
	sceneID := cloudAgentCommerceTaskID("user", state.CommercePlan, "scene", state.Request.SessionID)
	failCommerceImage(t, s, db, sceneID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.CloudAgent("user", run.ID)
	fresh, _ := cloudAgentDecode(stored)
	content, ok := cloudAgentToolMessage(&fresh, "image-batch")
	if !ok || !strings.Contains(content, sceneID) || !strings.Contains(content, "rewrite_prompt") {
		t.Fatalf("failed image must reach Agent before hero ends: %s", content)
	}
	if fresh.MediaTaskID != "" || fresh.CommerceBatch == nil || stored.Status != "running" {
		t.Fatalf("batch must retain running work while Agent repairs: media=%s batch=%+v status=%s", fresh.MediaTaskID, fresh.CommerceBatch, stored.Status)
	}
	hero, _ := s.repo.TaskForUser("user", cloudAgentCommerceTaskID("user", fresh.CommercePlan, "hero", fresh.Request.SessionID))
	if hero.Status != model.TaskStatusQueued {
		t.Fatalf("other image changed: %s", hero.Status)
	}
}

func TestCommerceImageRetryPromptPreservesPlanStyleAndOnlyChangesFailedDirection(t *testing.T) {
	s, db, _, state := commerceImageRecoveryFixture(t)
	id := cloudAgentCommerceTaskID("user", state.CommercePlan, "scene", state.Request.SessionID)
	failCommerceImage(t, s, db, id)
	originalHash := cloudAgentCommercePlanHash(state.CommercePlan)
	raw, _ := json.Marshal(map[string]any{"mode": "image", "commercePlanId": state.CommercePlan.PlanID, "commerceItemId": "scene", "retryFailedTaskId": id, "retryPrompt": "Product jar beside a soft blue folded towel, neutral cosmetic still life"})
	call := cloudAgentCall{ID: "repair-image"}
	call.Function.Name, call.Function.Arguments = "generate_media", string(raw)
	compiled, _, err := s.cloudAgentResolvedMediaCall("user", &state, call)
	if err != nil {
		t.Fatal(err)
	}
	var args cloudAgentMediaArgs
	json.Unmarshal([]byte(compiled.Function.Arguments), &args)
	for _, phrase := range []string{"neutral cosmetic still life", state.CommercePlan.StyleBible, cloudAgentCommerceStyleLockPrompt(state.CommercePlan.StyleLock), state.CommercePlan.Items[1].TargetCopy, "1024x1024"} {
		if !strings.Contains(args.Prompt, phrase) {
			t.Fatalf("retry lost repaired direction or immutable contract %q: %s", phrase, args.Prompt)
		}
	}
	if strings.Contains(args.Prompt, state.CommercePlan.Items[1].Prompt) || cloudAgentCommercePlanHash(state.CommercePlan) != originalHash {
		t.Fatal("retry retained the rejected direction or mutated the shared plan")
	}
	if len(args.AttachmentResourceIDs) != 1 || args.AttachmentResourceIDs[0] != "ref-one" {
		t.Fatal("retry changed product references")
	}
}

func installCommerceRecoveryCall(t *testing.T, s *Service, runID, callID, name string, arguments any) (*model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	run, _ := s.repo.CloudAgent("user", runID)
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(arguments)
	call := cloudAgentCall{ID: callID}
	call.Function.Name, call.Function.Arguments = name, string(raw)
	state.Calls, state.CallIndex = []cloudAgentCall{call}, 0
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", runID)
	return run, state
}

func TestCommerceImageRecoveryIsImmediateAsyncApprovedAndIdempotent(t *testing.T) {
	for _, permission := range []string{"auto", "request_approval"} {
		t.Run(permission, func(t *testing.T) {
			s, db, run, state := commerceImageRecoveryFixture(t, permission)
			failedID := cloudAgentCommerceTaskID("user", state.CommercePlan, "scene", state.Request.SessionID)
			failCommerceImage(t, s, db, failedID)
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			woken, err := s.waitCloudAgentMediaTask(ctx, "user", run.ID, state.MediaTaskID)
			if err != nil || woken == nil || woken.ID != failedID {
				t.Fatalf("failure did not wake waiting Agent: %+v %v", woken, err)
			}
			if err := s.advanceCloudAgentTool(run, &state); err != nil {
				t.Fatal(err)
			}
			arguments := map[string]any{"mode": "image", "commercePlanId": state.CommercePlan.PlanID, "commerceItemId": "scene", "retryFailedTaskId": failedID, "retryPrompt": "Neutral product still life with a soft blue towel and gentle daylight"}
			current, fresh := installCommerceRecoveryCall(t, s, run.ID, "repair-scene", "generate_media", arguments)
			if err := s.advanceCloudAgentTool(current, &fresh); err != nil {
				t.Fatal(err)
			}
			stored, _ := s.repo.CloudAgent("user", run.ID)
			fresh, _ = cloudAgentDecode(stored)
			retryID := cloudAgentCommerceRetryTaskID("user", failedID)
			retried, err := s.repo.TaskForUser("user", retryID)
			if err != nil || !strings.Contains(retried.Prompt, "Neutral product still life") || fresh.Approval != nil || stored.Status != "running" || fresh.MediaTaskID != "" {
				t.Fatalf("repair must submit silently without blocking: task=%+v err=%v approval=%+v media=%s status=%s", retried, err, fresh.Approval, fresh.MediaTaskID, stored.Status)
			}
			content, ok := cloudAgentToolMessage(&fresh, "repair-scene")
			if !ok || !strings.Contains(content, retryID) || !strings.Contains(content, "queued") {
				t.Fatalf("async repair receipt missing: %s", content)
			}
			var count int64
			db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&count)
			if count != 4 {
				t.Fatalf("expected 3 original images and 1 failed-item repair, got %d", count)
			}
			current, fresh = installCommerceRecoveryCall(t, s, run.ID, "repair-scene-replay", "generate_media", arguments)
			if err := s.advanceCloudAgentTool(current, &fresh); err != nil {
				t.Fatal(err)
			}
			db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&count)
			if count != 4 {
				t.Fatal("replay submitted duplicate repair")
			}
			arguments["retryPrompt"] = "A different scene after submission"
			current, fresh = installCommerceRecoveryCall(t, s, run.ID, "changed-replay", "generate_media", arguments)
			if err := s.advanceCloudAgentTool(current, &fresh); err != nil {
				t.Fatal(err)
			}
			stored, _ = s.repo.CloudAgent("user", run.ID)
			fresh, _ = cloudAgentDecode(stored)
			content, _ = cloudAgentToolMessage(&fresh, "changed-replay")
			if !cloudAgentToolContentIsError(content) {
				t.Fatalf("changed retry input was silently reused: %s", content)
			}
			for _, id := range []string{"hero", "steps"} {
				task, _ := s.repo.TaskForUser("user", cloudAgentCommerceTaskID("user", state.CommercePlan, id, state.Request.SessionID))
				if task.Status != model.TaskStatusQueued {
					t.Fatalf("unrelated in-flight item changed: %s", id)
				}
			}
		})
	}
}

func TestCommerceImagesCannotCompleteBeforeRemainingImagesSettle(t *testing.T) {
	s, db, run, state := commerceImageRecoveryFixture(t)
	id := cloudAgentCommerceTaskID("user", state.CommercePlan, "scene", state.Request.SessionID)
	failCommerceImage(t, s, db, id)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	if err := s.completeCloudAgentPiRun("user", run.ID, 0); !errors.Is(err, errCloudAgentCommercePending) {
		t.Fatalf("premature final answer was not deferred: %v", err)
	}
	stored, _ := s.repo.CloudAgent("user", run.ID)
	fresh, _ := cloudAgentDecode(stored)
	if stored.Status != "running" || fresh.PiResumePrompt == "" {
		t.Fatal("pending images lost the continuation")
	}
}

func TestCommerceImageRepeatedRejectionContinuesUntilTaskBudgetAndReturnsOneFinalBatch(t *testing.T) {
	s, db, run, state := commerceImageRecoveryFixture(t)
	const repairs = 3
	state.Request.Budget.MaxGenerationTasks = len(state.CommerceBatch.Items) + repairs
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	for _, itemID := range []string{"hero", "steps"} {
		id := cloudAgentCommerceTaskID("user", state.CommercePlan, itemID, state.Request.SessionID)
		if err := db.Model(&model.Task{}).Where("id = ?", id).Update("status", model.TaskStatusSucceeded).Error; err != nil {
			t.Fatal(err)
		}
	}
	failedID := cloudAgentCommerceTaskID("user", state.CommercePlan, "scene", state.Request.SessionID)
	failCommerceImage(t, s, db, failedID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < repairs; attempt++ {
		arguments := map[string]any{"mode": "image", "commercePlanId": state.CommercePlan.PlanID, "commerceItemId": "scene", "retryFailedTaskId": failedID, "retryPrompt": strings.Repeat("Neutral studio still life. ", attempt+1)}
		current, fresh := installCommerceRecoveryCall(t, s, run.ID, "repair-"+failedID, "generate_media", arguments)
		if err := s.advanceCloudAgentTool(current, &fresh); err != nil {
			t.Fatal(err)
		}
		failedID = cloudAgentCommerceRetryTaskID("user", failedID)
		failCommerceImage(t, s, db, failedID)
		callID := "wait-" + failedID
		current, fresh = installCommerceRecoveryCall(t, s, run.ID, callID, "commerce_plan_wait", map[string]any{"commercePlanId": state.CommercePlan.PlanID})
		if err := s.advanceCloudAgentTool(current, &fresh); err != nil {
			t.Fatal(err)
		}
		stored, _ := s.repo.CloudAgent("user", run.ID)
		fresh, _ = cloudAgentDecode(stored)
		content, ok := cloudAgentToolMessage(&fresh, callID)
		var result struct {
			Complete    bool             `json:"complete"`
			FailedItems []map[string]any `json:"failedItems"`
		}
		if !ok || json.Unmarshal([]byte(content), &result) != nil || len(result.FailedItems) != 1 || result.FailedItems[0]["retryFailedTaskId"] != failedID {
			t.Fatalf("final/recovery result duplicated old failures: %s", content)
		}
		if attempt+1 == repairs {
			if !result.Complete || fresh.CommerceBatch != nil || result.FailedItems[0]["action"] != "report_at_end" {
				t.Fatalf("task budget did not settle the batch: %s", content)
			}
		} else if result.Complete || result.FailedItems[0]["action"] != "rewrite_prompt" {
			t.Fatalf("rejection with remaining budget must trigger a new prompt plan: %s", content)
		}
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&count)
	if count != int64(3+repairs) {
		t.Fatalf("unexpected generation count: %d", count)
	}
}

func TestCommerceImageUnknownSubmissionCancellationAndBudgetDoNotAutorepair(t *testing.T) {
	for _, scenario := range []string{"unknown_submission", "delivery_failure", "cancelled", "budget_exhausted"} {
		t.Run(scenario, func(t *testing.T) {
			s, db, run, state := commerceImageRecoveryFixture(t)
			id := cloudAgentCommerceTaskID("user", state.CommercePlan, "scene", state.Request.SessionID)
			failCommerceImage(t, s, db, id)
			switch scenario {
			case "unknown_submission":
				db.Model(&model.RouteAttempt{}).Where("task_id = ?", id).Update("dispatch_state", "submission_unknown")
			case "delivery_failure":
				db.Model(&model.RouteAttempt{}).Where("task_id = ?", id).Updates(map[string]any{"dispatch_state": "accepted", "status": "succeeded"})
			case "cancelled":
				db.Model(&model.Task{}).Where("id = ?", id).Update("status", model.TaskStatusCancelled)
			case "budget_exhausted":
				state.Request.Budget.MaxCredits = 0.000001
			}
			task, _ := s.repo.TaskForUser("user", id)
			allowed, err := s.cloudAgentCommerceImageCanRepair(run, &state, task)
			if err != nil || allowed {
				t.Fatalf("%s must not regenerate: allowed=%v err=%v", scenario, allowed, err)
			}
			if scenario == "cancelled" {
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				if _, err := s.waitCloudAgentMediaTask(ctx, "user", run.ID, state.MediaTaskID); !errors.Is(err, context.Canceled) {
					t.Fatalf("cancelled wait continued: %v", err)
				}
			}
		})
	}
}
