package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestEcommercePageClaimsRequireUserEvidence(t *testing.T) {
	for _, tc := range []struct {
		name, prompt, copy, evidence string
		allowed                      bool
	}{
		{"creative only", "蓝色外观，柔和自然光", "陪伴每一天", "", true},
		{"unverified battery", "续航24小时", "", "", false},
		{"confirmed battery", "续航24小时", "", "续航24小时", true},
		{"different battery", "续航25小时", "", "续航24小时", false},
		{"negated claim", "禁止编造续航24小时", "", "", true},
		{"claim after negation", "禁止编造续航24小时，但续航24小时", "", "", false},
		{"claim after conjunction", "禁止编造续航24小时，同时续航24小时", "", "", false},
		{"unverified capacity", "", "容量500ml", "", false},
		{"confirmed capacity", "", "容量500ml", "容量500ml", true},
		{"unverified material", "真皮耳垫", "", "", false},
		{"unverified silicone", "奶嘴采用硅胶", "", "", false},
		{"confirmed silicone", "奶嘴采用硅胶", "", "硅胶", true},
		{"background glass", "背景使用玻璃台面", "", "", true},
		{"unverified safety", "", "不含BPA", "", false},
		{"unverified certification", "FDA认证", "", "", false},
		{"unverified function", "主动降噪", "", "", false},
		{"negated evidence", "主动降噪", "", "不支持主动降噪", false},
		{"negative evidence", "防水", "", "无防水性能", false},
		{"confirmed absence claim", "不含BPA", "", "不含BPA", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			draft := EcommerceDraft{Specifications: tc.evidence}
			page := model.EcommercePlanTask{Prompt: tc.prompt, Copy: tc.copy}
			err := validateEcommercePageClaims(draft, model.EcommercePlan{}, page, 0)
			if (err == nil) != tc.allowed {
				t.Fatalf("allowed=%v error=%v", tc.allowed, err)
			}
		})
	}
	page := model.EcommercePlanTask{Prompt: "呈现产品材质细节与自然光影"}
	if err := validateEcommercePageClaims(EcommerceDraft{}, model.EcommercePlan{UncertainFacts: []string{"材质", "容量"}}, page, 0); err != nil {
		t.Fatalf("generic unknown fields should not prevent creative planning: %v", err)
	}
}
