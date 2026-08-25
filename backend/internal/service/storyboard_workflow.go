package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
)

func (s *Service) processAgentStoryboardTask(ctx context.Context, task model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	input, err := parseStoryboardTaskInput(task, "Agent 会话")
	if err != nil {
		return nil, nil, err
	}
	plan, assets, err := s.generateStoryboardPlan(ctx, task, input, 0, 0)
	if err != nil {
		return nil, nil, err
	}
	return s.buildAgentStoryboardResult(task, plan, assets, input.ProjectStyle)
}

func (s *Service) processStoryboardRowsTask(ctx context.Context, task model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	input, err := parseStoryboardTaskInput(task, "脚本任务")
	if err != nil {
		return nil, nil, err
	}
	plan, _, err := s.generateStoryboardPlan(ctx, task, input, input.ShotDuration, input.ShotCount)
	if err != nil {
		return nil, nil, err
	}

	rows := make([]map[string]any, 0, len(plan.Shots))
	for index, shot := range plan.Shots {
		imagePromptVariables := storyboardImagePromptValues(input.ProjectStyle.Prompt, plan.StyleGuide, shot)
		videoPromptVariables := storyboardVideoPromptValues(input.ProjectStyle.Prompt, plan.StyleGuide, shot)
		imagePrompt, promptErr := s.compileStoryboardImagePrompt(task.UserID, input.ProjectStyle.Prompt, plan.StyleGuide, shot)
		if promptErr != nil {
			return nil, nil, promptErr
		}
		videoPrompt, promptErr := s.compileStoryboardVideoPrompt(task.UserID, input.ProjectStyle.Prompt, plan.StyleGuide, shot)
		if promptErr != nil {
			return nil, nil, promptErr
		}
		rows = append(rows, map[string]any{
			"shotNumber": index + 1, "durationSeconds": shot.Duration, "plotDescription": shot.Description,
			"dialogue": shot.Dialogue, "characters": storyboardRowCharacters(shot, input.Characters), "shotSize": shot.ShotSize, "emotion": shot.Emotion,
			"lightingAndAtmosphere": shot.Lighting, "audioEffects": shot.AudioEffects,
			"imageGenerationPrompt": imagePrompt, "videoMotionPrompt": videoPrompt,
			"imagePromptTemplateVariables": imagePromptVariables, "videoPromptTemplateVariables": videoPromptVariables,
			"camera": shot.Camera, "motion": shot.Motion, "timeBeats": shot.TimeBeats, "negativePrompt": shot.Negative,
			"narrativeIntent": shot.Intent, "viewerPOV": shot.ViewerPOV, "performanceBlocking": shot.Performance,
			"mustHave": shot.MustHave, "optionalDetails": shot.Optional, "continuityOut": shot.ContinuityOut,
			"assetBindings": shot.AssetRefs,
		})
	}
	return map[string]interface{}{"title": plan.Title, "rows": rows}, nil, nil
}

const maxStoryboardRepairAttempts = 2

func (s *Service) repairStoryboardPlan(ctx context.Context, task model.Task, input agentStoryboardInput, config providerConfig, originalText string, validationErr error, shotDuration int, shotCount int) (agentStoryboardPlan, error) {
	currentText := originalText
	currentErr := validationErr
	for attempt := 1; attempt <= maxStoryboardRepairAttempts; attempt++ {
		if err := s.repo.UpdateTaskProgress(task.ID, "修复分镜结构", 55+attempt*10); err != nil {
			return agentStoryboardPlan{}, fmt.Errorf("更新分镜修复进度失败，上游修复请求未发出：%w", err)
		}
		repairPrompt, promptErr := s.buildStoryboardRepairPrompt(task.UserID, task.Prompt, currentErr, input, currentText)
		if promptErr != nil {
			return agentStoryboardPlan{}, promptErr
		}
		repaired, repairErr := runTextTask(withProviderRequestKind(ctx, "repair"), canvasGenerationInput{Mode: "text", Prompt: repairPrompt, Config: config, StreamText: true})
		if repairErr != nil {
			return agentStoryboardPlan{}, fmt.Errorf("分镜结构修复失败：%w", repairErr)
		}
		repairedText, _ := repaired["text"].(string)
		plan, parseErr := parseAgentStoryboardPlan(repairedText)
		if parseErr == nil {
			normalizeAutomaticStoryboardDurations(&plan, shotDuration)
			parseErr = validateStoryboardPlan(plan, shotDuration, shotCount, input.Characters, input.CanvasAssets)
		}
		if parseErr == nil {
			return plan, nil
		}
		currentText = repairedText
		currentErr = parseErr
	}
	return agentStoryboardPlan{}, fmt.Errorf("分镜模型结构修复后仍不合法：%w", currentErr)
}

