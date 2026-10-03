package app

import (
	"strings"
	"testing"
)

func TestCommerceUnknownFactIsReviewOnlyAndNeverBecomesAnItemClaim(t *testing.T) {
	req := creationAgentRequest()
	req.Attachments = []CloudAgentAttachment{{ResourceID: "product-1", StorageKey: "resource:product-1", Kind: "image", Role: "product"}}
	plan := commerceFixturePlan()
	plan.ProductFacts = append(plan.ProductFacts, cloudAgentCommerceFact{ID: "size", Claim: "容量 500ml 尚未确认", Status: "unknown"})
	if err := validateCloudAgentCommercePlan(req, &plan); err != nil {
		t.Fatalf("review-only unknown fact rejected: %v", err)
	}
	plan.Items[0].FactIDs = append(plan.Items[0].FactIDs, "size")
	if err := validateCloudAgentCommercePlan(req, &plan); err == nil {
		t.Fatal("unknown fact was promoted into item copy")
	}
}

func TestCommerceRequiresLineAlignedChineseReviewForForeignVisibleCopy(t *testing.T) {
	req := creationAgentRequest()
	req.Attachments = []CloudAgentAttachment{{ResourceID: "product-1", StorageKey: "resource:product-1", Kind: "image", Role: "product"}}
	plan := commerceFixturePlan()
	plan.Items[0].TargetCopy = "A durable cup\nEasy to carry"
	plan.Items[0].ChineseReviewCopy = "耐用水杯"
	if err := validateCloudAgentCommercePlan(req, &plan); err == nil {
		t.Fatal("two visible lines accepted with one review line")
	}
	plan.Items[0].ChineseReviewCopy = "耐用水杯\n方便携带"
	if err := validateCloudAgentCommercePlan(req, &plan); err != nil {
		t.Fatalf("aligned review rejected: %v", err)
	}
	plan.Items[0].ChineseReviewCopy = ""
	if err := validateCloudAgentCommercePlan(req, &plan); err == nil {
		t.Fatal("foreign visible copy accepted without Chinese review")
	}
}

func TestCommerceLanguageVariantsAndNoTextCompileFromReviewedItem(t *testing.T) {
	req := creationAgentRequest()
	req.Attachments = []CloudAgentAttachment{{ResourceID: "product-1", StorageKey: "resource:product-1", Kind: "image", Role: "product"}}
	plan := commerceFixturePlan()
	plan.Language = "mul"
	plan.LanguageVariants = []string{"en-GB", "de-DE"}
	plan.Items[0].Language = "en-GB"
	other := plan.Items[0]
	other.ID, other.Title, other.Language = "german", "德语细节", "de-DE"
	other.TargetCopy, other.ChineseReviewCopy = "", ""
	plan.Items = append(plan.Items, other)
	if err := validateCloudAgentCommercePlan(req, &plan); err != nil {
		t.Fatalf("explicit variant plan invalid: %v", err)
	}
	call := cloudAgentCall{ID: "german-item"}
	call.Function.Name, call.Function.Arguments = "generate_media", `{"mode":"image","commercePlanId":"plan-1","commerceItemId":"german"}`
	compiled, err := cloudAgentCommerceMediaCall(&plan, call)
	if err != nil {
		t.Fatal(err)
	}
	for _, piece := range []string{"de-DE", "No visible text", "Do not add new logos"} {
		if !strings.Contains(compiled.Function.Arguments, piece) {
			t.Fatalf("compiled prompt lacks %q: %s", piece, compiled.Function.Arguments)
		}
	}
	if strings.Contains(compiled.Function.Arguments, "不锈钢杯身") || strings.Contains(compiled.Function.Arguments, "本图不放文字") {
		t.Fatalf("review copy leaked into target prompt: %s", compiled.Function.Arguments)
	}
}

func TestCommerceReviewNamesOnlySkillsActuallyReadInThisRun(t *testing.T) {
	plan := commerceFixturePlan()
	skills := []cloudAgentSkill{{ID: "igo-visual-design", Name: "电商视觉设计"}, {ID: "other", Name: "其他创作技能"}}
	events := []CloudAgentEvent{{Type: "tool_completed", Payload: map[string]any{"toolName": "skill_read_file", "skillId": "igo-visual-design"}}}
	payload := cloudAgentCommerceReviewPayload(&plan, creationAgentRequest(), skills, events)
	used, ok := payload["skills"].([]map[string]any)
	if !ok || len(used) != 1 || used[0]["id"] != "igo-visual-design" {
		t.Fatalf("review incorrectly lists candidate as used skill: %#v", payload["skills"])
	}
}
