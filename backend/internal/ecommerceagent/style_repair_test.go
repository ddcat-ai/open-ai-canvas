package ecommerceagent

import (
	"strings"
	"testing"
)

// Fast models often drop one visual sub-field or paraphrase the anchor. The
// direction must still be usable without inventing product facts.
func TestRepairStyleRecommendationFillsMinorGaps(t *testing.T) {
	rec := Recommendation{Label: "晨光原木静物", Style: "原木台面与晨光侧逆光，奶瓶居中", Why: "", PreviewPrompt: "baby bottle on oak table, best seller, soft window light, same product as the reference",
		VisualSystem: &VisualSystem{Palette: []string{"米白 #F3EEE6", " ", "原木 #C9A27E"}, Typography: "细黑体", Scene: "", Lighting: "左侧窗光"}}
	filled := RepairStyleRecommendation(&rec)
	if !CompleteStyleRecommendation(rec) {
		t.Fatalf("repaired direction still incomplete: %#v %#v", rec, rec.VisualSystem)
	}
	if !strings.HasPrefix(rec.PreviewPrompt, ProductAnchor) || strings.Contains(strings.ToLower(rec.PreviewPrompt), "best seller") {
		t.Fatalf("preview prompt = %q", rec.PreviewPrompt)
	}
	if rec.VisualSystem.Scene != rec.Style || len(rec.VisualSystem.Palette) != 2 || rec.VisualSystem.Lighting != "左侧窗光" {
		t.Fatalf("visual system = %#v", rec.VisualSystem)
	}
	if strings.Join(filled, ",") == "" {
		t.Fatal("repair did not report filled fields")
	}
}

func TestRepairStyleRecommendationKeepsRealGaps(t *testing.T) {
	for _, rec := range []Recommendation{
		{Label: "", Style: "描述", VisualSystem: &VisualSystem{Palette: []string{"a #000000", "b #FFFFFF"}}},
		{Label: "名称", Style: "描述", VisualSystem: &VisualSystem{Palette: []string{"only #000000"}}},
		{Label: "名称", Style: "描述"},
	} {
		RepairStyleRecommendation(&rec)
		if CompleteStyleRecommendation(rec) {
			t.Fatalf("direction without name or palette was accepted: %#v", rec)
		}
	}
}
