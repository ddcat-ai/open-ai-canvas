// 组装交给 Agent 运行时的请求：工具清单、技能、画像、记忆、功能开关、权限与模型配置。
//
// 权限由服务端按画布归属计算后下发，运行时只能在这个范围内调用工具。

package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"path/filepath"
)

// EnhancedPiRequestParams 增强的 Pi 请求参数
type EnhancedPiRequestParams struct {
	UserID       string
	RunID        string
	CanvasID     string
	FocusNodeIDs []string
	Prompt       string
	SystemPrompt string
	ModelID      string
	RuntimeState *cloudAgentRuntime
	Canonical    *canonicalAgentRequest
	SessionFile  string
	SessionJSONL string
	SessionDir   string
}

// buildEnhancedPiRequest 构建增强的 Pi 请求（核心方法）
func (s *Service) buildEnhancedPiRequest(ctx context.Context, params EnhancedPiRequestParams) (cloudAgentPiProcessRequest, error) {
	slog.Debug("agent building request", "canvas", params.CanvasID)

	// 1. 构建工具列表（包括画布工具）
	tools := s.buildCompletePiTools(params.Canonical.Tools)

	// 2. 构建 Skills 配置
	skillPaths := s.buildSkillPaths(params.RuntimeState.Skills)
	enabledSkills := s.buildSkillManifests(params.RuntimeState.Skills)

	slog.Debug("agent enabled skills", "count", len(enabledSkills))

	// 3. 构建 Profile 配置
	profile := s.buildProfileConfig(params.RuntimeState.Profile)

	// 4. 构建 Memory 配置
	memory := s.buildMemoryConfig(params.UserID, params.CanvasID)

	// 5. 构建画布智能上下文（核心创新）
	canvasIntelligence := s.NewCanvasIntelligence()
	enhancedCanvas, err := canvasIntelligence.BuildEnhancedCanvasContext(ctx, params.UserID, params.CanvasID, params.FocusNodeIDs)
	if err != nil {
		return cloudAgentPiProcessRequest{}, fmt.Errorf("build canvas intelligence: %w", err)
	}

	canvasData, err := s.marshalEnhancedCanvas(enhancedCanvas)
	if err != nil {
		return cloudAgentPiProcessRequest{}, fmt.Errorf("marshal canvas: %w", err)
	}

	slog.Debug("agent canvas intelligence", "nodes",
		enhancedCanvas.Snapshot.TotalNodes,
		"focus", len(enhancedCanvas.Snapshot.FocusNodes),
		"relationships", len(enhancedCanvas.Snapshot.Relationships),
		"clusters", len(enhancedCanvas.Snapshot.Layout.Clusters))

	// 6. 构建 Features 配置
	features := s.buildFeaturesConfig(params.RuntimeState)

	// 7. 构建压缩策略
	compaction := s.buildCompactionStrategy(params.UserID, params.CanvasID)

	// 8. 构建权限配置
	permissions := s.buildPermissionsConfig(params.UserID, params.CanvasID)

	// 9. 构建模型配置
	modelConfig := s.buildModelConfig(params.ModelID, params.RuntimeState)

	// 10. 组装完整请求
	request := cloudAgentPiProcessRequest{
		// 会话信息
		SessionFile:  params.SessionFile,
		SessionJSONL: params.SessionJSONL,
		SessionDir:   params.SessionDir,
		Cwd:          s.dataDir,
		AgentDir:     params.SessionDir,

		// 标识信息
		SessionId: params.RunID,
		UserId:    params.UserID,
		CanvasId:  params.CanvasID,
		RunId:     params.RunID,

		// 对话内容
		Prompt:       params.Prompt,
		SystemPrompt: params.SystemPrompt,

		// 核心增强：完整的上下文传递
		SkillPaths:    skillPaths,
		EnabledSkills: enabledSkills,
		Profile:       profile,
		Memory:        memory,
		Canvas:        canvasData,
		Features:      features,

		// 配置
		Tools:       tools,
		Compaction:  compaction,
		Permissions: permissions,
		Model:       modelConfig,
	}

	slog.Debug("agent request built", "canvas", params.CanvasID)
	return request, nil
}

// buildCompletePiTools 返回本轮授权的平台工具（与 Go 业务执行器同一份定义）。
func (s *Service) buildCompletePiTools(canonicalTools []map[string]interface{}) []map[string]any {
	return piToolDefinitions(canonicalTools)
}

