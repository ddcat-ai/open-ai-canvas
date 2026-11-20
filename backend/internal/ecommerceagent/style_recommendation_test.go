package ecommerceagent

import (
	"strings"
	"testing"
)

func TestStyleRecommendationFollowsContentTypeAndProduct(t *testing.T) {
	p, _ := PlatformFor("淘宝")
	for _, tc := range []struct {
		kind   string
		count  int
		marker string
	}{{"detail", 10, "整套连续详情页"}, {"set", 8, "整组不同用途"}, {"white", 1, "纯白底商品图"}, {"single", 1, "单张成品"}, {"marketing", 4, "物料配置"}} {
		t.Run(tc.kind, func(t *testing.T) {
			brief := Brief{Category: "蓝色头戴耳机", Colorway: []string{"蓝色"}, Structure: []string{"弧形头梁"}}
			prompt := BuildStyleRecommendPrompt(brief, p, "zh-CN", tc.kind, tc.count, "3:4", "product", map[string]any{"typeOptions": map[string]string{"purpose": "Banner"}, "claims": "仅有卖家确认资料"})
			for _, required := range []string{tc.marker, "蓝色", "弧形头梁", "3:4", "Banner", "仅有卖家确认资料"} {
				if !strings.Contains(prompt, required) {
					t.Fatalf("prompt lost %q", required)
				}
			}
			result := MockStyleRecommendations(brief, p, tc.kind, tc.count, "3:4")
			if len(result) != 4 {
				t.Fatal("workbench requires exactly four choices")
			}
			seen := map[string]bool{}
			for _, r := range result {
				if !CompleteStyleRecommendation(r) || r.Pages != tc.count || r.AspectRatio != "3:4" || seen[r.Label] {
					t.Fatalf("incomplete/duplicate style: %+v", r)
				}
				seen[r.Label] = true
				if tc.kind == "white" && (r.NeedText || r.VisualSystem.Scene != "纯白色摄影棚" || r.VisualSystem.Palette[0] != "纯白背景") {
					t.Fatalf("white type constraint lost: %+v", r)
				}
			}
		})
	}
	earphones := MockStyleRecommendations(Brief{Category: "耳机"}, p, "detail", 10, "3:4")
	cups := MockStyleRecommendations(Brief{Category: "杯壶"}, p, "detail", 10, "3:4")
	if earphones[0].Label == cups[0].Label {
		t.Fatal("product categories reused identical style labels")
	}
	if CompleteStyleRecommendation(Recommendation{Label: "接口导览", Style: "侧拍", Why: "展示接口"}) {
		t.Fatal("single shot passed as a complete visual system")
	}
}
