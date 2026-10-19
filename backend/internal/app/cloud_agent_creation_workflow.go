package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/prompts"
)

func cloudAgentCreationSkillRead(state *cloudAgentRuntime, call cloudAgentCall) {
	if state == nil || state.Request.Surface != "creation" || call.Function.Name != "skill_read_file" {
		return
	}
	var args struct {
		SkillID string `json:"skillId"`
		Path    string `json:"path"`
	}
	if json.Unmarshal([]byte(call.Function.Arguments), &args) == nil && args.SkillID == "commerce-visual-design" && args.Path == cloudAgentSkillEntryPath {
		state.CommerceToolsEnabled = true
	}
}

func cloudAgentLoadCreationWorkflow(state *cloudAgentRuntime, call cloudAgentCall) (any, error) {
	var args struct {
		Workflow string `json:"workflow"`
		Purpose  string `json:"purpose"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if state.Request.Surface != "creation" || args.Workflow != "commerce" || strings.TrimSpace(args.Purpose) == "" {
		return nil, &cloudAgentArgumentError{BadAuthRequest("请根据当前用户目标指定需要加载的创作工作流和用途")}
	}
	policy, err := prompts.LoadCreationCommercePolicy()
	if err != nil {
		return nil, err
	}
	state.CommerceToolsEnabled = true
	result := map[string]any{"workflow": args.Workflow, "version": policy.Version, "rules": policy.Text, "guidance": "对应工具在下一次模型请求可用。商品套图初次创作或整套重新规划用 commerce_plan_submit 保存完整方案并批量执行，按本轮意图设置 showImportantInfo 决定是否展示重要信息；auto 只省去审批等待，展示卡片不额外等待确认。单张明确修改及保留既有设计的简单批量编辑仍使用通用生成工具。加载本身不创建任务。"}
	for _, skill := range state.Skills {
		if skill.ID == "commerce-visual-design" {
			result["recommendedSkill"] = map[string]any{"skillId": skill.ID, "path": cloudAgentSkillEntryPath, "version": skill.Version}
			result["guidance"] = "先用 skill_read_file 读取 recommendedSkill 的完整设计方法；hasMore=true 时按 nextOffset 续读，已在本轮完整读取同版本则直接沿用。工作流摘要不能代替完整技能。" + result["guidance"].(string)
			break
		}
	}
	return result, nil
}

// Pi registers the complete executor contract once. Only the tools selected by
// the model are exposed to subsequent provider requests, without mutating that
// registry or enabling tools based on brittle prompt keyword matching.
func cloudAgentCreationModelTools(state *cloudAgentRuntime, tools []map[string]any) []map[string]any {
	if state.Request.Surface != "creation" || state.CommerceToolsEnabled {
		return tools
	}
	filtered := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		fn, _ := tool["function"].(map[string]any)
		switch stringField(fn, "name") {
		case "commerce_plan_submit", "commerce_plan_wait":
			continue
		case "generate_media":
			var copy map[string]any
			_ = decodeCloudAgentJSONObject(mustMarshal(tool), &copy)
			function := copy["function"].(map[string]any)
			function["description"] = "生成单项图片或视频。普通多图及保留既有设计的简单批量编辑使用 generate_image_batch，不逐张等待；商品套图初次创作或整套重新规划先加载商品创作工作流并提交完整方案。编辑先用 creation_media_read 精读原图，再将其 ID 传入 attachmentResourceIds，明确保留与修改内容。模型和手动参数由用户设置锁定；未知任务先查状态。"
			properties := function["parameters"].(map[string]any)["properties"].(map[string]any)
			for _, key := range []string{"commercePlanId", "commerceItemId", "retryFailedTaskId", "retryPrompt"} {
				delete(properties, key)
			}
			properties["prompt"] = map[string]any{"type": "string", "description": "完整创作提示词；编辑只修改指定部分，明确其他主体、位置与背景保持不变。引用顺序对应 @图片1、@图片2"}
			filtered = append(filtered, copy)
		default:
			filtered = append(filtered, tool)
		}
	}
	return filtered
}
