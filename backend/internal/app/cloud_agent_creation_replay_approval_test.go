package app

import (
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func pausedCreationReplayFixture(t *testing.T) (*Service, *gorm.DB, *model.CloudAgentExecution, cloudAgentRuntime, string) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	s.legacyCloudAgentRootTask = false
	installCreationParallelImageModel(t, db)
	req := creationAgentRequest()
	req.PermissionMode = "request_approval"
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}, ParameterMode: "auto"}}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	completeCreationReferenceRun(t, db, root.ID)
	const sourceID = "replay-approval-source"
	input := map[string]any{"mode": "image", "prompt": "Keep original visual", "config": map[string]any{"channelId": "channel", "channelModelKey": "image-test", "model": "image-test", "size": "1024x1024", "count": "1"}, "referenceImages": []map[string]any{{"id": "ref-one", "storageKey": "resource:ref-one", "type": "image/png", "role": "reference"}}, "metadata": map[string]any{"source": "cloud_agent_creation", "title": "Original visual", "agentRunId": root.ID}}
	if err := db.Create(&model.Task{ID: sourceID, UserID: "user", AgentRunID: root.ID, Type: "canvas_image", Operation: "image_to_image", Model: "image-test", Prompt: "Keep original visual", InputJSON: mustMarshal(input), Status: model.TaskStatusFailed}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RouteAttempt{ID: "replay-approval-attempt", TaskID: sourceID, Status: "failed", DispatchState: "rejected_no_job", FailureCode: "upstream_429"}).Error; err != nil {
		t.Fatal(err)
	}
	req.IdempotencyKey, req.SessionID = "replay-approval", root.SessionID
	req.Retry = &CloudAgentCreationRetry{RunID: root.ID, TaskID: sourceID}
	next, err := s.CreateCloudAgentRun("user", req, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", next.ID); err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, s, next.ID)
	if run.Status != "waiting_approval" || state.Approval == nil || len(state.RetryReplay) != 1 {
		t.Fatalf("expected paused replay, status=%s approval=%v targets=%v", run.Status, state.Approval != nil, state.RetryReplay)
	}
	return s, db, run, state, sourceID
}

func TestCreationReplayExpiredQuoteRefreshesAndResumesOnce(t *testing.T) {
	s, db, run, state, sourceID := pausedCreationReplayFixture(t)
	oldID := state.Approval.ID
	original := state.Approval.Batch.Items[0]
	state.Approval.Batch.Items[0].Prepared.Quote.ExpiresAt = time.Now().Add(-time.Minute)
	if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, oldID, "approve", ""); err == nil {
		t.Fatal("expired quote was approved without renewal")
	}
	run, state = agentInterjectionState(t, s, run.ID)
	if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.ID == oldID {
		t.Fatal("expired replay quote did not rotate the pending approval")
	}
	renewed := state.Approval.Batch.Items[0]
	if renewed.TaskID != original.TaskID || renewed.Args.Prompt != original.Args.Prompt || !renewed.Prepared.Quote.ExpiresAt.After(time.Now()) {
		t.Fatal("replay refresh lost frozen intent, identity or valid quote")
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("agent_run_id = ?", run.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("refresh created a task: %d %v", count, err)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, oldID, "approve", ""); err == nil {
		t.Fatal("stale approval accepted")
	}
	for i := 0; i < 2; i++ {
		if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, "approve", ""); err != nil {
			t.Fatal(err)
		}
		if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
			t.Fatal(err)
		}
	}
	task, err := s.repo.TaskForUser("user", cloudAgentCommerceRetryTaskID("user", sourceID))
	if err != nil || task.AgentRunID != run.ID || task.Prompt != original.Args.Prompt {
		t.Fatalf("renewed replay did not resume original item: %v %v", task, err)
	}
	if err := db.Model(&model.Task{}).Where("agent_run_id = ?", run.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("replayed approval created %d tasks: %v", count, err)
	}
}

func TestCreationReplayAdmissionRechecksSourceBilling(t *testing.T) {
	s, db, run, state, sourceID := pausedCreationReplayFixture(t)
	order := model.BillingOrder{ID: "source-running-bill", UserID: "user", TaskID: sourceID, Status: model.BillingStatusRunning}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", sourceID).Update("billing_order_id", order.ID).Error; err != nil {
		t.Fatal(err)
	}
	// Submit the frozen approved request through ordinary task admission. The
	// repository guard must recheck the original order inside the write transaction.
	item := state.Approval.Batch.Items[0]
	request := item.Request
	request.admission = &taskAdmission{ID: item.TaskID, AgentRunID: run.ID, MaxCharge: CreditScale}
	_, err := s.CreateTask("user", request)
	if err == nil || !strings.Contains(err.Error(), "原任务账务尚未确认") {
		t.Fatalf("source billing guard did not reject retry: %v", err)
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("agent_run_id = ?", run.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("unsettled source billed another task: count=%d err=%v", count, err)
	}
	if err := db.Model(&model.BillingOrder{}).Where("task_id = ?", cloudAgentCommerceRetryTaskID("user", sourceID)).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("unsettled source reserved retry credits: count=%d err=%v", count, err)
	}
}

func TestCreationReplayMixedMediaApprovalCountsDeliveries(t *testing.T) {
	for _, tc := range []struct {
		name  string
		modes []string
		count string
	}{
		{name: "images", modes: []string{"image", "image"}, count: "2 张独立图片"},
		{name: "video", modes: []string{"video"}, count: "1 项媒体"},
		{name: "mixed", modes: []string{"image", "video"}, count: "2 项媒体"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			batch := &cloudAgentCommerceBatch{Kind: "images"}
			for _, mode := range tc.modes {
				batch.Items = append(batch.Items, cloudAgentCommerceBatchItem{Args: cloudAgentMediaArgs{Mode: mode, Title: mode}, Prepared: &cloudAgentPreparedMedia{Quote: cloudAgentMediaQuote{AmountMicrocredits: 1}}})
				batch.QuoteMicrocredits++
			}
			preview := cloudAgentImageBatchPreview(batch)
			if len(preview.Items) != len(tc.modes) || !strings.Contains(preview.Description, tc.count) {
				t.Fatalf("replay approval misrepresented media count: %+v", preview)
			}
		})
	}
}
