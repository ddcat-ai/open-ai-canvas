package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
)

func TestEcommerceConversationMemoryKeepsSameProductCopyOnly(t *testing.T) {
	draft := EcommerceDraft{Instruction: "继续生成九张详情页", References: []EcommerceReference{{ResourceID: "product-a", Role: "primary"}, {ResourceID: "shared-brand-logo", Role: "logo"}}}
	source, _ := json.Marshal(EcommerceDraft{Instruction: "五张主副图", References: draft.References})
	plan, _ := json.Marshal(model.EcommercePlan{ProductSummary: "紫色蝴蝶宠物玩具", PreviousImages: []model.EcommercePlanTask{
		{ID: "sent-1", TaskID: "paid-1", SourceDraft: source, Copy: "拍一拍，陪它玩一会儿", Composition: "左前方主视角"},
		{ID: "unsubmitted", SourceDraft: source, Copy: "不应作为已完成记忆"},
	}})
	project := &model.EcommerceProject{PlanJSON: string(plan)}
	text := ecommerceConversationMemory(project, draft)
	if !strings.Contains(text, "拍一拍，陪它玩一会儿") || !strings.Contains(text, draft.Instruction) || strings.Contains(text, "不应作为已完成记忆") {
		t.Fatalf("memory=%s", text)
	}
	draft.References[0].ResourceID = "another-product"
	if text := ecommerceConversationMemory(project, draft); text != "" {
		t.Fatalf("new product inherited another product's copy: %s", text)
	}
}

func TestEcommerceShotAssignmentsPersistAndRejectRepeatedCopy(t *testing.T) {
	svc, _ := mockEcommerceAgentService(t)
	draft := EcommerceDraft{ImageType: "set", Count: 2, Platform: "taobao", Language: "zh-CN", ImageModel: "chosen-model", Ratio: "1:1", Resolution: "2K"}
	assignments := ecommerceagent.ShotAssignments(2, "set", "pet")
	input := canvasGenerationInput{Metadata: map[string]any{"ecommerceAgentAdapter": "workbench-v1", "stage": "planning", "ecommerceDraft": draft, "ecommerceShotAssignments": assignments}}
	plan := model.EcommercePlan{ProductSummary: "真实宠物玩具", VisualStrategy: "自然光", ConfirmedFacts: []string{}, UncertainFacts: []string{}, QualityChecks: []string{}, Images: []model.EcommercePlanTask{
		ecommerceWorkbenchTestPage("uuid-one", "main", "", "", "轻拍一下\n把日常留给互动"),
		ecommerceWorkbenchTestPage("uuid-two", "secondary", "", "", "绒面细节\n看见真实外观"),
	}}
	raw, _ := json.Marshal(plan)
	result := map[string]any{"text": string(raw)}
	if err := svc.validateEcommerceWorkbenchResult("owner", input, result); err != nil {
		t.Fatal(err)
	}
	var got model.EcommercePlan
	_ = json.Unmarshal([]byte(stringValue(result["text"])), &got)
	for i, image := range got.Images {
		if image.DisplayAssignment != assignments[i] || !strings.HasPrefix(image.Prompt, "【本屏唯一拍摄要求】") {
			t.Fatalf("page %d assignment lost: %+v", i, image)
		}
	}
	plan.Images[1].Copy = plan.Images[0].Copy
	raw, _ = json.Marshal(plan)
	if err := svc.validateEcommerceWorkbenchResult("owner", input, map[string]any{"text": string(raw)}); err == nil || !strings.Contains(err.Error(), "重复") {
		t.Fatalf("repeated copy accepted: %v", err)
	}
}
