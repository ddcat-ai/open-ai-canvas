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

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type cloudAgentPiModelContextKey struct{}
type cloudAgentPiModelContext struct {
	Purpose      string
	SystemPrompt string
}

func cloudAgentPiModelOperation(ctx context.Context) string {
	options, _ := ctx.Value(cloudAgentPiModelContextKey{}).(cloudAgentPiModelContext)
	if options.Purpose == "compaction" {
		return cloudAgentContextCompactionOperation
	}
	return cloudAgentStepOperation
}

// cloudAgentPiModel 模型调用桥接
func (s *Service) cloudAgentPiModel(ctx context.Context, userID, runID string, payload map[string]json.RawMessage) (any, error) {
	var request struct {
		StepID        string           `json:"stepId"`
		Purpose       string           `json:"purpose"`
		SystemPrompt  string           `json:"systemPrompt"`
		Messages      []map[string]any `json:"messages"`
		Tools         []map[string]any `json:"tools"`
		ThinkingLevel string           `json:"thinkingLevel"`
	}
	if err := decodePiPayload(payload, &request); err != nil {
		return nil, err
	}
	if request.Purpose != "" && request.Purpose != "dialogue" && request.Purpose != "compaction" {
		return nil, BadAuthRequest("未知模型步骤类型")
	}
	if request.Purpose == "compaction" && strings.TrimSpace(request.SystemPrompt) == "" {
		return nil, BadAuthRequest("压缩步骤缺少摘要指令")
	}
	ctx = context.WithValue(ctx, cloudAgentPiModelContextKey{}, cloudAgentPiModelContext{request.Purpose, request.SystemPrompt})

	if len(request.Messages) == 0 {
		return nil, fmt.Errorf("no messages")
	}
	if len(request.StepID) > 120 || (cloudAgentFence(ctx) != nil && request.StepID == "") {
		return nil, BadAuthRequest("模型步骤缺少固定标识，未提交任务")
	}
	if _, err := s.ownedCloudAgent(ctx, userID, runID); err != nil {
		return nil, err
	}

	// 仅确认未受理且可重试的临时故障允许指数退避，首次失败后最多再试 3 次。
	// 已受理或提交结果未知时停止；参数/鉴权类 4xx 直接失败。
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
		stepCtx := ctx
		if request.StepID != "" {
			receiptMessages := request.Messages
			if request.Purpose == "compaction" {
				receiptMessages = append([]map[string]any{{"role": "system", "content": request.SystemPrompt}}, request.Messages...)
			}
			receipt, err := cloudAgentModelReceipt(userID, runID, fmt.Sprintf("%s:%d", request.StepID, attempt), receiptMessages, request.ThinkingLevel)
			if err != nil {
				return nil, err
			}
			receipt.Name = cloudAgentPiModelOperation(ctx)
			stepCtx = context.WithValue(ctx, cloudAgentModelReceiptKey{}, receipt)
		}
		result, retryable, err := s.runCloudAgentModelStep(stepCtx, userID, runID, request.Messages, request.ThinkingLevel, correction...)
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
	operation := cloudAgentPiModelOperation(ctx)
	var state cloudAgentRuntime
	for attempt := 0; attempt < 8; attempt++ {
		run, err := s.ownedCloudAgent(ctx, userID, runID)
		if err != nil {
			return nil, false, err
		}
		state, err = cloudAgentDecodeForExecution(run)
		if err != nil {
			return nil, false, err
		}
		if cloudAgentRunTerminal(run.Status) {
			return nil, false, fmt.Errorf("run already terminated")
		}
		state.ModelReceipt, _ = ctx.Value(cloudAgentModelReceiptKey{}).(*model.CloudAgentReceipt)
		if state.ModelReceipt != nil {
			stored, lookupErr := s.repo.CloudAgentReceipt(userID, runID, "model_step", state.ModelReceipt.OperationKey)
			if lookupErr == nil {
				if stored.InputSHA256 != state.ModelReceipt.InputSHA256 || stored.Name != state.ModelReceipt.Name {
					return nil, false, NewAppError(409, "模型步骤标识与输入不一致，未重新提交")
				}
				if stored.Status == "unknown" || stored.TaskID == "" {
					return nil, false, NewAppError(409, "模型提交结果需要核对，未自动重发")
				}
				task, err := s.repo.TaskForUser(userID, stored.TaskID)
				if err != nil || task.AgentRunID != runID || task.Operation != operation {
					return nil, false, NewAppError(409, "模型步骤任务归属不一致")
				}
				state.ActiveTaskID = stored.TaskID
				break
			}
			if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
				return nil, false, lookupErr
			}
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
			if err := s.settleCloudAgentMedia(userID, runID, cloudAgentFence(ctx)); err != nil {
				return nil, false, err
			}
			continue
		}
		// 重启恢复：上一个运行时进程已为这一步建好模型任务（可能已经出结果），
		// 只是没来得及把结果交回就退出了。运行时对 /model 串行调用，此时仍挂着的
		// 步骤任务只可能是这种遗留任务：接手等待它的结果，不再建新任务和订单。
		adopt, released, err := s.adoptCloudAgentPiModelStep(userID, runID, state.ActiveTaskID, cloudAgentFence(ctx))
		if err != nil {
			return nil, false, err
		}
		if adopt {
			if state.ModelReceipt != nil {
				return nil, false, NewAppError(409, "旧模型任务缺少步骤回执，需要核对后再继续")
			}
			break
		}
		if released {
			continue
		}

		// Pi 的原生分支（含压缩记录）是唯一历史来源。不能因消息变短而恢复旧全文。
		canonical := canonicalFromRuntimeMessages(messages, state.Canonical.Tools, state.Canonical.SystemPrompt)
		if operation == cloudAgentContextCompactionOperation {
			options, _ := ctx.Value(cloudAgentPiModelContextKey{}).(cloudAgentPiModelContext)
			canonical = canonicalFromRuntimeMessages(messages, nil, options.SystemPrompt)
		}
		var creationImages []providerMedia
		if operation != cloudAgentContextCompactionOperation && state.Request.Surface == "creation" {
			creationImages, err = s.attachCloudAgentCreationImages(userID, state.Request, &canonical)
			if err != nil {
				return nil, false, err
			}
		}

		canonical.PromptCacheKey = state.Canonical.PromptCacheKey
		if len(canonical.Messages) == 0 {
			return nil, false, fmt.Errorf("no canonical messages")
		}
		if operation != cloudAgentContextCompactionOperation {
			state.Canonical = canonical
		}
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
				"maxOutputTokens": min(cloudAgentStepOutputBudget(state.StepLimits, state.BoostStepOutputBudget), s.cloudAgentContextBudgetForRequest(state.Request).MaxOutputTokens),
			},
		}
		if len(creationImages) > 0 {
			input["referenceImages"] = creationImages
		}
		req := CreateTaskRequest{
			ProjectID: state.Request.CanvasID,
			Type:      "canvas_text",
			// Operation: cloudAgentStepOperation
			Operation:      operation,
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
		if truncated {
			attempt, lookupErr := s.repo.LatestRouteAttempt(taskID)
			if lookupErr != nil && !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
				return nil, false, lookupErr
			}
			// Provider error text cannot authorize a second submission with an unknown result.
			if lookupErr == nil && attempt.DispatchState == "submission_unknown" {
				truncated = false
			}
		}
		retryable := ctx.Err() == nil && (truncated || s.cloudAgentModelTaskRetryable(taskID))
		if retryable {
			// 释放失败的步骤，下一次重试才能重新入队。
			if releaseErr := s.finishCloudAgentPiModelStepWithReceipt(userID, runID, taskID, "", "", state.ModelReceipt, cloudAgentFence(ctx)); releaseErr != nil {
				return nil, false, releaseErr
			}
		}
		if truncated {
			err = fmt.Errorf("%w: %v", errCloudAgentTruncatedToolArguments, err)
		}
		if !retryable && ctx.Err() == nil {
			if receiptErr := s.markCloudAgentModelReceiptUnknown(ctx, userID, runID, state.ModelReceipt); receiptErr != nil {
				return nil, false, receiptErr
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
	if err := s.finishCloudAgentPiModelStepWithReceipt(userID, runID, task.ID, result.Text, result.Reasoning, state.ModelReceipt, cloudAgentFence(ctx)); err != nil {
		return nil, false, err
	}
	response := map[string]any{"text": result.Text, "reasoning": result.Reasoning, "toolCalls": runtimeToolCalls(result.ToolCalls)}
	if usage, available, err := s.repo.APICallLogUsageForTask(userID, task.ID); err != nil {
		return nil, false, err
	} else if available {
		// InputTokens 包含缓存；Pi 的 input/cacheRead 则互斥，不能二次加总。
		cacheRead := min(max(int64(0), usage.CachedTokens), usage.InputTokens)
		response["usage"] = map[string]any{
			"input": usage.InputTokens - cacheRead, "output": usage.OutputTokens,
			"cacheRead": cacheRead, "cacheWrite": 0, "totalTokens": usage.InputTokens + usage.OutputTokens,
		}
	}
	return response, false, nil
}

// adoptCloudAgentPiModelStep 判断挂着的活动任务能否作为本步结果直接接手。
// 排队、运行中或已成功的模型步骤直接接手；失败或已取消的先释放，由调用方重新调度。
// 其它活动任务（运行根任务、上下文压缩）保持原有流程。
func (s *Service) adoptCloudAgentPiModelStep(userID, runID, taskID string, fences ...*model.CloudAgentFence) (adopt, released bool, err error) {
	task, err := s.repo.TaskForUser(userID, taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	if task.Operation != cloudAgentStepOperation && task.Operation != cloudAgentContextCompactionOperation {
		return false, false, nil
	}
	switch task.Status {
	case model.TaskStatusQueued, model.TaskStatusRunning, model.TaskStatusSucceeded:
		return true, false, nil
	case model.TaskStatusFailed, model.TaskStatusCancelled:
		if err := s.finishCloudAgentPiModelStep(userID, runID, taskID, "", "", fences...); err != nil {
			return false, false, err
		}
		return false, true, nil
	}
	return false, false, nil
}

// cloudAgentPiThinkingEnabled treats an omitted thinking level the same as Pi's
// explicit "off" value. Pi omits the field when thinking is disabled, and the
// Go JSON decoder represents that omitted field as an empty string.
func cloudAgentPiThinkingEnabled(thinkingLevel string) bool {
	return thinkingLevel != "" && thinkingLevel != "off"
}

// cloudAgentModelTaskRetryable 先排除已受理或结果未知的提交，再判断临时故障。
// HTTP 状态本身不能证明可以安全重发；其余 4xx 直接失败。
func (s *Service) cloudAgentModelTaskRetryable(taskID string) bool {
	task, err := s.repo.Task(taskID)
	if err != nil || task == nil || task.Status == model.TaskStatusSucceeded || task.Status == model.TaskStatusCancelled {
		return false
	}
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		return false
	}
	if len(attempts) > 0 {
		last := attempts[len(attempts)-1]
		if last.DispatchState == "submission_unknown" || last.DispatchState == "accepted" {
			return false
		}
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
func (s *Service) finishCloudAgentPiModelStep(userID, runID, taskID, text, reasoning string, fences ...*model.CloudAgentFence) error {
	return s.finishCloudAgentPiModelStepWithReceipt(userID, runID, taskID, text, reasoning, nil, fences...)
}

func (s *Service) finishCloudAgentPiModelStepWithReceipt(userID, runID, taskID, text, reasoning string, receipt *model.CloudAgentReceipt, fences ...*model.CloudAgentFence) error {
	for attempt := 0; attempt < 8; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		cloudAgentBindFence(run, fences)
		var pressure *cloudAgentContextPressure
		var canonical canonicalAgentRequest
		finishedTask, taskErr := s.repo.TaskForUser(userID, taskID)
		if taskErr != nil {
			return taskErr
		}
		if finishedTask.Operation == cloudAgentStepOperation && finishedTask.Status == model.TaskStatusSucceeded {
			state, err := cloudAgentDecode(run)
			if err != nil {
				return err
			}
			// 完成任务会清理私有 input_json；实际模型上下文已在准入时持久化到 run。
			canonical = state.Canonical
			var input map[string]any
			if json.Unmarshal([]byte(finishedTask.InputJSON), &input) == nil {
				if value, ok := canonicalAgentRequestFromInput(input); ok {
					canonical = value
				}
			}
			if len(canonical.Messages) > 0 {
				// The meter describes the next request: the completed assistant
				// response is now context too. Use a copy, since Pi's native
				// branch will supply this message on its next /model call.
				var result struct {
					ToolCalls []cloudAgentCall `json:"toolCalls"`
				}
				_ = json.Unmarshal([]byte(finishedTask.ResultJSON), &result)
				if text != "" || len(result.ToolCalls) > 0 {
					message := map[string]any{"role": "assistant", "content": text}
					if len(result.ToolCalls) > 0 {
						message["tool_calls"] = result.ToolCalls
					}
					canonical.Messages = append(append([]map[string]any(nil), canonical.Messages...), message)
				}
				reading := s.cloudAgentContextPressure(canonical, state.Request.Prompt, state.Request)
				pressure = &reading
			}
		}
		err = s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			if receipt != nil {
				stored, err := repo.CloudAgentReceipt(userID, runID, "model_step", receipt.OperationKey)
				if err != nil {
					return err
				}
				if stored.InputSHA256 != receipt.InputSHA256 || stored.TaskID != taskID {
					return NewAppError(409, "模型步骤回执不一致")
				}
				stored.Status = "committed"
				if err := repo.SaveCloudAgentReceipt(stored); err != nil {
					return err
				}
			}
			fresh, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			if fresh.ActiveTaskID != taskID {
				return nil
			}
			task, err := repo.TaskForUser(userID, taskID)
			if err != nil {
				return err
			}
			if task.Operation == cloudAgentContextCompactionOperation {
				text, reasoning = "", ""
			} else {
				// 使用事务内的 repo，避免 SQLite 单连接嵌套查询死锁。
				measurementService := &Service{repo: repo}
				measurementService.recordCloudAgentTokenAnchor(userID, &fresh)
				if pressure != nil {
					payload := cloudAgentContextPressurePayload(*pressure, &fresh, canonical)
					payload["requestId"], payload["phase"] = taskID, "after_response"
					fresh.event(runID, "context_pressure", payload)
				}
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
