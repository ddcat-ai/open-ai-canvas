// Agent 运行时的模型调用桥：把运行时的一次模型请求转成平台文本任务并等待结果。
//
// 模型步走平台任务体系（计费、渠道路由、超时都复用文本任务）；临时故障与
// 截断的工具参数会在同一步内重试，次数上限见 cloudAgentModelStepRetries。

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

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
	// 模型吐出损坏的工具参数 JSON（截断或多一个括号）时，那次调用并没有被执行：
	// 与 Go 执行循环的 correctCloudAgentTruncatedCalls 一致，附上 truncated_tool_arguments
	// 纠偏上下文重做这一步，而不是把整轮判死。次数与临时故障共用同一个上限。
	var lastErr error
	var correction []map[string]any
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
		result, retryable, err := s.runCloudAgentModelStep(ctx, userID, runID, request.Messages, request.ThinkingLevel, correction...)
		if err == nil {
			return result, nil
		}
		lastErr = err
		if !retryable {
			return nil, err
		}
		if errors.Is(err, errCloudAgentTruncatedToolArguments) && correction == nil {
			correction = []map[string]any{cloudAgentRuntimeMessage(cloudAgentRuntimeContext{Kind: cloudAgentContextTruncatedArguments})}
		}
	}
	return nil, lastErr
}

// cloudAgentModelStepRetries 是单步模型调用首次失败后的最大重试次数。
const cloudAgentModelStepRetries = 3

// errCloudAgentTruncatedToolArguments 标记"模型返回的工具参数不是完整 JSON"：
// 调用未执行，可以带纠偏上下文重做同一步。
var errCloudAgentTruncatedToolArguments = errors.New("truncated tool arguments")

// runCloudAgentModelStep 调度并等待一次模型步骤；第二个返回值表示失败是否值得重试。
func (s *Service) runCloudAgentModelStep(ctx context.Context, userID, runID string, messages []map[string]any, thinkingLevel string, correction ...map[string]any) (any, bool, error) {
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
		// A continuation starts a fresh Pi process. If its session snapshot was
		// unavailable, the runtime transcript is shorter than the server-authored
		// canonical history. Reuse canonical directly so provider tool_calls are
		// not accidentally converted as if they were Pi content blocks.
		if len(state.Canonical.Messages) > len(messages) {
			canonical = state.Canonical
		}
		canonical.PromptCacheKey = state.Canonical.PromptCacheKey
		if len(canonical.Messages) == 0 {
			return nil, false, fmt.Errorf("no canonical messages")
		}
		state.Canonical = canonical
		if len(correction) > 0 {
			// 纠偏上下文只用于这一次请求，不写回运行状态，避免下一步重复出现。
			canonical.Messages = append(append([]map[string]any(nil), canonical.Messages...), correction...)
		}
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
				"thinking":        cloudAgentPiThinkingEnabled(thinkingLevel),
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
		truncated := false
		if failed, lookupErr := s.repo.Task(taskID); lookupErr == nil && failed != nil && failed.Status != model.TaskStatusSucceeded {
			truncated = cloudAgentTruncatedToolArguments(failed)
		}
		retryable := ctx.Err() == nil && (truncated || s.cloudAgentModelTaskRetryable(taskID))
		if retryable {
			// 释放失败的步骤，下一次重试才能重新入队。
			if releaseErr := s.finishCloudAgentPiModelStep(userID, runID, taskID, "", ""); releaseErr != nil {
				return nil, false, releaseErr
			}
		}
		if truncated {
			err = fmt.Errorf("%w: %v", errCloudAgentTruncatedToolArguments, err)
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

// cloudAgentPiThinkingEnabled treats an omitted thinking level the same as Pi's
// explicit "off" value. Pi omits the field when thinking is disabled, and the
// Go JSON decoder represents that omitted field as an empty string.
func cloudAgentPiThinkingEnabled(thinkingLevel string) bool {
	return thinkingLevel != "" && thinkingLevel != "off"
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