// buildProfileConfig 构建 Profile 配置
func (s *Service) buildProfileConfig(profile cloudAgentProfileSnapshot) map[string]any {
	layers := make([]map[string]any, 0, len(profile.Layers))
	for i, layer := range profile.Layers {
		layers = append(layers, map[string]any{
			"scope":    layer.Scope,
			"content":  layer.Content,
			"priority": i,
			"hash":     hashContentSHA256(layer.Content),
		})
	}

	return map[string]any{
		"revision": profile.Revision,
		"hash":     profile.Hash,
		"layers":   layers,
		"enabled":  true,
	}
}

// buildMemoryConfig 构建 Memory 配置
func (s *Service) buildMemoryConfig(userID, canvasID string) map[string]any {
	memoryDir := filepath.Join(s.dataDir, "memory", userID)
	canvasMemoryDir := filepath.Join(memoryDir, canvasID)

	return map[string]any{
		"enabled":            true,
		"storePath":          memoryDir,
		"canvasStorePath":    canvasMemoryDir,
		"userId":             userID,
		"canvasId":           canvasID,
		"maxEntries":         1000,
		"indexingEnabled":    true,
		"searchEnabled":      true,
		"autoSaveInterval":   60, // seconds
		"compressionEnabled": true,
	}
}

// buildFeaturesConfig 构建 Features 配置
func (s *Service) buildFeaturesConfig(state *cloudAgentRuntime) map[string]any {
	return map[string]any{
		"planningEnabled":    true,
		"formsEnabled":       true,
		"memoryEnabled":      true,
		"skillsEnabled":      len(state.Skills) > 0,
		"canvasIntelligence": true,
		"approvalRequired":   []string{"canvas_node_delete", "canvas_bulk_operation"},
		"autoSave":           true,
		"collaborationMode":  "multi-user",
		"versionControl":     true,
	}
}

// buildPermissionsConfig 构建权限配置
func (s *Service) buildPermissionsConfig(userID, canvasID string) map[string]any {
	// 从数据库读取实际权限
	canvas, err := s.repo.GetCanvas(userID, canvasID)
	if err != nil {
		log.Printf("[Agent] failed to get canvas for permissions: %v", err)
		// 返回最小权限集
		return map[string]any{
			"canReadCanvas":      true,
			"canWriteCanvas":     false,
			"canDeleteNodes":     false,
			"canCreateNodes":     false,
			"canMoveNodes":       false,
			"canDuplicateNodes":  false,
			"canManageRelations": false,
			"canInviteUsers":     false,
			"canExportCanvas":    true,
			"maxTokenBudget":     200000,
			"maxSteps":           50,
		}
	}

	// 检查用户是否是画布所有者
	isOwner := canvas.UserID == userID

	// 检查协作权限
	canWrite := isOwner
	canDelete := isOwner
	canInvite := isOwner

	if canvas.Metadata != nil {
		if collaborators, ok := canvas.Metadata["collaborators"].([]any); ok {
			for _, collab := range collaborators {
				if collabMap, ok := collab.(map[string]any); ok {
					if collabUserID, _ := collabMap["userId"].(string); collabUserID == userID {
						role, _ := collabMap["role"].(string)
						switch role {
						case "admin":
							canWrite = true
							canDelete = true
							canInvite = true
						case "editor":
							canWrite = true
						case "viewer":
							// 只读权限
						}
					}
				}
			}
		}
	}

	return map[string]any{
		"canReadCanvas":      true,
		"canWriteCanvas":     canWrite,
		"canDeleteNodes":     canDelete,
		"canCreateNodes":     canWrite,
		"canMoveNodes":       canWrite,
		"canDuplicateNodes":  canWrite,
		"canManageRelations": canWrite,
		"canInviteUsers":     canInvite,
		"canExportCanvas":    true,
		"maxTokenBudget":     200000,
		"maxSteps":           50,
	}
}

// buildModelConfig 构建模型配置
func (s *Service) buildModelConfig(modelID string, state *cloudAgentRuntime) map[string]any {
	return map[string]any{
		"id":            modelID,
		"name":          modelID,
		"reasoning":     cloudAgentReasoningEnabled(state.Policy.ReasoningMode),
		"input":         []string{"text", "image"},
		"contextWindow": 200000,
		"maxTokens":     8192,
		"provider":      state.Request.ChannelID,
		"switchable":    true,
		"temperature":   0.7,
		"topP":          0.9,
	}
}

// marshalEnhancedCanvas 序列化增强画布
func (s *Service) marshalEnhancedCanvas(canvas *EnhancedCanvasContext) (map[string]any, error) {
	data, err := json.Marshal(canvas)
	if err != nil {
		return nil, err
	}

	var result map[string]any
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}

	return result, nil
}
