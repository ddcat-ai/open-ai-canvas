package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// Agent 协调器：负责启动/恢复 Agent 运行时进程，并通过 /model、/tool、/event
// 三个本地桥接把模型调用、工具执行和事件持久化交回 Go 业务层治理。

// startCloudAgentPi 是唯一的生产入口
func (s *Service) startCloudAgentPi(userID, runID string) {
	if s == nil || s.disablePiRuntime || runID == "" {
		return
	}

	s.piRunnerMu.Lock()
	if s.piRunners == nil {
		s.piRunners = make(map[string]context.CancelFunc)
	}
	if s.piRunnersClosed {
		s.piRunnerMu.Unlock()
		return
	}

	// Recovery scans run periodically, and create/idempotency paths may also
	// request a start. A duplicate request must not cancel and restart the live
	// Pi session: both processes would then write the same run checkpoint and
	// session file concurrently.
	if _, exists := s.piRunners[runID]; exists {
		s.piRunnerMu.Unlock()
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	s.piRunners[runID] = cancel
	s.piRunnerWg.Add(1)
	s.piRunnerMu.Unlock()

	go func() {
		defer func() {
			s.piRunnerMu.Lock()
			delete(s.piRunners, runID)
			s.piRunnerMu.Unlock()
			s.piRunnerWg.Done()
		}()

		if err := s.runCloudAgentPiSession(ctx, userID, runID); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("[Agent] session failed run=%s: %v", runID, err)
			s.failPiRunner(runID, userID, errors.New(cloudAgentUserFailureMessage(runID, err)))
		}
	}()
}

// closeCloudAgentPiRunners cancels and joins every Pi session before the
// service's database and other dependencies are closed. Without the join, a
// test or graceful shutdown can close the repository while a child runtime is
// still persisting its final checkpoint.
func (s *Service) closeCloudAgentPiRunners() {
	if s == nil {
		return
	}

	s.piRunnerMu.Lock()
	if !s.piRunnersClosed {
		s.piRunnersClosed = true
	}
	cancels := make([]context.CancelFunc, 0, len(s.piRunners))
	for _, cancel := range s.piRunners {
		cancels = append(cancels, cancel)
	}
	s.piRunnerMu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
	s.piRunnerWg.Wait()
}

func (s *Service) startApprovedCloudAgentMediaWaiter(userID, runID, mediaTaskID string) {
	if s == nil || runID == "" || mediaTaskID == "" {
		return
	}
	key := runID + ":" + mediaTaskID
	ctx, cancel := context.WithCancel(context.Background())

	s.approvedMediaMu.Lock()
	if s.approvedMediaClosed {
		s.approvedMediaMu.Unlock()
		cancel()
		return
	}
	if s.approvedMediaWaiters == nil {
		s.approvedMediaWaiters = make(map[string]context.CancelFunc)
	}
	if _, exists := s.approvedMediaWaiters[key]; exists {
		s.approvedMediaMu.Unlock()
		cancel()
		return
	}
	s.approvedMediaWaiters[key] = cancel
	s.approvedMediaWg.Add(1)
	s.approvedMediaMu.Unlock()

	go func() {
		defer func() {
			cancel()
			s.approvedMediaMu.Lock()
			delete(s.approvedMediaWaiters, key)
			s.approvedMediaMu.Unlock()
			s.approvedMediaWg.Done()
		}()

		if err := s.finishApprovedCloudAgentMedia(ctx, userID, runID, mediaTaskID); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("[Agent] approved media resume failed run=%s: %v", runID, err)
			s.failPiRunner(runID, userID, errors.New(cloudAgentUserFailureMessage(runID, err)))
		}
	}()
}

func (s *Service) closeApprovedCloudAgentMediaWaiters() {
	if s == nil {
		return
	}
	s.approvedMediaMu.Lock()
	s.approvedMediaClosed = true
	cancels := make([]context.CancelFunc, 0, len(s.approvedMediaWaiters))
	for _, cancel := range s.approvedMediaWaiters {
		cancels = append(cancels, cancel)
	}
	s.approvedMediaMu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
	s.approvedMediaWg.Wait()
}

