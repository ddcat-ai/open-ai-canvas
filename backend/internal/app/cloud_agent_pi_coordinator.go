// Agent 协调器：负责启动/恢复 Agent 运行时进程，并通过 /model、/tool、/event
// 三个本地桥接把模型调用、工具执行和事件持久化交回 Go 业务层治理。
//
// 同一协调器的其余部分：
//   - cloud_agent_pi_request.go 组装运行时请求
//   - cloud_agent_pi_model.go   /model 桥：模型调用走平台文本任务
//   - cloud_agent_pi_bridge.go  /tool、/event 桥与消息转换

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync/atomic"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

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
			_, restart := s.piRunnerRestarts[runID]
			delete(s.piRunnerRestarts, runID)
			s.piRunnerMu.Unlock()
			// 先登记新会话再 Done，关闭流程等待时不会漏掉刚恢复的会话。
			if restart {
				s.startCloudAgentPi(userID, runID)
			}
			s.piRunnerWg.Done()
		}()

		if err := s.runCloudAgentPiSession(ctx, userID, runID); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("[Agent] session failed run=%s: %v", runID, err)
			s.failPiRunner(runID, userID, errors.New(cloudAgentUserFailureMessage(runID, err)))
		}
	}()
}

// resumeCloudAgentPi 用于审批后恢复运行。审批暂停的会话在中止后仍要刷新事件和
// 会话快照，用户很快批准时它可能还没退出；这时不能像普通重复启动那样丢弃，
// 而是登记一次重启，等旧会话退出后用已保存的恢复提示词继续。
func (s *Service) resumeCloudAgentPi(userID, runID string) {
	if s == nil || s.disablePiRuntime || runID == "" {
		return
	}
	s.piRunnerMu.Lock()
	if _, exists := s.piRunners[runID]; exists && !s.piRunnersClosed {
		if s.piRunnerRestarts == nil {
			s.piRunnerRestarts = make(map[string]struct{})
		}
		s.piRunnerRestarts[runID] = struct{}{}
		s.piRunnerMu.Unlock()
		return
	}
	s.piRunnerMu.Unlock()
	s.startCloudAgentPi(userID, runID)
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
				cloudAgentDropInterjections(runID, "本轮已结束："+truncateRunes(cause.Error(), 120), &state)
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
			// 批准后的媒体任务仍在生成。进程重启后内存 waiter 已经消失，这里按
			// 持久化的任务 ID 重建；不能同时再启动一轮模型步骤。
			state, decodeErr := cloudAgentDecode(&run)
			if decodeErr == nil && state.MediaTaskID != "" {
				s.startApprovedCloudAgentMediaWaiter(run.UserID, run.ID, state.MediaTaskID)
				continue
			}
			s.startCloudAgentPi(run.UserID, run.ID)
		}

		if len(runs) < 50 {
			return
		}
	}
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
	// ownSession 表示快照是本轮自己落库的，而不是续轮沿用的上一轮会话。
	ownSession := false
	if saved, sessionErr := s.repo.CloudAgentPiSession(userID, runID); sessionErr == nil && saved != nil && saved.SessionJSONL != "" {
		sessionJSONL = saved.SessionJSONL
		ownSession = true
	} else if sessionErr != nil && !errors.Is(sessionErr, gorm.ErrRecordNotFound) {
		return fmt.Errorf("load session: %w", sessionErr)
	}

	// 崩溃恢复：最后答案已写进会话快照、运行却没来得及标记完成。这一回合已经结束，
	// 直接收尾；再启动运行时会对同一提示词再调用一次模型、多扣一次费。
	// 例外：完成闸写下的插话续跑提示词（completeCloudAgentPiRun）晚于快照里的
	// 最终回答，必须真正跑出去——清空收尾会让已标记送达的插话永远到不了模型。
	if ownSession && cloudAgentPiTurnSettled(sessionJSONL, &runtimeState) {
		if !cloudAgentPiResumePromptDeliversInterjection(&runtimeState) {
			if runtimeState.PiResumePrompt != "" {
				if err := s.saveCloudAgentPiResumePrompt(userID, runID, ""); err != nil {
					return err
				}
			}
			return s.completeCloudAgentPiRun(userID, runID)
		}
	}

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
		SessionJSONL: sessionJSONL,
	})
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}

	// 6. 如果是恢复会话，使用恢复提示词
	if len(sessionJSONL) > 0 {
		request.Prompt = firstNonEmpty(runtimeState.PiResumePrompt, state.Request.Prompt)
	}

	// 7. 运行 Pi 会话
	var pausedForApproval atomic.Bool
	err = runCloudAgentPi(ctx, request, cloudAgentPiBridge{
		Model: func(callCtx context.Context, payload map[string]json.RawMessage) (any, error) {
			return s.cloudAgentPiModel(callCtx, userID, runID, payload)
		},
		Tool: func(callCtx context.Context, payload map[string]json.RawMessage) (any, error) {
			result, err := s.cloudAgentPiTool(callCtx, userID, runID, payload)
			if paused, ok := result.(map[string]any); ok && paused["pause"] == true {
				pausedForApproval.Store(true)
			}
			return result, err
		},
		Event: func(callCtx context.Context, payload map[string]json.RawMessage) (any, error) {
			return s.cloudAgentPiEvent(callCtx, userID, runID, payload)
		},
	})
	if err != nil {
		return err
	}

	// 本轮因审批暂停：运行由审批决定接管，不能在这里完成。用户可能在会话退出前
	// 就已批准，此时状态已回到 running，若继续会把未恢复的运行误标为完成。
	if pausedForApproval.Load() {
		return nil
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

// cloudAgentPiTurnSettled 判断本轮是否已在会话里完整结束：本轮已有成功的助手回复，
// 没有挂着的任务或审批，且会话最后一条消息是不带工具调用的正常结束回复。
// 只能用于本轮自己落库的快照：运行时的事件按顺序提交，助手回复计数增长之前，
// 含本轮用户提示的快照已经落库，所以最后一条完成回复一定属于本轮。
// 续轮沿用的上一轮会话最后一条也是完成回复，不能据此收尾。
func cloudAgentPiTurnSettled(sessionJSONL string, state *cloudAgentRuntime) bool {
	if sessionJSONL == "" || state == nil || state.PiAssistantResponses == 0 {
		return false
	}
	if state.ActiveTaskID != "" || state.MediaTaskID != "" || state.Approval != nil {
		return false
	}
	lines := strings.Split(strings.TrimRight(sessionJSONL, "\n"), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		var entry struct {
			Type    string `json:"type"`
			Message struct {
				Role       string `json:"role"`
				StopReason string `json:"stopReason"`
				Content    []struct {
					Type string `json:"type"`
				} `json:"content"`
			} `json:"message"`
		}
		if err := json.Unmarshal([]byte(lines[i]), &entry); err != nil {
			return false
		}
		if entry.Type != "message" {
			continue
		}
		if entry.Message.Role != "assistant" || entry.Message.StopReason != "stop" {
			return false
		}
		for _, block := range entry.Message.Content {
			if block.Type == "toolCall" {
				return false
			}
		}
		return true
	}
	return false
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
		resumed := false
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			if cloudAgentRunTerminal(current.Status) || current.Status == "waiting_approval" || current.Status == "waiting_user" {
				return nil
			}

			// 运行自然结束但队列里还有插话：它们没赶上最后一次 /model 出队，模型是
			// 在看不到它们的情况下给出的回答。预算还开得起下一步时，把插话作为续跑
			// 提示词再走一步（运行时按恢复提示词拉起新会话）；开不起时如实退回。
			// 续跑消耗的仍是本轮剩余预算，不是替用户自动开新一轮。
			if len(state.PendingInterjections) > 0 {
				if limits, limitsErr := s.cloudAgentStepLimits(); limitsErr == nil {
					state.StepLimits = limits
				}
				if !cloudAgentStepBudgetExhausted(&state) {
					state.PiResumePrompt = cloudAgentPiInterjectionResumePrompt(runID, &state)
					resumed = true
					return cloudAgentSave(current, &state)
				}
				cloudAgentDropInterjections(runID, "本轮已达到模型调用上限", &state)
			}

			current.Status = "completed"
			state.event(runID, "run_completed", map[string]any{
				"text":      "Agent 已完成",
				"timestamp": time.Now().Unix(),
			})

			return cloudAgentSave(current, &state)
		})

		if !errors.Is(err, repository.ErrCreationConflict) {
			if resumed && err == nil {
				s.resumeCloudAgentPi(userID, runID)
				return nil
			}
			return err
		}
	}

	return repository.ErrCreationConflict
}
