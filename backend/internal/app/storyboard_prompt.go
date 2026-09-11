package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/prompts"
)

func (s *Service) buildAgentStoryboardPlannerPrompt(userID string, brief string, requirements string, assets []storyboardAsset, projectStyle storyboardProjectStyle, characters []storyboardCharacterCard, shotDuration int, shotCount int) (string, error) {
	values := storyboardPromptValues(brief, requirements, assets, projectStyle, characters, shotDuration, shotCount)
	compiled, err := s.compilePrompt(userID, promptOperationStoryboardPlan, values)
	if err != nil {
		return "", err
	}
	return removeFixedMediaRestrictions(compiled.Content), nil
}

func (s *Service) buildStoryboardRepairPrompt(userID string, brief string, validationErr error, input agentStoryboardInput, original string) (string, error) {
	values := storyboardPromptValues(brief, input.Requirements, input.CanvasAssets, input.ProjectStyle, input.Characters, input.ShotDuration, input.ShotCount)
	values["校验错误"] = validationErr.Error()
	values["原始输出"] = original
	compiled, err := s.compilePrompt(userID, promptOperationStoryboardRepair, values)
	if err != nil {
		return "", err
	}
	return removeFixedMediaRestrictions(compiled.Content), nil
}

func storyboardPromptValues(brief string, requirements string, assets []storyboardAsset, projectStyle storyboardProjectStyle, characters []storyboardCharacterCard, shotDuration int, shotCount int) map[string]string {
	assetJSON, _ := json.MarshalIndent(assets, "", "  ")
	characterJSON, _ := json.MarshalIndent(characters, "", "  ")
	styleText := strings.TrimSpace(projectStyle.Prompt)
	if styleText == "" {
		styleText = "项目尚未设置画风；仅允许生成中性分镜草案，不得擅自指定视觉媒介。"
	}
	durationRule := "单个镜头时长由剧情节奏决定，必须是 1 到 60 秒的整数。"
	if shotDuration == 5 || shotDuration == 10 || shotDuration == 15 || shotDuration == 30 {
		durationRule = fmt.Sprintf("本次生成单个镜头时长必须严格等于 %d 秒。", shotDuration)
	}
	countRule := fmt.Sprintf("镜头数量由模型按剧情节奏自动决定，但 shots 数组必须为 1 到 %d 个镜头，并优先使用完整表达剧情所需的最少镜头数。", maxStoryboardShots)
	if shotCount >= 1 && shotCount <= 10 {
		countRule = fmt.Sprintf("shots 数组必须严格输出 %d 个镜头。", shotCount)
	}
	return map[string]string{
		"项目名称": projectStyle.Title, "剧情": strings.TrimSpace(brief), "用户要求": strings.TrimSpace(requirements),
		"画布资产": string(assetJSON), "项目画风": styleText, "角色版本": string(characterJSON),
		"单镜头时长规则": durationRule, "镜头数量规则": countRule,
	}
}

func storyboardOutputTokenLimit(shotCount int) int {
	if shotCount >= 1 && shotCount <= 10 {
		return min(12_000, 2_000+shotCount*800)
	}
	return 12_000
}

// 兼容历史模板中强制真人媒介的冲突规则；项目画风才是视觉媒介的唯一来源。
func removeFixedMediaRestrictions(template string) string {
	lines := strings.Split(template, "\n")
	filtered := lines[:0]
	for _, line := range lines {
		mentionsPrompt := strings.Contains(line, "visualPrompt") || strings.Contains(line, "videoPrompt")
		forbidsNonLiveAction := strings.Contains(line, "不要") || strings.Contains(line, "禁止") || strings.Contains(line, "不得")
		mentionsAnimation := strings.Contains(line, "3D") || strings.Contains(line, "三维") || strings.Contains(line, "动画") || strings.Contains(line, "卡通") || strings.Contains(line, "游戏CG")
		forcesLiveAction := strings.Contains(line, "默认使用真实电影") || strings.Contains(line, "统一使用真实电影") || strings.Contains(line, "必须使用真实电影")
		if (mentionsPrompt && forbidsNonLiveAction && mentionsAnimation) || forcesLiveAction {
			continue
		}
		filtered = append(filtered, line)
	}
	return strings.Join(filtered, "\n")
}

func defaultStoryboardPromptTemplate() string {
	return prompts.DefaultStoryboardPromptTemplate()
}

// 保留为纯函数，供分镜校验测试验证受保护契约不会被模板或用户定制覆盖。
func storyboardCinematicQualityContract(shotDuration int, shotCount int) string {
	values := storyboardPromptValues("", "", nil, storyboardProjectStyle{}, nil, shotDuration, shotCount)
	return defaultStoryboardPromptTemplate() + "\n\n" + storyboardExecutionContract(values["单镜头时长规则"], values["镜头数量规则"])
}