func (s *Service) failPiRunner(runID, userID string, cause error) {
	if s == nil || s.repo == nil {
		return
	}
	for attempt := 0; attempt < 4; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return
		}
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			if cloudAgentRunTerminal(current.Status) {
				return nil
			}
			current.Status = "failed"
			current.FailureMessage = cause.Error()
			state, decodeErr := cloudAgentDecode(current)
			if decodeErr == nil {
				state.LastError = cause.Error()
				state.event(runID, "run_failed", map[string]any{"error": cause.Error()})
				return cloudAgentSave(current, &state)
			}
			return nil
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return
		}
	}
}

func (s *Service) stopCloudAgentPi(runID string) {
	s.piRunnerMu.Lock()
	cancel := s.piRunners[runID]
	s.piRunnerMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *Service) recoverCloudAgentPiRunners() {
	if s == nil || s.repo == nil {
		return
	}

	cursor := ""
	for {
		runs, err := s.repo.ActiveCloudAgentsAfter(cursor, 50)
		if err != nil {
			log.Printf("[Agent] recovery scan failed: %v", err)
			return
		}

		for _, run := range runs {
			cursor = run.ID
			// 跳过等待状态
			if run.Status == "waiting_approval" || run.Status == "waiting_user" {
				continue
			}
			// 批准后的媒体任务仍在生成：由 finishApprovedCloudAgentMedia 等结果回写后再恢复运行。
			// 这时提前启动运行时，会在媒体任务未结束时再入队模型步骤，形成两个活动任务。
			if s.cloudAgentAwaitingMedia(run.UserID, run.ID) {
				continue
			}
			s.startCloudAgentPi(run.UserID, run.ID)
		}

		if len(runs) < 50 {
			return
		}
	}
}

// cloudAgentAwaitingMedia reports whether the run is waiting on an approved
// media task. The runtime must not start (and schedule a model step) until that
// task has been written back; one run owns at most one active task.
func (s *Service) cloudAgentAwaitingMedia(userID, runID string) bool {
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return false
	}
	state, err := cloudAgentDecode(run)
	return err == nil && state.MediaTaskID != ""
}

// runCloudAgentPiSession 核心会话管理
func (s *Service) runCloudAgentPiSession(ctx context.Context, userID, runID string) error {
	// 1. 加载运行状态
	task, state, err := s.cloudAgentTask(userID, runID)
	if err != nil {
		return fmt.Errorf("load task: %w", err)
	}

	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return fmt.Errorf("load run: %w", err)
	}

	if cloudAgentRunTerminal(run.Status) {
		return nil
	}

	runtimeState, err := cloudAgentDecode(run)
	if err != nil {
		return fmt.Errorf("decode state: %w", err)
	}

	// 2. 解析输入
	input := map[string]any{}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return fmt.Errorf("parse input: %w", err)
	}

	canonical := stateCanonicalFromInput(input)
	if len(canonical.Messages) == 0 {
		return fmt.Errorf("no initial messages")
	}

	// 3. 确定模型
	modelID := firstNonEmpty(state.Request.ChannelModelKey, state.Request.Model)
	if modelID == "" {
		return fmt.Errorf("no model specified")
	}

	// 4. 准备会话文件
	sessionJSONL, _ := input["piSessionJSONL"].(string)
	if saved, sessionErr := s.repo.CloudAgentPiSession(userID, runID); sessionErr == nil && saved != nil && saved.SessionJSONL != "" {
		sessionJSONL = saved.SessionJSONL
	} else if sessionErr != nil && !errors.Is(sessionErr, gorm.ErrRecordNotFound) {
		return fmt.Errorf("load session: %w", sessionErr)
	}

	sessionDir := filepath.Join(s.dataDir, "pi-sessions")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		return fmt.Errorf("create session dir: %w", err)
	}
	sessionFile := filepath.Join(sessionDir, runID+".jsonl")

	// 5. 构建完整的 Pi 请求（核心重构）
	request, err := s.buildEnhancedPiRequest(ctx, EnhancedPiRequestParams{
		UserID:       userID,
		RunID:        runID,
		CanvasID:     state.Request.CanvasID,
		FocusNodeIDs: state.Request.FocusNodeIDs,
		Prompt:       state.Request.Prompt,
		SystemPrompt: canonical.SystemPrompt,
		ModelID:      modelID,
		RuntimeState: &runtimeState,
		Canonical:    &canonical,
		SessionFile:  sessionFile,
		SessionJSONL: sessionJSONL,
		SessionDir:   sessionDir,
	})
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}

	// 6. 如果是恢复会话，使用恢复提示词
	if len(sessionJSONL) > 0 {
		request.Prompt = firstNonEmpty(runtimeState.PiResumePrompt, state.Request.Prompt)
	}

	// 7. 运行 Pi 会话
	err = runCloudAgentPi(ctx, request, cloudAgentPiBridge{
		Model: func(callCtx context.Context, payload map[string]json.RawMessage) (any, error) {
			return s.cloudAgentPiModel(callCtx, userID, runID, payload)
		},
		Tool: func(callCtx context.Context, payload map[string]json.RawMessage) (any, error) {
			return s.cloudAgentPiTool(callCtx, userID, runID, payload)
		},
		Event: func(callCtx context.Context, payload map[string]json.RawMessage) (any, error) {
			return s.cloudAgentPiEvent(callCtx, userID, runID, payload)
		},
	})
	if err != nil {
		return err
	}

	// 8. 清理恢复提示词
	if runtimeState.PiResumePrompt != "" {
		if err := s.saveCloudAgentPiResumePrompt(userID, runID, ""); err != nil {
			return err
		}
	}

	// 9. 完成运行
	return s.completeCloudAgentPiRun(userID, runID)
}

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
	log.Printf("[Agent] building enhanced request for canvas=%s", params.CanvasID)

	// 1. 构建工具列表（包括画布工具）
	tools := s.buildCompletePiTools(params.Canonical.Tools)

	// 2. 构建 Skills 配置
	skillPaths := s.buildSkillPaths(params.RuntimeState.Skills)
	enabledSkills := s.buildSkillManifests(params.RuntimeState.Skills)

	log.Printf("[Agent] enabled skills: %d", len(enabledSkills))

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

	log.Printf("[Agent] canvas intelligence: nodes=%d, focus=%d, relationships=%d, clusters=%d",
		enhancedCanvas.Snapshot.TotalNodes,
		len(enhancedCanvas.Snapshot.FocusNodes),
		len(enhancedCanvas.Snapshot.Relationships),
		len(enhancedCanvas.Snapshot.Layout.Clusters))

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

	log.Printf("[Agent] request built successfully")
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