func providerConfigReady(config providerConfig) bool {
	return strings.TrimSpace(config.Model) != "" && (strings.TrimSpace(config.ChannelID) != "" || (strings.TrimSpace(config.BaseURL) != "" && strings.TrimSpace(config.APIKey) != ""))
}

func parseStoryboardTaskInput(task model.Task, label string) (agentStoryboardInput, error) {
	input := agentStoryboardInput{}
	if strings.TrimSpace(task.InputJSON) == "" {
		return input, nil
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return agentStoryboardInput{}, fmt.Errorf("%s输入解析失败：%w", label, err)
	}
	return input, nil
}

func (s *Service) generateStoryboardPlan(ctx context.Context, task model.Task, input agentStoryboardInput, shotDuration int, shotCount int) (agentStoryboardPlan, []storyboardAsset, error) {
	ctx = withProtocolRegistry(ctx, s.protocolRegistry())
	if !providerConfigReady(input.Config) {
		return agentStoryboardPlan{}, nil, errors.New("请先配置可用的文本模型")
	}
	if err := validateStoryboardContext(input.ProjectStyle, input.Characters); err != nil {
		return agentStoryboardPlan{}, nil, err
	}
	assets := normalizeStoryboardAssets(input.CanvasAssets)
	if len(assets) == 0 {
		assets = normalizeStoryboardAssets(extractStoryboardAssets(input.CanvasSnapshot))
	}
	input.CanvasAssets = assets
	config, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return agentStoryboardPlan{}, nil, err
	}
	ctx = withProviderOutboundPolicy(ctx, config)
	plannerPrompt, err := s.buildAgentStoryboardPlannerPrompt(task.UserID, task.Prompt, input.Requirements, assets, input.ProjectStyle, input.Characters, shotDuration, shotCount)
	if err != nil {
		return agentStoryboardPlan{}, nil, err
	}
	result, err := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: plannerPrompt, Config: config, StreamText: true})
	if err != nil {
		return agentStoryboardPlan{}, nil, err
	}
	text, _ := result["text"].(string)
	plan, err := parseAgentStoryboardPlan(text)
	if err == nil {
		normalizeAutomaticStoryboardDurations(&plan, shotDuration)
		err = validateStoryboardPlan(plan, shotDuration, shotCount, input.Characters, assets)
	}
	if err != nil {
		plan, err = s.repairStoryboardPlan(ctx, task, input, config, text, err, shotDuration, shotCount)
		if err != nil {
			return agentStoryboardPlan{}, nil, err
		}
	}
	if complexityErr := validateStoryboardComplexity(plan); complexityErr != nil {
		_ = s.log(task.UserID, task.ID, "warn", "分镜复杂度建议", complexityErr.Error())
	}
	return plan, assets, nil
}

