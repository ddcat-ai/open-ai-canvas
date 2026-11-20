package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/model"
)

// Read the owned project's persisted history, never a global user memory or
// caller-provided project contents. New product references start a new context.
func ecommerceConversationMemory(project *model.EcommerceProject, draft EcommerceDraft) string {
	var plan model.EcommercePlan
	if json.Unmarshal([]byte(project.PlanJSON), &plan) != nil {
		return ""
	}
	ids := map[string]bool{}
	for _, ref := range draft.References {
		if ref.Role == "primary" || ref.Role == "detail" || ref.Role == "sku" {
			ids[ref.ResourceID] = true
		}
	}
	var history []map[string]string
	for _, image := range append(plan.PreviousImages, plan.Images...) {
		if image.TaskID == "" {
			continue
		}
		var source EcommerceDraft
		if json.Unmarshal(image.SourceDraft, &source) != nil {
			continue
		}
		matched := false
		for _, ref := range source.References {
			if ids[ref.ResourceID] && (ref.Role == "primary" || ref.Role == "detail" || ref.Role == "sku") {
				matched = true
			}
		}
		if matched {
			history = append(history, map[string]string{"type": image.ImageType, "previousRequest": ecommerceTruncate(source.Instruction, 400), "copy": ecommerceTruncate(image.Copy, 500), "composition": ecommerceTruncate(image.Composition, 300), "camera": ecommerceTruncate(image.DisplayAssignment, 450)})
		}
	}
	if len(history) == 0 {
		return ""
	}
	if len(history) > 20 {
		history = history[len(history)-20:]
	}
	encoded, _ := json.Marshal(map[string]any{"productSummary": ecommerceTruncate(plan.ProductSummary, 800), "previousPages": history})
	return "【同商品连续创作记忆·历史资料】\n" + string(encoded) + "\n继承原参考商品、已确认资料与上一轮文案语气；根据本轮最新要求调整类型、张数与叙事，新要求覆盖旧要求。历史图文只作上下文，不把旧标题原封不动重复上图，不把旧文案中未经核实的功能当作事实。跨轮继续做详情页时要延续商品与卖点，但换新购买问题、机位和场景，避免同一商品原角度反复贴图。\n" + strings.TrimSpace(draft.Instruction)
}