// completeCloudAgentPiRun 完成运行
func (s *Service) completeCloudAgentPiRun(userID, runID string) error {
	for attempt := 0; attempt < 4; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}

		// 检查终止状态
		if cloudAgentRunTerminal(run.Status) || run.Status == "waiting_approval" || run.Status == "waiting_user" {
			return nil
		}

		state, err := cloudAgentDecode(run)
		if err != nil {
			return err
		}

		// 检查是否有未完成的任务
		if state.ActiveTaskID != "" || state.MediaTaskID != "" || state.Approval != nil {
			return nil
		}

		// 验证：必须有真实的助手响应（防止伪装完成）
		if state.PiAssistantResponses == 0 {
			return fmt.Errorf("no assistant response, refusing to mark as completed")
		}

		// 原子更新状态
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			if cloudAgentRunTerminal(current.Status) || current.Status == "waiting_approval" || current.Status == "waiting_user" {
				return nil
			}

			current.Status = "completed"
			state.event(runID, "run_completed", map[string]any{
				"text":      "Agent 已完成",
				"timestamp": time.Now().Unix(),
			})

			return cloudAgentSave(current, &state)
		})

		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
	}

	return repository.ErrCreationConflict
}

// Pi 桥接方法

// cloudAgentPiModel 模型调用桥接
func (s *Service) cloudAgentPiModel(ctx context.Context, userID, runID string, payload map[string]json.RawMessage) (any, error) {
	var request struct {
		Messages      []map[string]any `json:"messages"`
		Tools         []map[string]any `json:"tools"`
		ThinkingLevel string           `json:"thinkingLevel"`
	}
	if err := decodePiPayload(payload, &request); err != nil {
		return nil, err
	}
	if len(request.Messages) == 0 {
		return nil, fmt.Errorf("no messages")
	}

	// 上游临时故障（5xx、429、超时、连接错误、空回复）自动重试，首次失败后最多再试 3 次，
	// 指数退避。参数/鉴权类 4xx 重试也不会变好，直接失败。
	var lastErr error
	for attempt := 0; attempt <= cloudAgentModelStepRetries; attempt++ {
		if attempt > 0 {
			delay := time.Duration(1<<(attempt-1)) * time.Second
			log.Printf("[Agent] model step retry run=%s attempt=%d/%d after %s: %v", runID, attempt, cloudAgentModelStepRetries, delay, lastErr)
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(delay):
			}
		}
		result, retryable, err := s.runCloudAgentModelStep(ctx, userID, runID, request.Messages, request.ThinkingLevel)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if !retryable {
			return nil, err
		}
	}
	return nil, lastErr
}

