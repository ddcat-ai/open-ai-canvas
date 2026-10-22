// 组装交给 Agent 运行时的请求：工具清单、技能、画像、记忆、功能开关、权限与模型配置。
//
// 权限由服务端按画布归属计算后下发，运行时只能在这个范围内调用工具。

package app

import (
	"context"
	"log/slog"

	agenttool "yingce/backend/internal/agent/tool"
)

// EnhancedPiRequestParams 增强的 Pi 请求参数
type EnhancedPiRequestParams struct {
	UserID       string
	RunID        string
	CanvasID     string
	Prompt       string
	SystemPrompt string
	ModelID      string
	RuntimeState *cloudAgentRuntime
	Canonical    *canonicalAgentRequest
	SessionJSONL string
}

// buildEnhancedPiRequest 构建增强的 Pi 请求（核心方法）
func (s *Service) buildEnhancedPiRequest(_ context.Context, params EnhancedPiRequestParams) (cloudAgentPiProcessRequest, error) {
	slog.Debug("agent building request", "canvas", params.CanvasID)

	tools := s.buildCompletePiTools(params.Canonical.Tools)
	enabledSkills := s.buildSkillManifests(params.RuntimeState.Skills)
	slog.Debug("agent enabled skills", "count", len(enabledSkills))
	profile := s.buildProfileConfig(params.RuntimeState.Profile)
	features := s.buildFeaturesConfig(params.RuntimeState)

	// 7. 构建压缩策略
	contextBudget := s.cloudAgentContextBudgetForRequest(params.RuntimeState.Request)
	compaction := s.buildCompactionStrategy(params.UserID, params.CanvasID, contextBudget)

	// 8. 构建权限配置
	permissions := s.buildPermissionsConfig(params.UserID, params.RuntimeState.Request)

	// 9. 构建模型配置
	modelConfig := s.buildModelConfig(params.ModelID, params.RuntimeState)

	// 10. 组装完整请求
	request := cloudAgentPiProcessRequest{
		// 会话信息：只传数据库里的快照。会话文件与工作目录由运行时在自己的
		// 临时目录里创建，独立容器里没有服务端的数据目录。
		SessionJSONL: params.SessionJSONL,

		// 标识信息
		SessionId: params.RunID,
		UserId:    params.UserID,
		CanvasId:  params.CanvasID,
		RunId:     params.RunID,

		// 对话内容
		Prompt:       params.Prompt,
		SystemPrompt: params.SystemPrompt,

		// 核心增强：完整的上下文传递
		EnabledSkills: enabledSkills,
		Profile:       profile,
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

// buildFeaturesConfig projects real tool contracts; it grants no capabilities.
func (s *Service) buildFeaturesConfig(state *cloudAgentRuntime) map[string]any {
	approvalTools := []string{}
	for _, name := range cloudAgentRegistry().Names() {
		if cloudAgentToolAllowed(state.Request, name) && agenttool.Of(name).ApprovalRequired(state.Request.PermissionMode) {
			approvalTools = append(approvalTools, name)
		}
	}
	return map[string]any{
		"planningEnabled": true, "formsEnabled": true,
		"approvalRequired": approvalTools,
	}
}

// buildPermissionsConfig is a projection of the run's server-derived authority.
// Ownership alone never enables tools excluded by read_only or context scope.
func (s *Service) buildPermissionsConfig(userID string, req CloudAgentRequest) map[string]any {
	allowed := false
	if req.CanvasID != "" && len(req.ContextScope) > 0 {
		_, err := s.repo.CanvasProjectForUser(userID, req.CanvasID)
		allowed = err == nil
	}
	writable := allowed && req.PermissionMode != "read_only"
	budget := s.cloudAgentContextBudgetForRequest(req)
	return map[string]any{
		"canReadCanvas": allowed, "canWriteCanvas": writable,
		"canCreateNodes": writable, "canMoveNodes": writable, "canManageRelations": writable,
		"canDeleteNodes": false, "canDuplicateNodes": false,
		"canInviteUsers": false, "canExportCanvas": false,
		"maxTokenBudget": budget.InputBudgetTokens, "maxSteps": cloudAgentStepLimit(req),
	}
}

// buildModelConfig 构建模型配置
func (s *Service) buildModelConfig(modelID string, state *cloudAgentRuntime) map[string]any {
	budget := s.cloudAgentContextBudgetForRequest(state.Request)
	return map[string]any{
		"id":            modelID,
		"name":          modelID,
		"reasoning":     cloudAgentReasoningEnabled(state.Policy.ReasoningMode),
		"input":         cloudAgentModelInputKinds(state.Request),
		"contextWindow": budget.ContextWindowTokens,
		"maxTokens":     budget.MaxOutputTokens,
		"provider":      state.Request.ChannelID,
		"switchable":    true,
		"temperature":   0.7,
		"topP":          0.9,
	}
}

func cloudAgentModelInputKinds(req CloudAgentRequest) []string {
	if req.VisionEnabled {
		return []string{"text", "image"}
	}
	return []string{"text"}
}
