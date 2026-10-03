package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCommerceNewBatchCannotReusePreviousTaskIdentity(t *testing.T) {
	s, db, run, state := pausedCommerceApprovalFixture(t)
	plan := state.CommercePlan
	taskID := cloudAgentCommerceTaskID("user", plan, "hero", state.Request.SessionID)
	if err := db.Create(&model.Task{ID: taskID, UserID: "user", Type: "canvas_video", Status: model.TaskStatusSucceeded, InputJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	state.CommercePlan = nil
	if batch, err := s.prepareCloudAgentCommerceBatch(run, &state, plan, cloudAgentCall{ID: "new-product"}); err == nil || !strings.Contains(fmt.Sprint(err), "版本") || batch != nil {
		t.Fatalf("new turn reused a previous item task ID: %v %+v", err, batch)
	}
	plan.Version++
	if batch, err := s.prepareCloudAgentCommerceBatch(run, &state, plan, cloudAgentCall{ID: "revised-product"}); err != nil || len(batch.Items) != 1 || batch.Items[0].TaskID == taskID {
		t.Fatalf("fresh version could not receive its own quote: %v", err)
	}
}

func TestCommercePlanOneApprovalSubmitsEntireFrozenSetOnce(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	req := creationAgentRequest()
	req.PermissionMode, req.IdempotencyKey = "request_approval", "commerce-set-once"
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks, req.Budget.MaxVideoSeconds = 10, 2, 24
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "商品图"}}
	req.MediaSettings = &CloudAgentCreationMedia{Video: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", Size: "9:16", DurationSeconds: 6}}
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].Type, plan.Items[0].Operation = "video", "image_to_video"
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	detail := plan.Items[0]
	detail.ID, detail.Title, detail.Purpose = "detail", "细节视频", "细节展示"
	detail.Prompt, detail.TargetCopy, detail.ChineseReviewCopy = "Close view of the same product", "Same product, close view", "同款产品，近景"
	plan.Items = append(plan.Items, detail)
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
	raw, _ := json.Marshal(plan)
	call := cloudAgentCall{ID: "commerce-set-submit"}
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
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.Batch == nil || state.Approval.Batch.PlanHash != cloudAgentCommercePlanHash(&plan) || len(state.Approval.Batch.Items) != 2 {
		t.Fatalf("missing immutable set approval: status=%s approval=%+v", run.Status, state.Approval)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatalf("charged before approval: %d", count)
	}
	approvalID := state.Approval.ID
	if err := s.DecideCloudAgentApproval("user", run.ID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	approvedRun, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	approvedState, err := cloudAgentDecode(approvedRun)
	if err != nil {
		t.Fatal(err)
	}
	if approvedState.Approval == nil || approvedState.Approval.Batch == nil || approvedState.DecisionPreparedHashes[approvalID] != cloudAgentCommerceBatchHash(approvedState.Approval.Batch) {
		t.Fatalf("approval was not bound to exact item/quote set: %+v", approvedState.Approval)
	}
	for _, item := range plan.Items {
		id := cloudAgentCommerceTaskID("user", &plan, item.ID, state.Request.SessionID)
		task, err := s.repo.TaskForUser("user", id)
		if err != nil {
			t.Fatalf("item %s not submitted by one approval: %v", item.ID, err)
		}
		if !strings.Contains(task.InputJSON, item.TargetCopy) || !strings.Contains(task.InputJSON, "resource:ref-one") || strings.Contains(task.InputJSON, item.ChineseReviewCopy) {
			t.Fatalf("item %s did not use reviewed prompt/real reference: %s", item.ID, task.InputJSON)
		}
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 2 {
		t.Fatalf("duplicate approval produced %d tasks", count)
	}
}

func TestCommerceApprovalRejectsChangedPlanBeforeAnyTask(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	req := creationAgentRequest()
	req.PermissionMode, req.IdempotencyKey = "request_approval", "commerce-changed-after-preview"
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 10, 1
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "商品图"}}
	req.MediaSettings = &CloudAgentCreationMedia{Video: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", Size: "9:16", DurationSeconds: 6}}
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].Type, plan.Items[0].Operation = "video", "image_to_video"
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
	raw, _ := json.Marshal(plan)
	call := cloudAgentCall{ID: "submit-before-mutation"}
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
	if err != nil || run.Status != "waiting_approval" || state.Approval == nil {
		t.Fatalf("missing approval before mutation: %s %+v %v", run.Status, state.Approval, err)
	}
	approvalID := state.Approval.ID
	state.CommercePlan.Items[0].TargetCopy = "Different, unreviewed copy"
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("changed plan submitted %d unreviewed tasks", count)
	}
}