// cloudAgentModelStepRetries 是单步模型调用首次失败后的最大重试次数。
const cloudAgentModelStepRetries = 3

// runCloudAgentModelStep 调度并等待一次模型步骤；第二个返回值表示失败是否值得重试。
func (s *Service) runCloudAgentModelStep(ctx context.Context, userID, runID string, messages []map[string]any, thinkingLevel string) (any, bool, error) {
	// 运行时发起 /model 的同时会并发推送事件（message_start、session_snapshot 等），
	// 这些事件也会推进运行 revision。调度模型步骤是 CAS 写入：冲突时重新读取
	// 最新状态再调度，而不是把整轮判失败。冲突时事务整体回滚，不会产生任务或扣费。
	var state cloudAgentRuntime
	for attempt := 0; attempt < 8; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return nil, false, err
		}
		state, err = cloudAgentDecode(run)
		if err != nil {
			return nil, false, err
		}
		if cloudAgentRunTerminal(run.Status) {
			return nil, false, fmt.Errorf("run already terminated")
		}
		if cloudAgentStepBudgetExhausted(&state) {
			return nil, false, fmt.Errorf("step budget exhausted")
		}
		if state.StepLimits, err = s.cloudAgentStepLimits(); err != nil {
			return nil, false, err
		}
		// 一个运行同一时刻只能有一个活动任务。媒体任务还没回写时不能再入队模型步骤，
		// 否则检查点校验会拒绝（"多个活动任务"）并让整轮失败。先等媒体结果落库。
		if state.MediaTaskID != "" {
			if _, waitErr := s.waitCloudAgentTask(ctx, state.MediaTaskID); waitErr != nil && ctx.Err() != nil {
				return nil, false, ctx.Err()
			}
			if err := s.settleCloudAgentMedia(userID, runID); err != nil {
				return nil, false, err
			}
			continue
		}

		canonical := canonicalFromRuntimeMessages(messages, state.Canonical.Tools, state.Canonical.SystemPrompt)
		canonical.PromptCacheKey = state.Canonical.PromptCacheKey
		if len(canonical.Messages) == 0 {
			return nil, false, fmt.Errorf("no canonical messages")
		}
		state.Canonical = canonical
		input := map[string]any{
			"mode":          "text",
			"prompt":        state.Request.Prompt,
			"agentRequests": map[string]any{"canonical": canonical},
			"config": map[string]any{
				"channelId":       state.Request.ChannelID,
				"channelModelKey": state.Request.ChannelModelKey,
				"model":           firstNonEmpty(state.Request.ChannelModelKey, state.Request.Model),
			},
			"textOptions": map[string]any{
				"stream":          true,
				"thinking":        thinkingLevel != "off",
				"maxOutputTokens": cloudAgentStepOutputBudget(state.StepLimits, state.BoostStepOutputBudget),
			},
		}
		req := CreateTaskRequest{
			ProjectID: state.Request.CanvasID,
			Type:      "canvas_text",
			// Operation: cloudAgentStepOperation
			Operation:      cloudAgentStepOperation,
			Prompt:         state.Request.Prompt,
			Model:          firstNonEmpty(state.Request.ChannelModelKey, state.Request.Model),
			LogicalModelID: state.Request.LogicalModelID,
			Input:          input,
		}
		err = s.enqueueCloudAgentTask(run, &state, req, nil)
		if errors.Is(err, repository.ErrCreationConflict) {
			state.ActiveTaskID = ""
			time.Sleep(time.Duration(attempt+1) * 20 * time.Millisecond)
			continue
		}
		if err != nil {
			return nil, false, err
		}
		break
	}
	if state.ActiveTaskID == "" {
		return nil, false, fmt.Errorf("Agent model step was not scheduled: %w", repository.ErrCreationConflict)
	}
	// 任务已入队：立刻唤醒调度器，不等下一次轮询。
	s.wakeTaskDispatcher()
	taskID := state.ActiveTaskID
	task, err := s.waitCloudAgentTask(ctx, taskID)
	if err != nil {
		retryable := ctx.Err() == nil && s.cloudAgentModelTaskRetryable(taskID)
		if retryable {
			// 释放失败的步骤，下一次重试才能重新入队。
			if releaseErr := s.finishCloudAgentPiModelStep(userID, runID, taskID, "", ""); releaseErr != nil {
				return nil, false, releaseErr
			}
		}
		return nil, retryable, err
	}
	var result struct {
		Text      string           `json:"text"`
		Reasoning string           `json:"reasoning,omitempty"`
		ToolCalls []cloudAgentCall `json:"toolCalls"`
	}
	if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
		return nil, false, fmt.Errorf("decode model result: %w", err)
	}
	if err := s.finishCloudAgentPiModelStep(userID, runID, task.ID, result.Text, result.Reasoning); err != nil {
		return nil, false, err
	}
	return map[string]any{"text": result.Text, "reasoning": result.Reasoning, "toolCalls": runtimeToolCalls(result.ToolCalls)}, false, nil
}

