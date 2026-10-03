package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func commerceFixturePlan() cloudAgentCommercePlan {
	return cloudAgentCommercePlan{
		PlanVersion: "2", PlanID: "plan-1", Version: 1, Intent: "英国站杯子套图", Platform: "amazon", Site: "UK", Language: "en-GB",
		ProductFacts: []cloudAgentCommerceFact{{ID: "steel", Claim: "不锈钢杯身", SourceIDs: []string{"product-1"}}},
		Items:        []cloudAgentCommerceItem{{ID: "hero", Type: "image", Purpose: "hero", Title: "主图", Prompt: "Product on a plain background", TargetCopy: "Stainless steel body", ChineseReviewCopy: "不锈钢杯身", FactIDs: []string{"steel"}, AttachmentResourceIDs: []string{"product-1"}}},
	}
}

func TestCommercePlanUsesCreationAgentToolPathWithoutCharge(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	req := creationAgentRequest()
	req.PermissionMode = "read_only"
	req.IdempotencyKey = "commerce-read-only-plan"
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "商品图"}}
	plan := commerceFixturePlan()
	plan.StyleBible = "Keep the blue product shape across the set"
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = ""
	state.Calls = []cloudAgentCall{{ID: "commerce-plan-call"}}
	state.Calls[0].Function.Name = "commerce_plan_submit"
	raw, _ := json.Marshal(plan)
	state.Calls[0].Function.Arguments = string(raw)
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err = cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	if state.CommercePlan == nil || state.CommercePlan.PlanID != plan.PlanID {
		t.Fatalf("commerce plan not persisted: %+v", state.CommercePlan)
	}
	found := false
	for _, event := range state.Events {
		if event.Type == "plan_updated" {
			found = true
			full, ok := event.Payload["plan"].(map[string]any)
			if !ok || full["intent"] != plan.Intent || full["styleBible"] != plan.StyleBible {
				t.Fatalf("plan event lost review summary: %#v", event.Payload)
			}
			refs, ok := event.Payload["references"].([]any)
			if !ok || len(refs) != 1 || refs[0].(map[string]any)["role"] != "product" {
				t.Fatalf("plan event lost active reference role: %#v", event.Payload)
			}
		}
	}
	if !found {
		t.Fatal("plan_updated event missing")
	}
	var count int64
	db.Model(&model.Task{}).Where("type IN ?", []string{"canvas_image", "canvas_video"}).Count(&count)
	if count != 0 {
		t.Fatalf("read_only submitted %d media tasks", count)
	}
}

