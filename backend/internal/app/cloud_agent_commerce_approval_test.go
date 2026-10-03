package app

import (
	"encoding/json"
	"testing"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func pausedCommerceApprovalFixture(t *testing.T) (*Service, *gorm.DB, *model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	req := creationAgentRequest()
	req.PermissionMode, req.IdempotencyKey = "request_approval", "paused-commerce-approval"
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 10, 1
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "商品图"}}
	req.MediaSettings = &CloudAgentCreationMedia{Video: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", Size: "9:16", DurationSeconds: 6}}
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].Type, plan.Items[0].Operation, plan.Items[0].AttachmentResourceIDs = "video", "image_to_video", []string{"ref-one"}
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
	call := cloudAgentCall{ID: "paused-set"}
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
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, err = cloudAgentDecode(run)
	if err != nil || state.Approval == nil || run.Status != "waiting_approval" {
		t.Fatalf("missing paused plan: %v", err)
	}
	return s, db, run, state
}

func TestCommerceExpiredQuoteKeepsPlanWaitingAndRequiresNewPriceApproval(t *testing.T) {
	s, db, run, state := pausedCommerceApprovalFixture(t)
	oldID, planHash := state.Approval.ID, cloudAgentCommercePlanHash(state.CommercePlan)
	state.Approval.Batch.Items[0].Prepared.Quote.ExpiresAt = time.Now().Add(-time.Minute)
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, oldID, "approve", ""); err == nil {
		t.Fatal("expired quote was approved without showing its renewal")
	}
	latest, _ := s.repo.CloudAgent("user", run.ID)
	renewed, err := cloudAgentDecode(latest)
	if err != nil || latest.Status != "waiting_approval" || renewed.Approval == nil {
		t.Fatalf("expired quote lost resumable approval: status=%s err=%v", latest.Status, err)
	}
	if renewed.Approval.ID == oldID || cloudAgentCommercePlanHash(renewed.CommercePlan) != planHash {
		t.Fatal("renewal reused stale vote or changed approved plan contents")
	}
	if !renewed.Approval.Batch.Items[0].Prepared.Quote.ExpiresAt.After(time.Now()) {
		t.Fatal("renewal still expired")
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("quote renewal submitted a generation task")
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, oldID, "approve", ""); err == nil {
		t.Fatal("stale browser could approve a new quote")
	}
	newID := renewed.Approval.ID
	for i := 0; i < 2; i++ {
		if err := s.DecideCloudAgentApproval("user", run.ID, newID, "approve", ""); err != nil {
			t.Fatal(err)
		}
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatalf("renewed approval submitted %d tasks", count)
	}
}

func TestCommerceQuoteRefreshIsOwnerScopedAndPreservesPendingPlanOnFailure(t *testing.T) {
	s, db, run, state := pausedCommerceApprovalFixture(t)
	oldID := state.Approval.ID
	if err := s.DecideCloudAgentApproval("other", run.ID, oldID, "refresh", ""); err == nil {
		t.Fatal("other user refreshed private approval")
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, oldID, "refresh", ""); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	if state.Approval.ID == oldID || run.Status != "waiting_approval" {
		t.Fatal("refresh did not preserve a reviewable pending approval")
	}
	newID := state.Approval.ID
	if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("status", "uploading").Error; err != nil {
		t.Fatal(err)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, newID, "refresh", ""); err == nil {
		t.Fatal("refresh accepted unavailable product resource")
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.ID != newID {
		t.Fatal("failed quote refresh destroyed pending plan")
	}
}