func TestCommerceOverBudgetPlanRemainsReviewableWithoutExecution(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	choice := CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", Size: "9:16", DurationSeconds: 6}
	run, state := creationMediaRun(t, s, "commerce-over-budget-review", cloudAgentMediaArgs{Mode: "video", Prompt: "placeholder"}, choice)
	state.Request.Budget.MaxCredits = 0.000001
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].Type, plan.Items[0].Operation = "video", "image_to_video"
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	raw, _ := json.Marshal(plan)
	state.Calls[0].ID = "unpriced-plan"
	state.Calls[0].Function.Name, state.Calls[0].Function.Arguments = "commerce_plan_submit", string(raw)
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
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, event := range state.Events {
		if event.Type == "plan_updated" && event.Payload["planHash"] == cloudAgentCommercePlanHash(&plan) {
			quote, ok := event.Payload["estimatedCredits"].(float64)
			found = ok && quote > state.Request.Budget.MaxCredits
		}
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if !found || state.Approval != nil || count != 0 {
		t.Fatalf("over-budget plan must remain visible and non-executable: plan=%v approval=%+v tasks=%d", found, state.Approval, count)
	}
}

func TestCommerceApprovedImagesReachMockUpstreamWithReviewedCopyAndRealPixels(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	s, db, pixels := cloudAgentVisionFixture(t)
	if err := db.Create(&model.ModelChannel{ID: "image-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "独立图片测试渠道"}).Error; err != nil {
		t.Fatal(err)
	}
	imageCapability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "image-test")
	if err := db.Create(&model.ChannelModel{ID: "image-cm", ChannelID: "image-channel", ModelKey: "image-test", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, imageCapability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	type upstreamCall struct {
		prompt string
		pixels []byte
		path   string
	}
	upstream := make(chan upstreamCall, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			t.Errorf("unexpected upstream request path=%s content-type=%s", r.URL.Path, r.Header.Get("Content-Type"))
			w.WriteHeader(400)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		images := creationMaps(body["images"])
		imageURL := ""
		if len(images) == 1 {
			imageURL = stringField(images[0], "image_url")
		}
		contents, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(imageURL, "data:image/png;base64,"))
		if err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		upstream <- upstreamCall{prompt: stringField(body, "prompt"), pixels: contents, path: r.URL.Path}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString(pixels) + `"}]}`))
	}))
	defer server.Close()
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "image-channel").Updates(map[string]any{"base_url": server.URL + "/v1", "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	req := creationAgentRequest()
	req.PermissionMode, req.IdempotencyKey = "request_approval", "commerce-real-mock-upstream"
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 10, 2
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "产品照片"}}
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "image-channel", ChannelModelKey: "image-test"}, ParameterMode: "auto"}}
	plan := commerceFixturePlan()
	plan.Site, plan.Language, plan.Intent = "JP", "ja-JP", "日本站副图套图，不包含白底图"
	plan.StyleBible = "Warm studio scene with the same blue cup silhouette"
	plan.ProductFacts[0].Claim, plan.ProductFacts[0].SourceIDs = "Blue enamel mug", []string{"ref-one"}
	plan.Items[0].Purpose, plan.Items[0].Prompt = "副图：使用场景", "Show the blue enamel mug in a warm lifestyle scene"
	plan.Items[0].TargetCopy, plan.Items[0].ChineseReviewCopy = "ブルーのエナメルマグ", "蓝色搪瓷杯"
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	detail := plan.Items[0]
	detail.ID, detail.Title, detail.Purpose = "detail", "细节图", "detail view"
	detail.Prompt, detail.TargetCopy, detail.ChineseReviewCopy = "Close view of the same product handle", "ハンドルの細部", "手柄细节"
	detail.FactIDs = nil
	plan.Items = append(plan.Items, detail)
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
	call := cloudAgentCall{ID: "plan-for-mock"}
	call.Function.Name = "commerce_plan_submit"
	raw, _ := json.Marshal(plan)
	call.Function.Arguments = string(raw)
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
	if err != nil || state.Approval == nil {
		t.Fatalf("no full-set approval: %+v %v", state.Approval, err)
	}
	if state.CommercePlan == nil || len(state.CommercePlan.Rules) == 0 {
		t.Fatalf("Japan listing rules absent from reviewed plan: %+v", state.CommercePlan)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	for _, item := range plan.Items {
		taskID := cloudAgentCommerceTaskID("user", &plan, item.ID, state.Request.SessionID)
		task, err := s.repo.TaskForUser("user", taskID)
		if err != nil {
			t.Fatal(err)
		}
		var submitted canvasGenerationInput
		if err := json.Unmarshal([]byte(task.InputJSON), &submitted); err != nil {
			t.Fatal(err)
		}
		if len(submitted.ReferenceImages) != 1 {
			t.Fatalf("submitted item %s lost actual image reference: %+v", item.ID, submitted.ReferenceImages)
		}
		if _, err := s.processCanvasGenerationTask(context.Background(), "user", "", "canvas_image", "", task.InputJSON); err != nil {
			t.Fatalf("actual task worker %s failed: %v", item.ID, err)
		}
		select {
		case actual := <-upstream:
			for _, want := range []string{item.TargetCopy, item.Prompt, "platform: amazon", "site: JP", "language: ja-JP", "Warm studio scene", "Preserve the actual product", "sell.amazon.co.jp/en/learn/listing", "副图"} {
				if !strings.Contains(actual.prompt, want) {
					t.Errorf("upstream %s missed %q: %s", item.ID, want, actual.prompt)
				}
			}
			if actual.path != "/v1/images/edits" || !bytes.Equal(actual.pixels, pixels) || strings.Contains(actual.prompt, item.ChineseReviewCopy) {
				t.Errorf("upstream %s has wrong path, image bytes or audit translation: %+v", item.ID, actual)
			}
		default:
			t.Fatalf("task %s did not reach mock upstream", item.ID)
		}
	}
}