func TestCommerceItemUsesExistingMediaApprovalAndStableTask(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	req := creationAgentRequest()
	req.PermissionMode = "request_approval"
	req.IdempotencyKey = "commerce-media-first"
	req.Budget.MaxCredits = 10
	req.Budget.MaxGenerationTasks = 2
	req.Budget.MaxVideoSeconds = 24
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "商品图"}}
	req.MediaSettings = &CloudAgentCreationMedia{Video: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", Size: "9:16", DurationSeconds: 6}}
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].Type = "video"
	plan.Items[0].Operation = "image_to_video"
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	plan.Items[0].Prompt = "Product rotates under studio lighting"
	dependent := plan.Items[0]
	dependent.ID = "detail"
	dependent.Title = "细节视频"
	dependent.Dependencies = []string{"hero"}
	plan.Items = append(plan.Items, dependent)
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = ""
	state.CommercePlan = &plan
	state.Calls = []cloudAgentCall{{ID: "commerce-media"}}
	state.Calls[0].Function.Name = "generate_media"
	state.Calls[0].Function.Arguments = `{"mode":"video","prompt":"ignore arbitrary caller prompt","attachmentResourceIds":["private"],"commercePlanId":"plan-1","commerceItemId":"hero"}`
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	view, err := s.CloudAgentRun("user", run.ID)
	if err != nil || view.Status != "waiting_approval" || view.Approval == nil {
		t.Fatalf("missing media approval: %+v %v", view, err)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("commerce media submitted before approval")
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, view.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	taskID := cloudAgentCommerceTaskID("user", &plan, "hero", req.SessionID)
	// The service fills sessionId at run creation; use the durable run identity.
	storedRun, _ := s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(storedRun)
	taskID = cloudAgentCommerceTaskID("user", &plan, "hero", state.Request.SessionID)
	task, err := s.repo.TaskForUser("user", taskID)
	if err != nil {
		t.Fatalf("stable commerce task missing: %v", err)
	}
	var input struct {
		Prompt   string         `json:"prompt"`
		Metadata map[string]any `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(input.Prompt, "不锈钢杯身") || !strings.Contains(input.Prompt, "Stainless steel body") || input.Metadata["commerceItemId"] != "hero" {
		t.Fatalf("incorrect submitted prompt or receipt: %+v", input)
	}
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "detail"); err == nil {
		t.Fatal("dependent item admitted before anchor success")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("status", model.TaskStatusSucceeded).Error; err != nil {
		t.Fatal(err)
	}
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &state, "detail"); err != nil {
		t.Fatalf("completed anchor did not release dependency: %v", err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatalf("expected one media task, got %d", count)
	}
	// Simulate an interrupted tool receipt: task exists, but the replayed model
	// call reaches admission again. It must recover that exact task ID.
	var replayErr error
	for attempt := 0; attempt < 5; attempt++ {
		storedRun, replayErr = s.repo.CloudAgent("user", run.ID)
		if replayErr != nil {
			t.Fatal(replayErr)
		}
		state, replayErr = cloudAgentDecode(storedRun)
		if replayErr != nil {
			t.Fatal(replayErr)
		}
		state.MediaTaskID = ""
		state.Approval = nil
		state.CallIndex = 0
		state.Calls = []cloudAgentCall{{ID: "commerce-media-replay"}}
		state.Calls[0].Function.Name = "generate_media"
		state.Calls[0].Function.Arguments = `{"mode":"video","commercePlanId":"plan-1","commerceItemId":"hero"}`
		replayErr = s.repo.MutateCloudAgent("user", run.ID, storedRun.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			current.Status = "running"
			return cloudAgentSave(current, &state)
		})
		if replayErr == nil {
			break
		}
	}
	if replayErr != nil {
		t.Fatal(replayErr)
	}
	storedRun, _ = s.repo.CloudAgent("user", run.ID)
	if err := s.advanceCloudAgentTool(storedRun, &state); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatalf("replay charged a second media task: %d", count)
	}
	storedRun, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(storedRun)
	reused := false
	for _, event := range state.Events {
		reused = reused || event.Type == "generation_task_reused"
	}
	if !reused {
		t.Fatal("existing task was not returned on tool replay")
	}
	// A different planned item is admitted independently. Its failure must not
	// erase the successful anchor task or turn the batch into one retry.
	var secondErr error
	for attempt := 0; attempt < 5; attempt++ {
		storedRun, secondErr = s.repo.CloudAgent("user", run.ID)
		if secondErr != nil {
			t.Fatal(secondErr)
		}
		state, secondErr = cloudAgentDecode(storedRun)
		if secondErr != nil {
			t.Fatal(secondErr)
		}
		state.MediaTaskID, state.Approval, state.CallIndex = "", nil, 0
		state.Step++
		state.Calls = []cloudAgentCall{{ID: "commerce-second-item"}}
		state.Calls[0].Function.Name = "generate_media"
		state.Calls[0].Function.Arguments = `{"mode":"video","commercePlanId":"plan-1","commerceItemId":"detail"}`
		secondErr = s.repo.MutateCloudAgent("user", run.ID, storedRun.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			current.Status = "running"
			return cloudAgentSave(current, &state)
		})
		if secondErr == nil {
			break
		}
	}
	if secondErr != nil {
		t.Fatal(secondErr)
	}
	storedRun, _ = s.repo.CloudAgent("user", run.ID)
	if err := s.advanceCloudAgentTool(storedRun, &state); err != nil {
		t.Fatal(err)
	}
	view, err = s.CloudAgentRun("user", run.ID)
	if err != nil || view.Approval == nil {
		t.Fatalf("dependent item did not enter approval: %+v %v", view, err)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, view.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	secondID := cloudAgentCommerceTaskID("user", &plan, "detail", state.Request.SessionID)
	if _, err := s.repo.TaskForUser("user", secondID); err != nil {
		current, _ := s.repo.CloudAgent("user", run.ID)
		currentState, _ := cloudAgentDecode(current)
		t.Fatalf("dependent task not admitted: task=%s runStatus=%s mediaTask=%s events=%+v err=%v", secondID, current.Status, currentState.MediaTaskID, currentState.Events, err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", secondID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "isolated fixture failure"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	firstTask, err := s.repo.TaskForUser("user", taskID)
	if err != nil || firstTask.Status != model.TaskStatusSucceeded {
		t.Fatalf("successful item lost after sibling failure: %+v %v", firstTask, err)
	}
	secondTask, err := s.repo.TaskForUser("user", secondID)
	if err != nil || secondTask.Status != model.TaskStatusFailed {
		t.Fatalf("failed item status lost: %+v %v", secondTask, err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 2 {
		t.Fatalf("partial batch expected exactly two tasks, got %d", count)
	}
}

func commerceFixtureRequest() CloudAgentRequest {
	return CloudAgentRequest{Surface: "creation", Attachments: []CloudAgentAttachment{{ResourceID: "product-1", StorageKey: "resource:product-1", Kind: "image", Role: "product", Name: "商品"}, {ResourceID: "competitor-1", StorageKey: "resource:competitor-1", Kind: "image", Role: "competitor", Name: "竞品"}}}
}

func TestCommercePlanRejectsCompetitorFactsAndUnknownReferences(t *testing.T) {
	req := commerceFixtureRequest()
	plan := commerceFixturePlan()
	if err := validateCloudAgentCommercePlan(req, &plan); err != nil {
		t.Fatal(err)
	}
	plan.ProductFacts[0].SourceIDs = []string{"competitor-1"}
	if err := validateCloudAgentCommercePlan(req, &plan); err == nil || !strings.Contains(err.Error(), "竞品") {
		t.Fatalf("competitor fact accepted: %v", err)
	}
	plan = commerceFixturePlan()
	plan.Items[0].AttachmentResourceIDs = []string{"not-owned"}
	if err := validateCloudAgentCommercePlan(req, &plan); err == nil {
		t.Fatal("unknown reference accepted")
	}
	plan = commerceFixturePlan()
	plan.Items[0].Dependencies = []string{"missing"}
	if err := validateCloudAgentCommercePlan(req, &plan); err == nil {
		t.Fatal("unknown dependency accepted")
	}
}

func TestCommercePlanAcceptsLiteralUserSuppliedProductFact(t *testing.T) {
	req := commerceFixtureRequest()
	req.Prompt = "这是一只不锈钢杯身的保温杯，请做英国站商品图"
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"user:prompt"}
	if err := validateCloudAgentCommercePlan(req, &plan); err != nil {
		t.Fatalf("literal user fact rejected: %v", err)
	}
	plan.ProductFacts[0].Claim = "已获食品级认证"
	if err := validateCloudAgentCommercePlan(req, &plan); err == nil {
		t.Fatal("fabricated user fact accepted")
	}
}

func TestCommerceMediaCallKeepsChineseReviewOutOfPrompt(t *testing.T) {
	plan := commerceFixturePlan()
	call := cloudAgentCall{ID: "tool-1"}
	call.Function.Name = "generate_media"
	call.Function.Arguments = `{"mode":"image","prompt":"ignore me","attachmentResourceIds":["competitor-1"],"commercePlanId":"plan-1","commerceItemId":"hero"}`
	compiled, err := cloudAgentCommerceMediaCall(&plan, call)
	if err != nil {
		t.Fatal(err)
	}
	var args cloudAgentMediaArgs
	if err := json.Unmarshal([]byte(compiled.Function.Arguments), &args); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(args.Prompt, "不锈钢杯身") || !strings.Contains(args.Prompt, "Stainless steel body") || len(args.AttachmentResourceIDs) != 1 || args.AttachmentResourceIDs[0] != "product-1" {
		t.Fatalf("unsafe compiled media arguments: %+v", args)
	}
}

func TestCommerceVideoReplacementRequiresDeclaredCapability(t *testing.T) {
	req := commerceFixtureRequest()
	req.Attachments = append(req.Attachments, CloudAgentAttachment{ResourceID: "video-1", StorageKey: "resource:video-1", Kind: "video", Role: "source", Name: "源视频"}, CloudAgentAttachment{ResourceID: "person-1", StorageKey: "resource:person-1", Kind: "image", Role: "person", Name: "人物"})
	plan := commerceFixturePlan()
	plan.Items[0].Type = "video"
	plan.Items[0].Operation = "replace_person"
	plan.Items[0].AttachmentResourceIDs = []string{"video-1", "person-1"}
	if err := validateCloudAgentCommercePlan(req, &plan); err == nil || !strings.Contains(err.Error(), "能力") {
		t.Fatalf("unsupported replacement accepted: %v", err)
	}
	plan.Items[0].Operation = ""
	if err := validateCloudAgentCommercePlan(req, &plan); err == nil || !strings.Contains(err.Error(), "能力") {
		t.Fatalf("implicit unsupported replacement accepted: %v", err)
	}
}

func TestCommerceImageToVideoRequiresRealImageReference(t *testing.T) {
	plan := commerceFixturePlan()
	plan.Items[0].Type = "video"
	plan.Items[0].Operation = "image_to_video"
	plan.Items[0].AttachmentResourceIDs = nil
	if err := validateCloudAgentCommercePlan(commerceFixtureRequest(), &plan); err == nil {
		t.Fatal("image-to-video without image reference accepted")
	}
}

func TestCommerceImageItemDoesNotMultiplyManualCount(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	for _, planned := range []bool{false, true} {
		req := creationAgentRequest()
		req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}, ParameterMode: "manual", Count: 4}}
		state := &cloudAgentRuntime{Request: req}
		if planned {
			plan := commerceFixturePlan()
			state.CommercePlan = &plan
		}
		task, _, err := s.prepareCloudAgentCreationMedia(&model.CloudAgentExecution{ID: "count-check", UserID: "user"}, state, cloudAgentMediaArgs{Mode: "image", Prompt: "A blue sky", Title: "One plan item"}, "count-call")
		if err != nil {
			t.Fatal(err)
		}
		config := task.Input["config"].(map[string]any)
		want := "4"
		if planned {
			want = "1"
		}
		if config["count"] != want {
			t.Fatalf("planned=%v got count=%v want=%s", planned, config["count"], want)
		}
	}
}
