package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCommerceCreationReplayKeepsPlanAndSupportsLaterPromptRepair(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.legacyCloudAgentRootTask = false
	installCreationParallelImageModel(t, db)
	req := creationAgentRequest()
	req.PermissionMode = "auto"
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "Product"}}
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}, ParameterMode: "auto"}}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	detail := plan.Items[0]
	detail.ID, detail.Title, detail.Prompt = "detail", "Product detail", "Show the product detail"
	detail.Dependencies = []string{"hero"}
	plan.Items = append(plan.Items, detail)
	source, sourceState := agentInterjectionState(t, s, root.ID)
	sourceState.CommercePlan = &plan
	if err := s.repo.MutateCloudAgentRun(source, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		current.Status = "completed"
		return cloudAgentSave(current, &sourceState)
	}); err != nil {
		t.Fatal(err)
	}
	heroID := cloudAgentCommerceTaskID("user", &plan, "hero", root.SessionID)
	failedID := cloudAgentCommerceTaskID("user", &plan, "detail", root.SessionID)
	for _, item := range plan.Items {
		id, status := heroID, model.TaskStatusSucceeded
		if item.ID == "detail" {
			id, status = failedID, model.TaskStatusFailed
		}
		input := map[string]any{"mode": "image", "prompt": item.Prompt, "config": map[string]any{"channelId": "channel", "channelModelKey": "image-test", "model": "image-test", "size": "1024x1024", "count": "1"}, "referenceImages": []map[string]any{{"id": "ref-one", "storageKey": "resource:ref-one", "type": "image/png", "role": "product"}}, "metadata": map[string]any{"source": "cloud_agent_creation", "agentRunId": root.ID, "commercePlanId": plan.PlanID, "commerceVersion": plan.Version, "commerceItemId": item.ID, "commercePlanHash": cloudAgentCommercePlanHash(&plan)}}
		if err := db.Create(&model.Task{ID: id, UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Operation: "image_to_image", Model: "image-test", Prompt: item.Prompt, InputJSON: mustMarshal(input), Status: status}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.RouteAttempt{ID: "commerce-replay-service-failure", TaskID: failedID, Status: "failed", DispatchState: "rejected_no_job", FailureCode: "upstream_429"}).Error; err != nil {
		t.Fatal(err)
	}
	req.IdempotencyKey, req.SessionID = "commerce-direct-replay", root.SessionID
	req.Retry = &CloudAgentCreationRetry{RunID: root.ID, TaskID: failedID}
	next, err := s.CreateCloudAgentRun("user", req, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, replayState := agentInterjectionState(t, s, next.ID)
	if len(replayState.RetryReplay) != 1 || replayState.CommercePlan == nil || cloudAgentCommercePlanHash(replayState.CommercePlan) != cloudAgentCommercePlanHash(&plan) {
		t.Fatal("direct replay lost the original commerce plan")
	}
	if err := s.advanceCloudAgentByID("user", next.ID); err != nil {
		t.Fatal(err)
	}
	retried, err := s.repo.TaskForUser("user", cloudAgentCommerceRetryTaskID("user", failedID))
	if err != nil || retried.AgentRunID != next.ID || retried.Prompt != detail.Prompt {
		t.Fatalf("failed item was not replayed unchanged: %+v %v", retried, err)
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", next.ID, "canvas_image").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("replay regenerated successful items: %d %v", count, err)
	}
	if err := db.Model(retried).Update("status", model.TaskStatusFailed).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RouteAttempt{ID: "commerce-replay-content-failure", TaskID: retried.ID, RouteRun: retried.RouteRun, Status: "failed", DispatchState: "rejected_no_job", FailureCode: "content_policy_violation"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.repo.RefundBillingOrder(retried.BillingOrderID, "confirmed rejected request"); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", next.ID); err != nil {
		t.Fatal(err)
	}
	finished, finishedState := agentInterjectionState(t, s, next.ID)
	summary := ""
	for _, event := range finishedState.Events {
		if event.Type == "assistant_message" && stringValue(event.Payload["messageId"]) == next.ID+":retry-result" {
			summary = stringValue(event.Payload["text"])
		}
	}
	if finished.Status != "completed" || !strings.Contains(summary, "0 项成功，1 项失败，0 项已取消") {
		t.Fatalf("failed replay was not reported accurately: status=%s summary=%q", finished.Status, summary)
	}
	req.IdempotencyKey = "commerce-repair-replayed-item"
	req.Retry = &CloudAgentCreationRetry{RunID: next.ID, TaskID: retried.ID}
	repair, err := s.CreateCloudAgentRun("user", req, next.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, repairState := agentInterjectionState(t, s, repair.ID)
	if len(repairState.RetryReplay) != 0 {
		t.Fatal("content rejection bypassed prompt repair")
	}
	restored, err := s.cloudAgentCommerceRetryPlan("user", &repairState, "detail", retried.ID)
	if err != nil || restored == nil || cloudAgentCommercePlanHash(restored) != cloudAgentCommercePlanHash(&plan) {
		t.Fatalf("prompt repair could not recover original plan: %v", err)
	}
	repairState.CommercePlan = restored
	if err := cloudAgentCommerceValidateRetryTarget(s.repo, "user", &repairState, "detail", retried.ID); err != nil {
		t.Fatalf("replayed item lost its retry chain: %v", err)
	}
	if err := cloudAgentCommerceDependenciesReady(s.repo, "user", &repairState, "detail"); err != nil {
		t.Fatalf("successful dependency lost across replay: %v", err)
	}
	hero, err := s.repo.TaskForUser("user", heroID)
	if err != nil || hero.Status != model.TaskStatusSucceeded || hero.AgentRunID != root.ID {
		t.Fatalf("original successful task was changed: %+v %v", hero, err)
	}
}
