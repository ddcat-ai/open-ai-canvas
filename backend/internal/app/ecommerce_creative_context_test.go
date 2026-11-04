package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
)

func TestEcommerceCreativeKnowledgeRetrievesReviewedApplicableMethods(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	t.Setenv("AI_MODE", "live")
	now := time.Now().UTC()
	expired := now.Add(-time.Hour)
	for _, source := range []model.EcommerceKnowledgeSource{{ID: "ready", Name: "审核库", Status: "ready"}, {ID: "disabled", Name: "停用库", Status: "disabled"}} {
		if err := db.Create(&source).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		id, source, review, category, platform string
		until                                  *time.Time
	}{
		{"耳机已审核文案", "ready", "approved", "tech", "[]", nil},
		{"未审核内容", "ready", "pending", "tech", "[]", nil},
		{"已拒绝内容", "ready", "rejected", "tech", "[]", nil},
		{"停用来源内容", "disabled", "approved", "tech", "[]", nil},
		{"过期内容", "ready", "approved", "tech", "[]", &expired},
		{"其他品类内容", "ready", "approved", "beauty", "[]", nil},
		{"其他平台内容", "ready", "approved", "tech", `["amazon"]`, nil},
	} {
		entry := model.EcommerceKnowledgeEntry{ID: tc.id, DedupHash: tc.id, SourceID: tc.source, Title: tc.id, KnowledgeType: "copywriting_pattern", Category: tc.category, ReviewStatus: tc.review, PlatformsJSON: tc.platform, TrustLevel: "reviewed_community", ContentJSON: `{"guidance":"` + tc.id + `"}`, ValidUntil: tc.until}
		if err := db.Create(&entry).Error; err != nil {
			t.Fatal(err)
		}
	}
	context, entries, err := svc.ecommerceCreativeContext(EcommerceCreativeDirectionsRequest{ProductName: "头戴式耳机", Instruction: "生成详情页", ImageType: "detail", Platform: "taobao"})
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("no methods retrieved")
	}
	for _, text := range []string{"耳机已审核文案", "赛博朋克", "潮流穿搭", "潮酷电音", "日系唱片", "极简科技棚拍", "商业摄影执行标准", "4–10字主题标题", "字体", "letterbox"} {
		if !strings.Contains(context, text) {
			t.Fatalf("missing creative method %s", text)
		}
	}
	for _, text := range []string{"未审核内容", "已拒绝内容", "停用来源内容", "过期内容", "其他品类内容", "其他平台内容"} {
		if strings.Contains(context, text) {
			t.Fatalf("inapplicable source reached prompt: %s", text)
		}
	}
}

func TestEcommerceCreativeAdmissionPreservesOwnershipChargesAndSelectedStyle(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	t.Setenv("AI_MODE", "mock")
	project, _ := svc.CreateEcommerceProject("user")
	draft := EcommerceDraft{ProductName: "耳机", Instruction: "生成详情页", ImageType: "detail", Count: 9, Ratio: "9:16"}
	raw, _ := json.Marshal(draft)
	db.Model(project).Update("draft_json", string(raw))
	response, err := svc.RecommendEcommerceCreativeDirectionsContext(t.Context(), "user", EcommerceCreativeDirectionsRequest{ProjectID: project.ID, ProductName: "耳机", Count: 9, ImageType: "detail"})
	if err != nil {
		t.Fatal(err)
	}
	selection, err := svc.SelectEcommerceCreativeDirection("user", response.RecommendationID, response.Directions[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	draft.CreativeRecommendationID, draft.CreativeDirectionID = response.RecommendationID, selection.DirectionID
	raw, _ = json.Marshal(draft)
	db.Model(project).Update("draft_json", string(raw))
	input := map[string]any{"mode": "text", "metadata": map[string]any{"source": "ecommerce-agent", "stage": "planning", "ecommerceProjectId": project.ID}}
	prompt, err := svc.prepareEcommerceWorkbenchTask("user", input, "最终返回工作台JSON")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt, response.Directions[1].Name) || !strings.Contains(prompt, ecommerceagent.CreativeKnowledgeVersion) || strings.Contains(prompt, "无需检索知识库") || !strings.Contains(prompt, "4–10字主题标题") || !strings.Contains(prompt, "布光") {
		t.Fatal("selected style or sparse-brief knowledge lost at task admission")
	}
	var before, after int64
	db.Model(&model.BillingOrder{}).Count(&before)
	if _, err := svc.CreateEcommercePlanningTask("other", project.ID, creationTextRequest()); err == nil {
		t.Fatal("cross-owner task admitted")
	}
	bad := creationTextRequest()
	bad.Type = "canvas_image"
	if _, err := svc.CreateEcommercePlanningTask("user", project.ID, bad); err == nil {
		t.Fatal("image accepted by text-only admission")
	}
	db.Model(&model.BillingOrder{}).Count(&after)
	if before != after {
		t.Fatal("rejected requests reserved credits")
	}
	req := creationTextRequest()
	req.Input["metadata"] = map[string]any{"source": "untrusted-client", "stage": "planning", "ecommerceProjectId": "untrusted-project"}
	task, err := svc.CreateEcommercePlanningTask("user", project.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(task.Prompt, ecommerceagent.CreativeKnowledgeVersion) {
		t.Fatal("queued task lost knowledge")
	}
	var saved map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &saved); err != nil {
		t.Fatal(err)
	}
	metadata := saved["metadata"].(map[string]any)
	if stringValue(metadata["ecommerceProjectId"]) != project.ID || stringValue(metadata["source"]) != "ecommerce-agent" {
		t.Fatal("client changed ownership snapshot")
	}
	db.Model(&model.BillingOrder{}).Where("task_id = ?", task.ID).Count(&after)
	if after != 1 {
		t.Fatalf("expected one shared order, got %d", after)
	}
}
