package app

import (
	"strings"
	"testing"
)

func TestCreationCheckpointCarriesOnlyEffectiveResourcesAndApprovedPlan(t *testing.T) {
	plan := commerceFixturePlan()
	plan.Platform, plan.Site, plan.Language, plan.StyleBible = "amazon", "DE", "de-DE", "沿用原商品外观，暖色背景"
	plan.ProductFacts[0].Status = "supported"
	plan.ProductFacts[0].SourceIDs = []string{"current-product"}
	state := cloudAgentRuntime{Request: creationAgentRequest(), CommercePlan: &plan}
	state.Request.Attachments = []CloudAgentAttachment{{ResourceID: "current-product", Kind: "image", Role: "product", Name: "新商品"}, {ResourceID: "mood", Kind: "image", Role: "style", Name: "风格图"}}
	state.Request.AttachmentMode = "replace"
	state.CommerceBatch = &cloudAgentCommerceBatch{PlanID: plan.PlanID, Version: plan.Version, PlanHash: cloudAgentCommercePlanHash(&plan), Items: []cloudAgentCommerceBatchItem{{ItemID: plan.Items[0].ID, TaskID: "task-pending"}}}
	checkpoint := cloudAgentBoundCheckpoint(cloudAgentFallbackCheckpoint(&state))
	joined := strings.Join(checkpoint.CreationState, "\n")
	for _, want := range []string{"current-product", "mood", "product", "style", "amazon", "DE", "de-DE", "暖色背景", "task-pending", plan.Items[0].TargetCopy, plan.ProductFacts[0].Claim} {
		if !strings.Contains(joined, want) {
			t.Fatalf("creation checkpoint lost %q: %s", want, joined)
		}
	}
	if strings.Contains(joined, "old-product") || strings.Contains(joined, "resource:") {
		t.Fatalf("checkpoint resurrected excluded item or persisted binary address: %s", joined)
	}
}