// cloudAgentModelTaskRetryable 按上游真实 HTTP 状态判断失败是否是临时性的：
// 5xx、429、408 与没有拿到任何响应的网络错误可以重试；空回复也可以重试。
// 其余 4xx（参数、鉴权、模型不存在）重试结果不会变，直接失败。
func (s *Service) cloudAgentModelTaskRetryable(taskID string) bool {
	task, err := s.repo.Task(taskID)
	if err != nil || task == nil || task.Status == model.TaskStatusSucceeded || task.Status == model.TaskStatusCancelled {
		return false
	}
	if cloudAgentEmptyModelOutput(task) || cloudAgentStepTimedOut(task) {
		return true
	}
	status, err := s.repo.LatestAPICallStatusForTask(taskID)
	if err != nil {
		return false
	}
	switch {
	case status >= 500, status == 429, status == 408:
		return true
	case status == 0:
		// 没有上游响应：连接失败、重置、超时。
		raw := strings.ToLower(task.Error)
		return strings.Contains(raw, "timeout") || strings.Contains(raw, "deadline") || strings.Contains(raw, "connection") || strings.Contains(raw, "eof") || strings.Contains(task.Error, "超时")
	}
	return false
}

// finishCloudAgentPiModelStep 释放已完成的模型步骤，并把最终正文写入 Agent 事件流。
// 不释放 ActiveTaskID 的话，completeCloudAgentPiRun 会一直认为还有任务在跑。
func (s *Service) finishCloudAgentPiModelStep(userID, runID, taskID, text, reasoning string) error {
	for attempt := 0; attempt < 8; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			fresh, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			if fresh.ActiveTaskID != taskID {
				return nil
			}
			fresh.ActiveTaskID = ""
			fresh.ActiveTextDraft = ""
			if reasoning != "" {
				fresh.event(runID, "reasoning_message", map[string]any{"messageId": taskID + ":reasoning", "text": truncateRunes(reasoning, 8000)})
			}
			if text != "" {
				fresh.event(runID, "assistant_message", map[string]any{"messageId": taskID, "text": text})
			}
			return cloudAgentSave(current, &fresh)
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
	}
	return repository.ErrCreationConflict
}