func TestCommerceBatchSubmitsDependentItemAfterSuccessAndNeverRetriesFailure(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	choice := CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", Size: "9:16", DurationSeconds: 6}
	run, state := creationMediaRun(t, s, "commerce-auto-dependencies", cloudAgentMediaArgs{Mode: "video", Prompt: "placeholder"}, choice, "auto")
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].Type, plan.Items[0].Operation = "video", "image_to_video"
	plan.Items[0].AttachmentResourceIDs = []string{"ref-one"}
	detail := plan.Items[0]
	detail.ID, detail.Title = "detail", "细节视频"
	detail.Dependencies = []string{"hero"}
	plan.Items = append(plan.Items, detail)
	raw, _ := json.Marshal(plan)
	state.Calls[0].ID = "batch-dependency-plan"
	state.Calls[0].Function.Name, state.Calls[0].Function.Arguments = "commerce_plan_submit", string(raw)
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	heroID := cloudAgentCommerceTaskID("user", &plan, "hero", state.Request.SessionID)
	detailID := cloudAgentCommerceTaskID("user", &plan, "detail", state.Request.SessionID)
	if _, err := s.repo.TaskForUser("user", heroID); err != nil {
		t.Fatalf("hero not submitted: %v", err)
	}
	if _, err := s.repo.TaskForUser("user", detailID); err == nil {
		t.Fatal("dependent item submitted before hero success")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", heroID).Update("status", model.TaskStatusSucceeded).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.settleCloudAgentMedia("user", run.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.repo.TaskForUser("user", detailID); err != nil {
		t.Fatalf("dependent item did not progress: %v", err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", detailID).Update("status", model.TaskStatusFailed).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.settleCloudAgentMedia("user", run.ID); err != nil {
		t.Fatal(err)
	}
	latest, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	completed, err := cloudAgentDecode(latest)
	if err != nil || completed.CallIndex != 1 || completed.MediaTaskID != "" {
		t.Fatalf("batch did not settle after partial failure: %+v %v", completed, err)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 2 {
		t.Fatalf("failed item retried or successful item recreated: %d", count)
	}
}
