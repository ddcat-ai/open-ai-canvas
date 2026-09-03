package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

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
	semanticShots, err := s.persistAgentStoryboardShots(task, input, plan)
	if err != nil {
		return nil, nil, err
	}
	return s.buildAgentStoryboardResult(task, plan, assets, input.ProjectStyle, semanticShots)
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

const (
	maxStoryboardRepairAttempts = 1
	storyboardRepairMaxDuration = 4 * time.Minute
	storyboardFinalizeReserve   = 30 * time.Second
	storyboardMinimumRepairTime = 90 * time.Second
)

func (s *Service) repairStoryboardPlan(ctx context.Context, task model.Task, input agentStoryboardInput, config providerConfig, originalText string, validationErr error, shotDuration int, shotCount int) (agentStoryboardPlan, error) {
	currentText := originalText
	currentErr := validationErr
	for attempt := 1; attempt <= maxStoryboardRepairAttempts; attempt++ {
		_ = s.log(task.UserID, task.ID, "warn", "分镜结构校验失败", fmt.Sprintf("第 %d 次修复前：%s", attempt, currentErr.Error()))
		if err := s.repo.UpdateTaskProgress(task.ID, "修复分镜结构", 55+attempt*10); err != nil {
			return agentStoryboardPlan{}, fmt.Errorf("更新分镜修复进度失败，上游修复请求未发出：%w", err)
		}
		repairPrompt, promptErr := s.buildStoryboardRepairPrompt(task.UserID, task.Prompt, currentErr, input, currentText)
		if promptErr != nil {
			return agentStoryboardPlan{}, promptErr
		}
		repairCtx, cancel, budgetErr := storyboardRepairContext(ctx)
		if budgetErr != nil {
			return agentStoryboardPlan{}, budgetErr
		}
		repaired, repairErr := runTextTask(withProviderRequestKind(repairCtx, "repair"), canvasGenerationInput{Mode: "text", Prompt: repairPrompt, Config: config, StreamText: true, MaxOutputTokens: storyboardOutputTokenLimit(shotCount)})
		cancel()
		if repairErr != nil {
			return agentStoryboardPlan{}, fmt.Errorf("分镜结构修复失败：%w", repairErr)
		}
		repairedText, _ := repaired["text"].(string)
		plan, parseErr := parseAgentStoryboardPlan(repairedText)
		if parseErr == nil {
			normalizeAutomaticStoryboardDurations(&plan, shotDuration)
			parseErr = validateStoryboardPlan(&plan, shotDuration, shotCount, input.Characters, input.CanvasAssets)
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
	result, err := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: plannerPrompt, Config: config, StreamText: true, MaxOutputTokens: storyboardOutputTokenLimit(shotCount)})
	if err != nil {
		return agentStoryboardPlan{}, nil, err
	}
	text, _ := result["text"].(string)
	plan, err := parseAgentStoryboardPlan(text)
	if err == nil {
		normalizeAutomaticStoryboardDurations(&plan, shotDuration)
		err = validateStoryboardPlan(&plan, shotDuration, shotCount, input.Characters, assets)
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

func storyboardRepairContext(ctx context.Context) (context.Context, context.CancelFunc, error) {
	deadline, ok := ctx.Deadline()
	if !ok {
		repairCtx, cancel := context.WithTimeout(ctx, storyboardRepairMaxDuration)
		return repairCtx, cancel, nil
	}
	remaining := time.Until(deadline)
	if remaining <= storyboardFinalizeReserve+storyboardMinimumRepairTime {
		return nil, nil, fmt.Errorf("分镜结构校验失败，但任务剩余时间不足以安全修复：剩余 %s", remaining.Round(time.Second))
	}
	repairDuration := min(storyboardRepairMaxDuration, remaining-storyboardFinalizeReserve)
	repairCtx, cancel := context.WithTimeout(ctx, repairDuration)
	return repairCtx, cancel, nil
}

type agentStoryboardSemanticShot struct {
	ShotID          string
	DomainProjectID string
	UnitID          string
	ImagePrompt     string
	VideoPrompt     string
}

func (s *Service) persistAgentStoryboardShots(task model.Task, input agentStoryboardInput, plan agentStoryboardPlan) ([]agentStoryboardSemanticShot, error) {
	domainProjectID := strings.TrimSpace(input.DomainProjectID)
	if domainProjectID == "" {
		return nil, nil
	}
	if _, err := s.activeProjectForUser(task.UserID, domainProjectID); err != nil {
		return nil, err
	}

	unitID := strings.TrimSpace(input.UnitID)
	if unitID == "" {
		links, err := s.repo.ProjectCanvasUnitLinks(domainProjectID)
		if err != nil {
			return nil, err
		}
		seen := make(map[string]struct{})
		for _, link := range links {
			if link.CanvasID == task.ProjectID && strings.TrimSpace(link.UnitID) != "" {
				seen[link.UnitID] = struct{}{}
			}
		}
		if len(seen) != 1 {
			return nil, BadAuthRequest("请先将当前画布关联到一个章节后再生成分镜")
		}
		for id := range seen {
			unitID = id
		}
	}
	if _, err := s.repo.ProjectUnit(domainProjectID, unitID); err != nil {
		return nil, err
	}

	now := time.Now()
	shots := make([]model.Shot, 0, len(plan.Shots))
	revisions := make([]model.ShotRevision, 0, len(plan.Shots))
	semanticShots := make([]agentStoryboardSemanticShot, 0, len(plan.Shots))
	for index, shot := range plan.Shots {
		imagePrompt, err := s.compileStoryboardImagePrompt(task.UserID, input.ProjectStyle.Prompt, plan.StyleGuide, shot)
		if err != nil {
			return nil, err
		}
		videoPrompt, err := s.compileStoryboardVideoPrompt(task.UserID, input.ProjectStyle.Prompt, plan.StyleGuide, shot)
		if err != nil {
			return nil, err
		}
		shotID := newID()
		durationMs := int64(shot.Duration) * 1000
		actionBeats, err := json.Marshal([]map[string]any{{
			"timeBeats": shot.TimeBeats, "mustHave": shot.MustHave, "optionalDetails": shot.Optional,
		}})
		if err != nil {
			return nil, fmt.Errorf("序列化镜头动作节拍失败：%w", err)
		}
		revision := model.ShotRevision{
			ID: newID(), ShotID: shotID, Version: 1, PlotDescription: strings.TrimSpace(shot.Description),
			Action: strings.TrimSpace(shot.Performance), Dialogue: strings.TrimSpace(shot.Dialogue), ShotSize: strings.TrimSpace(shot.ShotSize),
			CameraAngle: strings.TrimSpace(shot.Camera), CameraMovement: strings.TrimSpace(shot.Motion), DurationMs: durationMs,
			ImagePrompt: imagePrompt, VideoPrompt: videoPrompt, NegativePrompt: strings.TrimSpace(shot.Negative),
			ContinuityNotes: strings.TrimSpace(shot.ContinuityOut), ActionBeatsJSON: string(actionBeats), CreatedBy: task.UserID, CreatedAt: now,
		}
		shots = append(shots, model.Shot{
			ID: shotID, ProjectID: domainProjectID, UnitID: unitID, CurrentRevisionID: revision.ID,
			Title: strings.TrimSpace(shot.Title), Description: revision.PlotDescription, Position: index, DurationMs: durationMs,
			Status: "draft", CreatedAt: now, UpdatedAt: now,
		})
		revisions = append(revisions, revision)
		semanticShots = append(semanticShots, agentStoryboardSemanticShot{ShotID: shotID, DomainProjectID: domainProjectID, UnitID: unitID, ImagePrompt: imagePrompt, VideoPrompt: videoPrompt})
	}
	if err := s.repo.CreateProjectShotsWithRevisions(domainProjectID, unitID, shots, revisions); err != nil {
		return nil, err
	}
	return semanticShots, nil
}

func (s *Service) buildAgentStoryboardResult(task model.Task, plan agentStoryboardPlan, assets []storyboardAsset, projectStyle storyboardProjectStyle, semanticShots []agentStoryboardSemanticShot) (map[string]interface{}, []map[string]interface{}, error) {
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
		videoPrompt := ""
		if index < len(semanticShots) {
			videoPrompt = semanticShots[index].VideoPrompt
		} else {
			var err error
			videoPrompt, err = s.compileStoryboardVideoPrompt(task.UserID, projectStyle.Prompt, plan.StyleGuide, shot)
			if err != nil {
				return nil, nil, err
			}
		}
		canvasShotID := fmt.Sprintf("%s-shot-%d", prefix, index+1)
		matchedAssets := resolveStoryboardAssets(assets, shot.AssetRefs)
		assetIDs := make([]string, 0, len(matchedAssets))
		for _, asset := range matchedAssets {
			assetIDs = append(assetIDs, asset.ID)
		}
		metadata := map[string]any{
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
		}
		if index < len(semanticShots) {
			metadata["domainProjectId"] = semanticShots[index].DomainProjectID
			metadata["unitId"] = semanticShots[index].UnitID
			metadata["shotId"] = semanticShots[index].ShotID
			metadata["projectionKey"] = "shot:" + semanticShots[index].ShotID
			metadata["projectionVersion"] = 1
		}
		ops = append(ops,
			nodeOpWithMetadata(canvasShotID, "video", fmt.Sprintf("镜头 %d · %s", index+1, shortTitle(shot.Title, 18)), index*360, 560, metadata),
			connectOp(scriptID, canvasShotID),
			connectOp(canvasShotID, finalID),
		)
		for _, asset := range matchedAssets {
			ops = append(ops, connectOp(asset.ID, canvasShotID))
		}
		resultShot := map[string]any{"title": shot.Title, "description": shot.Description, "assetBindings": shot.AssetRefs, "referenceAssetNodeIds": assetIDs}
		if index < len(semanticShots) {
			resultShot["shotId"] = semanticShots[index].ShotID
		}
		resultShots = append(resultShots, resultShot)
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
	if len(semanticShots) > 0 {
		result["semanticPersistence"] = map[string]any{"persisted": true, "shotIds": semanticShotIDs(semanticShots)}
	}
	return result, ops, nil
}

func semanticShotIDs(shots []agentStoryboardSemanticShot) []string {
	ids := make([]string, 0, len(shots))
	for _, shot := range shots {
		ids = append(ids, shot.ShotID)
	}
	return ids
}

func (s *Service) compileStoryboardImagePrompt(userID string, projectStyle string, styleGuide string, shot agentStoryboardShot) (string, error) {
	compiled, err := s.compilePrompt(userID, promptOperationStoryboardFirstFrame, storyboardImagePromptValues(projectStyle, styleGuide, shot))
	return compiled.Content, err
}

func (s *Service) compileStoryboardVideoPrompt(userID string, projectStyle string, styleGuide string, shot agentStoryboardShot) (string, error) {
	compiled, err := s.compilePrompt(userID, promptOperationStoryboardVideo, storyboardVideoPromptValues(projectStyle, styleGuide, shot))
	return compiled.Content, err
}