func (s *Service) waitCloudAgentTask(ctx context.Context, taskID string) (*model.Task, error) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		task, err := s.repo.Task(taskID)
		if err != nil {
			return nil, err
		}
		if cloudAgentTaskTerminal(task.Status) {
			if task.Status != model.TaskStatusSucceeded {
				// 与画布节点同一套失败分类（网络/审核/存储/HTTP 状态/供应商原因），
				// 原始错误保留在任务中心诊断里，不直接抛给用户。
				return nil, BadAuthRequest(userFacingTaskFailure(task))
			}
			return task, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

// canonicalFromRuntimeMessages 把运行时的会话消息（user/assistant/toolResult，
// 内容块为 text/image/thinking/toolCall）转换成供应商层接受的规范格式。
func canonicalFromRuntimeMessages(messages []map[string]any, tools []map[string]interface{}, systemPrompt string) canonicalAgentRequest {
	canonical := canonicalAgentRequest{Tools: tools, ToolChoice: "auto", SystemPrompt: systemPrompt}
	for _, message := range messages {
		switch stringField(message, "role") {
		case "system":
			if text := runtimeContentText(message["content"]); strings.TrimSpace(text) != "" {
				canonical.Messages = append(canonical.Messages, map[string]interface{}{"role": "system", "content": text})
			}
		case "user":
			canonical.Messages = append(canonical.Messages, map[string]interface{}{"role": "user", "content": runtimeUserContent(message["content"])})
		case "assistant":
			text := ""
			calls := []interface{}{}
			if parts, ok := message["content"].([]interface{}); ok {
				for _, value := range parts {
					part, _ := value.(map[string]interface{})
					switch stringField(part, "type") {
					case "text":
						text += stringField(part, "text")
					case "toolCall":
						arguments, _ := json.Marshal(part["arguments"])
						if part["arguments"] == nil {
							arguments = []byte("{}")
						}
						calls = append(calls, map[string]interface{}{
							"id":       stringField(part, "id"),
							"function": map[string]interface{}{"name": stringField(part, "name"), "arguments": string(arguments)},
						})
					}
				}
			} else {
				text = runtimeContentText(message["content"])
			}
			if text == "" && len(calls) == 0 {
				continue
			}
			converted := map[string]interface{}{"role": "assistant", "content": text}
			if len(calls) > 0 {
				converted["tool_calls"] = calls
			}
			canonical.Messages = append(canonical.Messages, converted)
		case "toolResult", "tool":
			id := firstNonEmpty(stringField(message, "toolCallId"), stringField(message, "tool_call_id"))
			if id == "" {
				continue
			}
			canonical.Messages = append(canonical.Messages, map[string]interface{}{"role": "tool", "tool_call_id": id, "content": runtimeContentText(message["content"])})
		}
	}
	if strings.TrimSpace(systemPrompt) != "" {
		found := false
		for _, message := range canonical.Messages {
			if stringField(message, "role") == "system" {
				found = true
				break
			}
		}
		if !found {
			canonical.Messages = append([]map[string]interface{}{{"role": "system", "content": systemPrompt}}, canonical.Messages...)
		}
	}
	return canonical
}

func runtimeContentText(content interface{}) string {
	if text, ok := content.(string); ok {
		return text
	}
	parts, _ := content.([]interface{})
	texts := make([]string, 0, len(parts))
	for _, value := range parts {
		part, _ := value.(map[string]interface{})
		if stringField(part, "type") == "text" {
			texts = append(texts, stringField(part, "text"))
		}
	}
	return strings.Join(texts, "\n")
}

func runtimeUserContent(content interface{}) interface{} {
	if text, ok := content.(string); ok {
		return text
	}
	parts, _ := content.([]interface{})
	converted := make([]interface{}, 0, len(parts))
	for _, value := range parts {
		part, _ := value.(map[string]interface{})
		switch stringField(part, "type") {
		case "text":
			converted = append(converted, map[string]interface{}{"type": "text", "text": stringField(part, "text")})
		case "image":
			data, mimeType := stringField(part, "data"), stringField(part, "mimeType")
			if data != "" && mimeType != "" {
				converted = append(converted, map[string]interface{}{"type": "image_url", "image_url": map[string]interface{}{"url": "data:" + mimeType + ";base64," + data}})
			}
		case "image_url", "file_url":
			converted = append(converted, part)
		}
	}
	if len(converted) == 0 {
		return ""
	}
	return converted
}

// runtimeToolSchemas 把运行时声明的工具转换成规范的 function 工具定义。
func runtimeToolSchemas(tools []map[string]any) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(tools))
	for _, tool := range tools {
		name := stringValue(tool["name"])
		if name == "" {
			continue
		}
		parameters := tool["parameters"]
		if parameters == nil {
			parameters = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
		}
		result = append(result, map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        name,
				"description": firstNonEmpty(stringValue(tool["description"]), name),
				"parameters":  parameters,
			},
		})
	}
	return result
}

// runtimeToolCalls 把规范工具调用转换回运行时需要的 {id, name, arguments(object)}。
func runtimeToolCalls(calls []cloudAgentCall) []map[string]any {
	result := make([]map[string]any, 0, len(calls))
	for _, call := range calls {
		arguments := map[string]any{}
		if strings.TrimSpace(call.Function.Arguments) != "" {
			_ = json.Unmarshal([]byte(call.Function.Arguments), &arguments)
		}
		result = append(result, map[string]any{"id": call.ID, "name": call.Function.Name, "arguments": arguments})
	}
	return result
}

