package app

import (
	"fmt"
	"strings"

	"yingce/backend/internal/model"
)

// These are plan-level signals and human review instructions, not image analysis.
func addEcommerceDetailReview(plan *model.EcommercePlan) {
	seen := map[string]int{}
	for i, page := range plan.Images {
		theme := strings.Join(strings.Fields(page.Theme), " ")
		composition := strings.Join(strings.Fields(page.Composition), " ")
		if theme == "" || composition == "" {
			continue
		}
		key := strings.ToLower(theme + "\x00" + composition)
		if first, ok := seen[key]; ok {
			plan.QualityChecks = append(plan.QualityChecks, fmt.Sprintf("策划检查：第 %d、%d 张主题和构图描述完全相同；建议重新区分购买问题、景别或版式后再生成。", first, i+1))
		} else {
			seen[key] = i + 1
		}
	}
	plan.QualityChecks = append(plan.QualityChecks,
		"生成后对照商品原图人工核对外形、颜色、Logo 和结构；有偏差时调整保真要求或参考图。",
		"生成后核对图中文字与已确认文案，检查乱码、错字、溢出和未经证实的功能、参数或认证；必要时精简文案并重新编辑。",
		"生成后对比各页，检查构图是否重复、视觉风格是否一致；必要时调整对应页面的分镜。")
}
