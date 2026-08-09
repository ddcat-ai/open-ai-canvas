package service

import (
	"encoding/json"
	"fmt"
	"strings"
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
	countRule := "镜头数量由模型按剧情节奏自动决定。"
	if shotCount >= 1 && shotCount <= 10 {
		countRule = fmt.Sprintf("shots 数组必须严格输出 %d 个镜头。", shotCount)
	}
	return map[string]string{
		"项目名称": projectStyle.Title, "剧情": strings.TrimSpace(brief), "用户要求": strings.TrimSpace(requirements),
		"画布资产": string(assetJSON), "项目画风": styleText, "角色版本": string(characterJSON),
		"单镜头时长规则": durationRule, "镜头数量规则": countRule,
	}
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
	return `你是影视分镜导演和 AI 视频提示词专家。先理解故事目标、人物动机、冲突、情绪曲线和结尾，再把剧情转译为可执行、可拍摄的连续镜头，不要把剧情段落直接改写成镜头摘要。

每个镜头先确定观众此刻跟随谁，再明确 narrativeIntent、viewerPOV 和 performanceBlocking，然后选择景别、机位、焦段、构图和运镜。摄影机设计必须说明叙事动机，不得用术语数量代替导演判断；一个镜头只保留一个主运镜，必须有起点、动机和停止点，并为人物表演让出注意力。

大远景只承担空间、规模和处境建立；人物对白与喜剧反应优先使用中景、近景、过肩或独立反应镜头。按叙事需要使用反应、停顿、空镜、插入和匹配剪辑，避免每镜都推进、环绕、航拍或慢动作。

description 只写可见画面与动作；把“意识到、回忆起、感到”等不可见信息转译成眼神、停顿、手部动作、走位、道具反应或环境变化。visualPrompt 明确人物左右位置、视线、前中后景、遮挡、视觉焦点、可信光源、材质和色彩；videoPrompt 只补充主体运动、环境运动和结尾状态。

保持角色五官、年龄、发型、服装、道具、损伤位置、空间关系和项目媒介一致。视觉媒介、光线和材质严格服从项目画风，不得默认改写为真人摄影，也不得把 3D、动画或卡通项目强制改成写实。负面要求必须针对当前镜头的换脸、服装变化、手部错误、乱码、闪烁、穿模、风格突变和动作僵硬风险。`
}

// 保留为纯函数，供分镜校验测试验证受保护契约不会被模板或用户定制覆盖。
func storyboardCinematicQualityContract(shotDuration int, shotCount int) string {
	values := storyboardPromptValues("", "", nil, storyboardProjectStyle{}, nil, shotDuration, shotCount)
	return defaultStoryboardPromptTemplate() + "\n\n" + storyboardExecutionContract(values["单镜头时长规则"], values["镜头数量规则"])
}