// cloudAgentPiTool 工具调用桥接：所有工具都交给唯一的 Go 业务执行器
// advanceCloudAgentTool（权限、审批、计费、画布写入都在那里治理）。
func (s *Service) cloudAgentPiTool(ctx context.Context, userID, runID string, payload map[string]json.RawMessage) (any, error) {
	var request struct {
		CallID    string          `json:"callId"`
		Name      string          `json:"name"`
		ToolName  string          `json:"toolName"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := decodePiPayload(payload, &request); err != nil {
		return nil, err
	}
	var call cloudAgentCall
	call.ID = firstNonEmpty(request.CallID, generateID())
	call.Function.Name = firstNonEmpty(request.Name, request.ToolName)
	call.Function.Arguments = strings.TrimSpace(string(request.Arguments))
	if call.Function.Arguments == "" || call.Function.Arguments == "null" {
		call.Function.Arguments = "{}"
	}
	if call.Function.Name == "" {
		return nil, fmt.Errorf("tool call is missing a name")
	}
	return s.executeCloudAgentRuntimeTool(ctx, userID, runID, call)
}

func (s *Service) executeCloudAgentRuntimeTool(ctx context.Context, userID, runID string, call cloudAgentCall) (any, error) {
	executed := false
	for attempt := 0; attempt < 8 && !executed; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return nil, err
		}
		if cloudAgentRunTerminal(run.Status) {
			return nil, fmt.Errorf("run already terminated")
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			return nil, err
		}
		if state.StepLimits, err = s.cloudAgentStepLimits(); err != nil {
			return nil, err
		}
		state.Calls = []cloudAgentCall{call}
		state.CallIndex = 0
		state.Approval = nil
		err = s.advanceCloudAgentTool(run, &state)
		if errors.Is(err, repository.ErrCreationConflict) {
			time.Sleep(time.Duration(attempt+1) * 20 * time.Millisecond)
			continue
		}
		if err != nil {
			return nil, err
		}
		executed = true
	}
	if !executed {
		return nil, fmt.Errorf("execute tool %s: %w", call.Function.Name, repository.ErrCreationConflict)
	}
	// 媒体生成：等待已提交的任务结束，再由同一执行器回写画布并记录工具结果。
	for {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return nil, err
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			return nil, err
		}
		if run.Status == "waiting_approval" && state.Approval != nil {
			return map[string]any{"pause": true, "approvalId": state.Approval.ID, "content": "操作正在等待用户审批。"}, nil
		}
		if cloudAgentRunTerminal(run.Status) && run.Status != "completed" {
			return nil, fmt.Errorf("%s", firstNonEmpty(run.FailureMessage, "Agent 工具执行失败"))
		}
		if content, ok := cloudAgentToolMessage(&state, call.ID); ok {
			if trimmed := strings.TrimSpace(content); trimmed == "" || trimmed == "null" {
				content = `{"error":"工具没有返回结果"}`
			}
			return map[string]any{"content": content, "isError": cloudAgentToolContentIsError(content)}, nil
		}
		if state.MediaTaskID == "" {
			return nil, fmt.Errorf("tool %s produced no result", call.Function.Name)
		}
		if _, err := s.waitCloudAgentTask(ctx, state.MediaTaskID); err != nil && ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if err := s.settleCloudAgentMedia(userID, runID); err != nil {
			return nil, err
		}
	}
}

// settleCloudAgentMedia 在媒体任务结束后用唯一的业务执行器回写画布、记录工具结果并释放
// MediaTaskID。任务仍在生成时直接返回；并发写冲突时重读重试。
func (s *Service) settleCloudAgentMedia(userID, runID string) error {
	for attempt := 0; attempt < 8; attempt++ {
		latest, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		fresh, err := cloudAgentDecode(latest)
		if err != nil {
			return err
		}
		if fresh.MediaTaskID == "" || fresh.CallIndex >= len(fresh.Calls) {
			return nil
		}
		err = s.advanceCloudAgentMedia(latest, &fresh, fresh.Calls[fresh.CallIndex])
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
		time.Sleep(time.Duration(attempt+1) * 20 * time.Millisecond)
	}
	return repository.ErrCreationConflict
}

func cloudAgentToolMessage(state *cloudAgentRuntime, callID string) (string, bool) {
	for index := len(state.Canonical.Messages) - 1; index >= 0; index-- {
		message := state.Canonical.Messages[index]
		if stringField(message, "role") == "tool" && stringField(message, "tool_call_id") == callID {
			return stringField(message, "content"), true
		}
	}
	return "", false
}

func cloudAgentToolContentIsError(content string) bool {
	var decoded map[string]any
	if json.Unmarshal([]byte(content), &decoded) != nil {
		return false
	}
	_, failed := decoded["error"]
	return failed
}

// cloudAgentPiEvent 事件桥接。Node 端事件是平铺字段（{type, message, ...}），
// 不是 {type, data}；这里把整个 payload 作为事件数据交给处理器。
func (s *Service) cloudAgentPiEvent(ctx context.Context, userID, runID string, payload map[string]json.RawMessage) (any, error) {
	data := map[string]any{}
	for key, raw := range payload {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, fmt.Errorf("decode Agent event field %q: %w", key, err)
		}
		data[key] = value
	}
	eventType, _ := data["type"].(string)
	if nested, ok := data["data"].(map[string]any); ok {
		for key, value := range nested {
			if _, exists := data[key]; !exists {
				data[key] = value
			}
		}
	}
	if message, ok := data["message"].(map[string]any); ok {
		if _, exists := data["role"]; !exists {
			data["role"] = message["role"]
		}
	}

	switch eventType {
	case "message_start":
		return s.handleMessageStart(userID, runID, data)
	case "message_delta":
		return s.handleMessageDelta(userID, runID, data)
	case "message_end":
		return s.handleMessageEnd(userID, runID, data)
	case "session_snapshot":
		return s.handlePiSessionSnapshot(userID, runID, data)
	case "tool_call", "tool_call_start", "tool_call_end":
		return s.handleToolCall(userID, runID, data)
	case "error":
		return s.handleError(userID, runID, data)
	default:
		return map[string]any{"ok": true}, nil
	}
}

// handlePiSessionSnapshot 持久化 Pi 原生会话 JSONL，用于审批恢复和续轮。
func (s *Service) handlePiSessionSnapshot(userID, runID string, data map[string]any) (any, error) {
	sessionJSONL, _ := data["sessionJSONL"].(string)
	if sessionJSONL == "" {
		return map[string]any{"ok": true}, nil
	}
	for attempt := 0; attempt < 4; attempt++ {
		var expected int64
		existing, err := s.repo.CloudAgentPiSession(userID, runID)
		if err == nil {
			expected = existing.Revision
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		err = s.repo.SaveCloudAgentPiSession(&model.CloudAgentPiSession{RunID: runID, UserID: userID, SessionJSONL: sessionJSONL, UpdatedAt: time.Now()}, expected)
		if err == nil {
			if expected == 0 {
				// OnConflict DoNothing：并发首写时再按 revision 覆盖一次。
				if saved, readErr := s.repo.CloudAgentPiSession(userID, runID); readErr == nil && saved.SessionJSONL != sessionJSONL {
					continue
				}
			}
			return map[string]any{"ok": true}, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	return nil, fmt.Errorf("save Agent session: %w", repository.ErrCreationConflict)
}

// 辅助方法

func stateCanonicalFromInput(input map[string]any) canonicalAgentRequest {
	canonical, _ := canonicalAgentRequestFromInput(input)
	return canonical
}

func piToolDefinitions(source []map[string]interface{}) []map[string]any {
	result := make([]map[string]any, 0, len(source))
	for _, tool := range source {
		fn, _ := tool["function"].(map[string]interface{})
		name := stringValue(fn["name"])
		if name == "" {
			continue
		}
		result = append(result, map[string]any{
			"name":        name,
			"label":       firstNonEmpty(stringValue(fn["name"]), name),
			"description": stringValue(fn["description"]),
			"parameters":  fn["parameters"],
		})
	}
	return result
}

func isCanvasTool(toolName string) bool {
	return strings.HasPrefix(toolName, "canvas_")
}

func decodePiPayload(payload map[string]json.RawMessage, target interface{}) error {
	// 尝试直接解析整个 payload
	if data, err := json.Marshal(payload); err == nil {
		if err := json.Unmarshal(data, target); err == nil {
			return nil
		}
	}

	// 尝试解析 arguments 字段
	if argsRaw, ok := payload["arguments"]; ok {
		return json.Unmarshal(argsRaw, target)
	}

	return fmt.Errorf("failed to decode payload")
}

func mustMarshal(v any) string {
	data, _ := json.Marshal(v)
	return string(data)
}

func generateID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