func (s *Service) buildAgentStoryboardResult(task model.Task, plan agentStoryboardPlan, assets []storyboardAsset, projectStyle storyboardProjectStyle) (map[string]interface{}, []map[string]interface{}, error) {
	prefix := "agent-" + task.ID
	scriptID := prefix + "-script"
	sceneID := prefix + "-scenes"
	styleID := prefix + "-style"
	referenceID := prefix + "-assets"
	finalID := prefix + "-final"
	sceneX := 380
	styleX := sceneX + 380
	ops := []map[string]any{
		nodeOpWithMetadata(scriptID, "text", "剧本 · "+shortTitle(plan.Title, 24), 0, 0, map[string]any{"workflowKind": "script", "workflowTitle": "剧本", "status": "success", "content": strings.Join([]string{plan.Title, "", plan.Logline, "", task.Prompt}, "\n")}),
		nodeOpWithMetadata(sceneID, "text", "场景设定", sceneX, 0, map[string]any{"workflowKind": "scene", "workflowTitle": "场景", "status": "success", "content": listContent("场景", plan.Locations)}),
		nodeOpWithMetadata(styleID, "text", "项目画风 · "+shortTitle(projectStyle.Title, 24), styleX, 0, map[string]any{"workflowKind": "styleboard", "workflowTitle": "项目画风", "workflowDescription": plan.StyleGuide, "stylePresetId": projectStyle.PresetID, "styleProfileJson": projectStyle.ProfileJSON, "status": "success", "content": projectStyle.Prompt, "prompt": projectStyle.Prompt}),
		nodeOpWithMetadata(referenceID, "text", "参考素材组", 0, 270, map[string]any{"workflowKind": "reference_set", "workflowTitle": "参考素材组", "status": "success", "content": storyboardAssetsContent(assets)}),
		nodeOpWithMetadata(finalID, "video", "成片 · 待生成", styleX, 270, map[string]any{"workflowKind": "final", "workflowTitle": "成片", "status": "idle"}),
		connectOp(scriptID, sceneID),
	}
	resultShots := make([]map[string]any, 0, len(plan.Shots))
	for index, shot := range plan.Shots {
		videoPrompt, err := s.compileStoryboardVideoPrompt(task.UserID, projectStyle.Prompt, plan.StyleGuide, shot)
		if err != nil {
			return nil, nil, err
		}
		shotID := fmt.Sprintf("%s-shot-%d", prefix, index+1)
		matchedAssets := resolveStoryboardAssets(assets, shot.AssetRefs)
		assetIDs := make([]string, 0, len(matchedAssets))
		for _, asset := range matchedAssets {
			assetIDs = append(assetIDs, asset.ID)
		}
		ops = append(ops,
			nodeOpWithMetadata(shotID, "video", fmt.Sprintf("镜头 %d · %s", index+1, shortTitle(shot.Title, 18)), index*360, 560, map[string]any{
				"workflowKind":          "shot",
				"workflowTitle":         shot.Title,
				"workflowDescription":   shotDescription(shot),
				"shotIndex":             index + 1,
				"generationMode":        "video",
				"prompt":                videoPrompt,
				"composerContent":       shotComposerContent(videoPrompt, matchedAssets),
				"videoEditOperation":    "text_to_video",
				"assetBindings":         shot.AssetRefs,
				"referenceAssetNodeIds": assetIDs,
				"status":                "idle",
			}),
			connectOp(scriptID, shotID),
			connectOp(shotID, finalID),
		)
		for _, asset := range matchedAssets {
			ops = append(ops, connectOp(asset.ID, shotID))
		}
		resultShots = append(resultShots, map[string]any{"title": shot.Title, "description": shot.Description, "assetBindings": shot.AssetRefs, "referenceAssetNodeIds": assetIDs})
	}
	ops = append(ops, map[string]any{"type": "select_nodes", "ids": shotIDs(prefix, len(plan.Shots))})
	result := map[string]any{
		"taskId":     task.ID,
		"operation":  task.Operation,
		"provider":   defaultString(task.Provider, "internal-agent"),
		"model":      defaultString(task.Model, "workflow-router"),
		"title":      plan.Title,
		"logline":    plan.Logline,
		"styleGuide": plan.StyleGuide,
		"characters": plan.Characters,
		"locations":  plan.Locations,
		"shots":      resultShots,
	}
	return result, ops, nil
}

func (s *Service) compileStoryboardImagePrompt(userID string, projectStyle string, styleGuide string, shot agentStoryboardShot) (string, error) {
	compiled, err := s.compilePrompt(userID, promptOperationStoryboardFirstFrame, storyboardImagePromptValues(projectStyle, styleGuide, shot))
	return compiled.Content, err
}

func (s *Service) compileStoryboardVideoPrompt(userID string, projectStyle string, styleGuide string, shot agentStoryboardShot) (string, error) {
	compiled, err := s.compilePrompt(userID, promptOperationStoryboardVideo, storyboardVideoPromptValues(projectStyle, styleGuide, shot))
	return compiled.Content, err
}
