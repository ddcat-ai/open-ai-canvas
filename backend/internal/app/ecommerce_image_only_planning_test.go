package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
)

func TestImageOnlyDetailPlanningUsesObservedCategoryAndPreservesNinePages(t *testing.T) {
	for _, tc := range []struct{ category, profile string }{{"奶瓶", "母婴"}, {"耳机", "数码"}, {"未知商品", "索引"}} {
		t.Run(tc.category, func(t *testing.T) {
			svc, db := mockEcommerceAgentService(t)
			if err := db.AutoMigrate(&model.EcommerceCreativeRecommendation{}); err != nil {
				t.Fatal(err)
			}
			project, err := svc.CreateEcommerceProject("owner")
			if err != nil {
				t.Fatal(err)
			}
			draft := EcommerceDraft{ImageType: "detail", Count: 9, Platform: "taobao", Language: "zh-CN", ImageModel: "selected", Ratio: "3:4", Resolution: "2k", References: []EcommerceReference{{ResourceID: "product", Role: "primary"}}}
			p := ecommerceWorkbenchPlatform(draft)
			brief := ecommerceagent.Brief{Category: tc.category}
			directions, err := svc.storeEcommerceWorkbenchDirections("owner", project.ID, draft, ecommerceagent.Analysis{Brief: brief, Recommendations: ecommerceagent.MockStyleRecommendations(brief, p, "detail", 9, "3:4")})
			if err != nil {
				t.Fatal(err)
			}
			selected, err := svc.SelectEcommerceCreativeDirection("owner", directions.RecommendationID, directions.Directions[1].ID)
			if err != nil {
				t.Fatal(err)
			}
			draft.CreativeRecommendationID, draft.CreativeDirectionID = selected.RecommendationID, selected.DirectionID
			raw, _ := json.Marshal(draft)
			if err := db.Model(project).Update("draft_json", string(raw)).Error; err != nil {
				t.Fatal(err)
			}
			input := map[string]any{"mode": "text", "metadata": map[string]any{"source": "ecommerce-agent", "stage": "planning", "ecommerceProjectId": project.ID}}
			prompt, err := svc.prepareEcommerceWorkbenchTask("owner", input, "输出工作台 JSON")
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(prompt, "品类营销方法"+map[bool]string{true: "索引", false: "：" + tc.profile}[tc.profile == "索引"]) || !strings.Contains(prompt, ecommerceagent.WorkbenchDetailPlanningMethod) {
				t.Fatalf("observed category or image-only method missing: %s", prompt)
			}
			plan := model.EcommercePlan{ProductSummary: tc.category + "可见轮廓", VisualStrategy: "暖色柔光，统一字体", ConfirmedFacts: []string{}, UncertainFacts: []string{}, QualityChecks: []string{}}
			for i := 1; i <= 9; i++ {
				angle := "可见设计｜围绕可见结构说明实际操作关系，不推断性能结果"
				if i%2 == 0 {
					angle = "场景体验｜以不同生活场景回应日常选择，不承诺未证实效果"
				}
				composition := fmt.Sprintf("不同机位构图%d", i)
				if i <= 2 {
					composition = fmt.Sprintf("可见局部微距特写%d", i)
				}
				plan.Images = append(plan.Images, model.EcommercePlanTask{ID: fmt.Sprintf("image-%d", i), ImageType: "detail", Goal: fmt.Sprintf("目标%d", i), Theme: fmt.Sprintf("主题%d", i), Composition: composition, MainVisual: "可见商品", PerformanceAngle: angle, InformationComponent: "标题导语｜左上标题与短说明，采用两级字号和24px安全边距", Fidelity: "保留颜色轮廓", Prompt: fmt.Sprintf("逐页摄影任务%d", i), Copy: fmt.Sprintf("原创主题%d", i)})
			}
			raw, _ = json.Marshal(plan)
			result := map[string]any{"text": string(raw)}
			metadata := input["metadata"].(map[string]any)
			if err := svc.validateEcommerceWorkbenchResult("owner", canvasGenerationInput{Metadata: metadata}, result); err != nil {
				t.Fatal(err)
			}
			var got model.EcommercePlan
			if err := json.Unmarshal([]byte(stringValue(result["text"])), &got); err != nil {
				t.Fatal(err)
			}
			if len(got.Images) != 9 || len(got.UncertainFacts) != 0 || got.Images[8].Copy != "原创主题9" || !strings.Contains(got.Images[8].Prompt, ecommerceProductAnchor) {
				t.Fatalf("bad output: %+v", got)
			}
			t.Setenv("AI_MODE", "disabled")
			legacyInput := map[string]any{"mode": "text", "metadata": map[string]any{"source": "ecommerce-agent", "stage": "planning", "ecommerceProjectId": project.ID}}
			legacy, err := svc.prepareEcommerceWorkbenchTask("owner", legacyInput, "原有工作台合同")
			if err != nil || !strings.Contains(legacy, ecommerceagent.MarketingKnowledge(tc.category)) || !strings.Contains(legacy, "原有工作台合同") {
				t.Fatalf("legacy task lost category or contract: %v", err)
			}
			if legacyInput["metadata"].(map[string]any)["ecommerceAgentAdapter"] != nil {
				t.Fatal("legacy task unexpectedly enabled the adapter")
			}
		})
	}
}
