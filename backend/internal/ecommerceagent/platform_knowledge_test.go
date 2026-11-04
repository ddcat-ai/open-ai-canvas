package ecommerceagent

import (
	"strings"
	"testing"
)

func TestPlatformKnowledgeCoverageAndProvenance(t *testing.T) {
	if len(platformKnowledge.Profiles) != 36 {
		t.Fatalf("profiles=%d", len(platformKnowledge.Profiles))
	}
	seen := map[string]bool{}
	for _, p := range platformKnowledge.Profiles {
		if seen[p.ID] || p.Style == "" || p.Risk == "" || p.Scope == "" {
			t.Fatalf("invalid profile: %+v", p)
		}
		seen[p.ID] = true
		if p.ReviewStatus != "pending" && (len(p.Sources) == 0 || p.CheckedAt == "") {
			t.Fatalf("missing provenance: %s", p.ID)
		}
		if p.ReviewStatus == "pending" && len(p.OfficialRules) != 0 {
			t.Fatalf("unverified rules: %s", p.ID)
		}
		if runtime, ok := PlatformFor(p.ID); !ok || runtime.Label != p.Label {
			t.Fatalf("runtime platform %s does not match shared profile: %+v", p.ID, runtime)
		}
	}
	if _, ok := PlatformFor("unknown-market"); ok {
		t.Fatal("unknown platform became verified")
	}
}

func TestPlatformAssetRulesAndSheinAliases(t *testing.T) {
	for _, name := range []string{"shein", "SHEIN", "希音", "SHEIN（希音）"} {
		p, ok := PlatformFor(name)
		if !ok || !p.ForbidTextOnMain || p.WhiteBG || p.Ratio != "3:4" {
			t.Fatalf("%s: %+v", name, p)
		}
	}
	for _, tc := range []struct {
		platform, kind, purpose string
		want                    bool
	}{
		{"shein", "main", "", true}, {"shein", "secondary", "", false},
		{"ebay", "secondary", "", true}, {"tiktok", "detail", "", true},
		{"tiktok", "social", "", false}, {"tiktok", "single", "Banner", false},
		{"amazon", "secondary", "", false}, {"etsy", "main", "", false},
	} {
		if got := PlatformNoText(tc.platform, tc.kind, tc.purpose); got != tc.want {
			t.Fatalf("%+v got %v", tc, got)
		}
	}
	for _, id := range []string{"ebay", "mercado-libre", "shein"} {
		if ListingMainImage(id, "main", "") {
			t.Fatalf("%s inherited Amazon white background", id)
		}
	}
	if !strings.Contains(PlatformKnowledgePrompt("etsy", "", "main", ""), "未经编辑") {
		t.Fatal("lost Etsy real photo rule")
	}
}

func TestRestrictedListingPhrase(t *testing.T) {
	for _, text := range []string{"Best Seller", "Ｂｅｓｔ　Ｓｅｌｌｅｒ", "BEST-SELLER", "FDA\u200b Approved", "全 网 最 低"} {
		if RestrictedListingPhrase(text) == "" {
			t.Fatalf("missed %q", text)
		}
	}
	for _, text := range []string{"Soft lighting", "Everyday storage", "奶油色", "舒适日常穿搭", "Model No.10"} {
		if RestrictedListingPhrase(text) != "" {
			t.Fatalf("false positive %q", text)
		}
	}
}
