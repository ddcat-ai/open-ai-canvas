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
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const cloudAgentCompactionSummarySystemPromptPrefix = "You are a context summarization assistant."

type cloudAgentPiModelRequest struct {
	ModelID       string                    `json:"modelId"`
	SystemPrompt  string                    `json:"systemPrompt"`
	Messages      []map[string]any          `json:"messages"`
	Tools         []map[string]any          `json:"tools"`
	ThinkingLevel string                    `json:"thinkingLevel"`
	Purpose       string                    `json:"purpose"`
	ContextUsage  *cloudAgentPiContextUsage `json:"contextUsage"`
}

// cloudAgentPiContextUsage 是 Pi SDK 对当前会话上下文的原生读数。
// tokens/percent 使用指针以保留 Pi 在压缩后返回 null 的语义：没有新读数时，
// Go 不得用本地估算或旧值冒充当前占用。
type cloudAgentPiContextUsage struct {
	Tokens        *int     `json:"tokens"`
	ContextWindow int      `json:"contextWindow"`
	Percent       *float64 `json:"percent"`
}

func (s *Service) validateCloudAgentPiModelRequest(userID, runID string, request cloudAgentPiModelRequest) (bool, error) {
	compactionSummary := cloudAgentPiCompactionSummaryRequest(request.Messages)
	purpose := strings.TrimSpace(request.Purpose)
	switch purpose {
	case "":
		if compactionSummary {
			purpose = "compaction"
		} else {
			purpose = "conversation"
		}
	case "conversation":
		if compactionSummary {
			return false, errors.New("普通 Agent 模型请求不能携带压缩摘要上下文")
		}
	case "compaction":
		if !compactionSummary {
			return false, errors.New("压缩模型请求缺少压缩摘要系统提示")
		}
	default:
		return false, fmt.Errorf("未知的 Pi 模型请求 purpose: %s", purpose)
	}
	if purpose == "compaction" && len(request.Tools) > 0 {
		return false, errors.New("压缩模型请求不得携带 Agent 工具")
	}
	if strings.TrimSpace(request.ModelID) == "" {
		return compactionSummary, nil
	}
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return false, err
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		return false, err
	}
	expected := strings.TrimSpace(firstNonEmpty(state.Request.ChannelModelKey, state.Request.Model))
	if expected != "" && request.ModelID != expected {
		return false, fmt.Errorf("Pi 模型标识与运行配置不一致: got %q, want %q", request.ModelID, expected)
	}
	return compactionSummary, nil
}

// cloudAgentPiModel 模型调用桥接
func (s *Service) cloudAgentPiModel(ctx context.Context, userID, runID string, payload map[string]json.RawMessage) (any, error) {
	var request cloudAgentPiModelRequest
	if err := decodePiPayload(payload, &request); err != nil {
		return nil, err
	}
	compactionSummary, err := s.validateCloudAgentPiModelRequest(userID, runID, request)
	if err != nil {
		return nil, err
	}
	if len(request.Messages) == 0 {
		return nil, fmt.Errorf("no messages")
	}
	if !compactionSummary {
		if err := s.broadcastCloudAgentPiContextPressure(userID, runID, request.ContextUsage); err != nil {
			return nil, err
		}
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

// broadcastCloudAgentPiContextPressure 只转发 Pi SDK 的会话读数。
// 这是上下文占用的唯一对外口径；Go 不估算正文 Token，也不再用 API usage 锚点校准。
func (s *Service) broadcastCloudAgentPiContextPressure(userID, runID string, usage *cloudAgentPiContextUsage) error {
	if usage == nil || usage.Tokens == nil || usage.ContextWindow <= 0 {
		return nil
	}

	ratio := float64(*usage.Tokens) / float64(usage.ContextWindow)
	if usage.Percent != nil {
		ratio = *usage.Percent / 100
	}
	payload := map[string]any{
		"estimatedInputTokens": *usage.Tokens,
		"contextWindowTokens":  usage.ContextWindow,
		"usableInputTokens":    usage.ContextWindow,
		"compactAtTokens":      usage.ContextWindow * 80 / 100,
		"pressureRatio":        ratio,
		"modelLimitConfigured": true,
		"estimate":             true,
		"tokenSource":          "pi",
		"estimateMethod":       "pi-sdk",
		"readingScope":         "pi-session",
	}
	return s.broadcastAgentEvent(userID, runID, "context_pressure", payload)
}

// cloudAgentModelStepRetries 是单步模型调用首次失败后的最大重试次数。
const cloudAgentModelStepRetries = 3

// errCloudAgentAwaitingApproval 运行正在等用户审批，本步模型请求被拒绝（未入队、未计费）。
var errCloudAgentAwaitingApproval = errors.New("run is waiting for approval")

// errCloudAgentTruncatedToolArguments 标记"模型返回的工具参数不是完整 JSON"：
// 调用未执行，可以带纠偏上下文重做同一步。
var errCloudAgentTruncatedToolArguments = errors.New("truncated tool arguments")

// runCloudAgentModelStep 调度并等待一次模型步骤；第二个返回值表示失败是否值得重试。
func (s *Service) runCloudAgentModelStep(ctx context.Context, userID, runID string, messages []map[string]any, thinkingLevel string, correction ...map[string]any) (any, bool, error) {
	compactionSummary := cloudAgentPiCompactionSummaryRequest(messages)
	// 运行时发起 /model 的同时会并发推送事件（message_start、session_snapshot 等），
	// 这些事件也会推进运行 revision。调度模型步骤是 CAS 写入：冲突时重新读取
	// 最新状态再调度，而不是把整轮判失败。冲突时事务整体回滚，不会产生任务或扣费。
	var state cloudAgentRuntime
	// 本步送达的插话正文，随响应交给运行时 session.steer（见 cloud_agent_interjection_pi.go）。
	var steeringMessages []string
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
		// 等审批期间不接受新的模型步骤。运行时在审批暂停后中止会话是异步的，
		// 可能抢在中止生效前再请求一步；放它过去会多计一次费，返回的新工具调用
		// 还会顶掉待审批的调用。这里不入队、不改状态，审批结论照常接管运行。
		if run.Status == "waiting_approval" && state.Approval != nil {
			return nil, false, errCloudAgentAwaitingApproval
		}
		if cloudAgentStepBudgetExhausted(&state) {
			// 最终回答之后的插话续步会在这里撞上限；若确实停在最终回答边界，
			// 按完成收尾而不是把整轮判失败（见 settleCloudAgentPiFinalAnswer）。
			s.settleCloudAgentPiFinalAnswer(userID, runID)
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
		// 重启恢复：上一个运行时进程已为这一步建好模型任务（可能已经出结果），
		// 只是没来得及把结果交回就退出了。运行时对 /model 串行调用，此时仍挂着的
		// 步骤任务只可能是这种遗留任务：接手等待它的结果，不再建新任务和订单。
		adopt, released, err := s.adoptCloudAgentPiModelStep(userID, runID, state.ActiveTaskID)
		if err != nil {
			return nil, false, err
		}
		if adopt {
			break
		}
		if released {
			continue
		}

		canonical, historyErr := cloudAgentPiCanonicalForModelRequest(messages, state.Canonical)
		if historyErr != nil {
			return nil, false, historyErr
		}
		if len(canonical.Messages) == 0 {
			return nil, false, fmt.Errorf("no canonical messages")
		}
		// 运行时投影回写会洗掉插话来源标记，先补回再送达新插话；送达必须发生在
		// 入队这次 CAS 写入里（出队、canonical 追加与 delivered 事件同批落库），
		// 冲突重试时从最新状态重新出队，不会重复送达。压缩摘要请求不参与。
		if !compactionSummary {
			state.Canonical = canonical
			cloudAgentRestoreInterjectionSources(&state)
			steeringMessages = cloudAgentPiDeliverInterjections(runID, &state)
			canonical = state.Canonical
		}
		if len(correction) > 0 {
			// 纠偏上下文只用于这一次请求，不写回运行状态，避免下一步重复出现。
			canonical.Messages = append(append([]map[string]any(nil), canonical.Messages...), correction...)
		}
		// 看图后的历史里有 resource: 图片占位，必须随请求带上获准图片清单，
		// 否则预检以「模型协议引用了未获准的图片」拒绝（见 cloud_agent_pi_image_references.go）。
		references, refErr := s.cloudAgentPiStepImageReferences(userID, state.Request, &canonical)
		if refErr != nil {
			return nil, false, refErr
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
		if len(references) > 0 {
			input["referenceImages"] = references
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
	finishText, finishReasoning := result.Text, result.Reasoning
	if compactionSummary {
		finishText, finishReasoning = "", ""
	}
	if !compactionSummary {
		invalid, structural := cloudAgentBatchInvalidCalls(result.ToolCalls)
		if len(invalid) > 0 && (structural || state.InvalidArgumentSteps >= cloudAgentInvalidArgumentStepLimit) {
			// 结构类问题（ID 无效/重复、工具名无效）按 ID 配对纠偏会产生歧义，连续多批
			// 参数无效说明模型无法自我修正：两者都保持既有整步拒绝语义，
			// 释放任务避免重启后的 run 卡在无效 active task 上。
			if releaseErr := s.finishCloudAgentPiModelStep(userID, runID, task.ID, "", ""); releaseErr != nil {
				return nil, false, releaseErr
			}
			if structural {
				return nil, false, fmt.Errorf("invalid Pi tool calls: %w", validateCloudAgentCalls(result.ToolCalls))
			}
			return nil, false, fmt.Errorf("invalid Pi tool calls: 模型连续 %d 批工具调用未通过参数校验", cloudAgentInvalidArgumentStepLimit)
		}
		if len(invalid) > 0 {
			if err := s.finishCloudAgentPiModelStepWithInvalidCalls(userID, runID, task.ID, finishText, finishReasoning, result.ToolCalls, invalid); err != nil {
				return nil, false, err
			}
		} else if err := s.finishCloudAgentPiModelStep(userID, runID, task.ID, finishText, finishReasoning, result.ToolCalls); err != nil {
			return nil, false, err
		}
	} else if err := s.finishCloudAgentPiModelStep(userID, runID, task.ID, "", ""); err != nil {
		return nil, false, err
	}
	delivered := map[string]any{"text": result.Text, "reasoning": result.Reasoning, "toolCalls": runtimeToolCalls(result.ToolCalls)}
	if len(steeringMessages) > 0 {
		delivered["steeringMessages"] = steeringMessages
	}
	return delivered, false, nil
}

// adoptCloudAgentPiModelStep 判断挂着的活动任务能否作为本步结果直接接手。
// 排队、运行中或已成功的模型步骤直接接手；失败或已取消的先释放，由调用方重新调度。
// 其它活动任务（运行根任务、上下文压缩）保持原有流程。
func (s *Service) adoptCloudAgentPiModelStep(userID, runID, taskID string) (adopt, released bool, err error) {
	task, err := s.repo.TaskForUser(userID, taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	if task.Operation != cloudAgentStepOperation {
		return false, false, nil
	}
	switch task.Status {
	case model.TaskStatusQueued, model.TaskStatusRunning, model.TaskStatusSucceeded:
		return true, false, nil
	case model.TaskStatusFailed, model.TaskStatusCancelled:
		if err := s.finishCloudAgentPiModelStep(userID, runID, taskID, "", ""); err != nil {
			return false, false, err
		}
		return false, true, nil
	}
	return false, false, nil
}

func cloudAgentPiCanonicalForModelRequest(messages []map[string]any, existing canonicalAgentRequest) (canonicalAgentRequest, error) {
	compactionSummaryRequest := cloudAgentPiCompactionSummaryRequest(messages)
	if !compactionSummaryRequest {
		// 审批暂停会留下没有结果的并行工具调用，先补齐再转换（见 cloud_agent_pi_unanswered_calls.go）。
		messages = repairRuntimeUnansweredCalls(messages)
	}
	tools, systemPrompt := existing.Tools, existing.SystemPrompt
	if compactionSummaryRequest {
		tools, systemPrompt = nil, ""
	}
	canonical, conversionErr := canonicalFromRuntimeMessages(messages, tools, systemPrompt)
	if conversionErr != nil {
		return canonicalAgentRequest{}, conversionErr
	}
	if compactionSummaryRequest {
		return canonical, nil
	}
	if err := validateRuntimeMessagesForModel(messages); err != nil {
		if len(existing.Messages) == 0 {
			return canonicalAgentRequest{}, err
		}
		existing.Messages = repairCanonicalUnansweredCalls(existing.Messages)
		return existing, nil
	}
	// A projected Pi transcript containing a compaction summary is authoritative,
	// even though it is shorter than the server's pre-compaction canonical history.
	if !cloudAgentPiHasCompactionSummary(messages) && len(existing.Messages) > len(messages) {
		existing.Messages = repairCanonicalUnansweredCalls(existing.Messages)
		return existing, nil
	}
	canonical.PromptCacheKey = existing.PromptCacheKey
	return canonical, nil
}

func cloudAgentPiCompactionSummaryRequest(messages []map[string]any) bool {
	for _, message := range messages {
		if stringField(message, "role") != "system" {
			continue
		}
		if strings.HasPrefix(strings.TrimSpace(runtimeContentText(message["content"])), cloudAgentCompactionSummarySystemPromptPrefix) {
			return true
		}
	}
	return false
}

// cloudAgentPiThinkingEnabled treats an omitted thinking level the same as Pi's
// explicit "off" value. Pi omits the field when thinking is disabled, and the
// Go JSON decoder represents that omitted field as an empty string.
func cloudAgentPiThinkingEnabled(thinkingLevel string) bool {
	return thinkingLevel != "" && thinkingLevel != "off"
}

// cloudAgentTransientModelFailure recognizes providers that returned a business
// error envelope instead of a useful HTTP status. Some gateways return 200 with
// codes such as openai_error/api_error; those failures are still safe to retry
// because the model task has not produced an assistant result yet.
func cloudAgentTransientModelFailure(call model.ApiCallLog) bool {
	if call.Status != model.ApiCallStatusFailed {
		return false
	}
	// A permanent HTTP 4xx must win over a generic business-error label. The
	// caller handles 429 separately as an explicitly retryable rate limit.
	if call.StatusCode >= 400 && call.StatusCode < 500 {
		return false
	}
	text := strings.ToLower(strings.TrimSpace(call.ErrorCode + " " + call.Error))
	for _, marker := range []string{"invalid_request", "authentication", "permission", "forbidden", "model_not_found", "insufficient_quota", "content_policy", "sensitive_words", "safety"} {
		if strings.Contains(text, marker) {
			return false
		}
	}
	for _, marker := range []string{"openai_error", "api_error", "server_error", "temporarily_unavailable", "service_unavailable", "overloaded", "gateway_error", "rate_limit", "too_many_requests", "upstream_timeout"} {
		if strings.Contains(text, marker) {
			return true
		}
	}
	return false
}

// cloudAgentModelTaskRetryable 按上游真实 HTTP 状态和结构化业务错误判断失败是否是临时性的：
// 5xx、429、408、明确的临时业务错误和没有拿到任何响应的网络错误可以重试；
// 参数、鉴权、模型不存在和内容审核错误不会重试。
func (s *Service) cloudAgentModelTaskRetryable(taskID string) bool {
	task, err := s.repo.Task(taskID)
	if err != nil || task == nil || task.Status == model.TaskStatusSucceeded || task.Status == model.TaskStatusCancelled {
		return false
	}
	if cloudAgentEmptyModelOutput(task) || cloudAgentStepTimedOut(task) {
		return true
	}
	call, err := s.repo.LatestAPICallForTask(taskID)
	if err != nil {
		return false
	}
	if cloudAgentTransientModelFailure(call) {
		return true
	}
	status := call.StatusCode
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

// finishCloudAgentPiModelStep 释放已完成的模型步骤，并把模型结果提交到运行检查点。
// calls 只在普通会话模型调用中传入；压缩摘要调用不应污染普通 canonical 历史、工具批次或步数。
// 不释放 ActiveTaskID 的话，completeCloudAgentPiRun 会一直认为还有任务在跑。
func (s *Service) finishCloudAgentPiModelStep(userID, runID, taskID, text, reasoning string, callBatches ...[]cloudAgentCall) error {
	var calls []cloudAgentCall
	if len(callBatches) > 0 {
		calls = callBatches[0]
		if err := validateCloudAgentCalls(calls); err != nil {
			return err
		}
	}
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
			if len(callBatches) > 0 {
				// 一批全部有效的调用意味着模型回到了正常输出轨道，参数纠偏计数清零。
				fresh.InvalidArgumentSteps = 0
			}
			if reasoning != "" {
				fresh.event(runID, "reasoning_message", map[string]any{"messageId": taskID + ":reasoning", "text": truncateRunes(reasoning, 8000)})
			}
			if len(callBatches) > 0 {
				fresh.Canonical.ToolChoice = "auto"
				fresh.Calls = append([]cloudAgentCall(nil), calls...)
				fresh.CallIndex = 0
				fresh.StepSnapshotHash = cloudAgentCaptureStepSnapshotHash(calls)
			}
			if text != "" {
				fresh.event(runID, "assistant_message", map[string]any{"messageId": taskID, "text": text})
			}
			if len(callBatches) > 0 {
				if len(calls) > 0 {
					fresh.Canonical.Messages = append(fresh.Canonical.Messages, map[string]any{
						"role": "assistant", "content": text, "tool_calls": calls,
					})
				} else if text != "" {
					fresh.Canonical.Messages = append(fresh.Canonical.Messages, map[string]any{"role": "assistant", "content": text})
				}
			}
			return cloudAgentSave(current, &fresh)
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
	}
	return repository.ErrCreationConflict
}

// finishCloudAgentPiModelStepWithInvalidCalls 提交一个含无效调用的模型步骤（参数纠偏轮）。
//
// 模型一步里可能混发有效与无效调用——线上 run ag3580aca 就是把整份剧本大纲塞进
// canvas_apply_ops 的参数超过字节上限，此前整批被当致命协议错误判死成「Agent 执行中断」。
// 参数超限是模型输出问题而非运行时故障：无效调用立即以结构化错误回执（invalid_model_output，
// 指引拆分重试），有效调用照常进入执行批次；assistant 消息保留全部调用，canonical 的
// 调用/结果配对保持完整。连续 cloudAgentInvalidArgumentStepLimit 批无效才回到硬失败。
func (s *Service) finishCloudAgentPiModelStepWithInvalidCalls(userID, runID, taskID, text, reasoning string, calls []cloudAgentCall, invalid map[int]string) error {
	valid := make([]cloudAgentCall, 0, len(calls))
	for index, call := range calls {
		if _, rejected := invalid[index]; !rejected {
			valid = append(valid, call)
		}
	}
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
			fresh.InvalidArgumentSteps++
			if reasoning != "" {
				fresh.event(runID, "reasoning_message", map[string]any{"messageId": taskID + ":reasoning", "text": truncateRunes(reasoning, 8000)})
			}
			fresh.Canonical.ToolChoice = "auto"
			fresh.Calls = valid
			fresh.CallIndex = 0
			fresh.StepSnapshotHash = cloudAgentCaptureStepSnapshotHash(valid)
			if text != "" {
				fresh.event(runID, "assistant_message", map[string]any{"messageId": taskID, "text": text})
			}
			fresh.Canonical.Messages = append(fresh.Canonical.Messages, map[string]any{
				"role": "assistant", "content": text, "tool_calls": calls,
			})
			rejected := make([]string, 0, len(invalid))
			for index, call := range calls {
				reason, ok := invalid[index]
				if !ok {
					continue
				}
				receipt, _ := json.Marshal(map[string]any{
					"error":           "该工具调用未通过参数校验：" + reason + "。本次调用没有执行，其余同批调用不受影响。",
					"errorClass":      cloudAgentToolErrorInvalidModelOutput,
					"errorClassLabel": cloudAgentToolErrorLabel(cloudAgentToolErrorInvalidModelOutput),
					"requiredAction":  "fix_arguments",
				})
				fresh.Canonical.Messages = append(fresh.Canonical.Messages, map[string]any{
					"role": "tool", "tool_call_id": call.ID, "content": string(receipt),
				})
				rejected = append(rejected, call.Function.Name)
			}
			fresh.event(runID, "tool_arguments_rejected", map[string]any{
				"toolNames": rejected, "attempt": fresh.InvalidArgumentSteps,
				"maxAttempts": cloudAgentInvalidArgumentStepLimit,
				"text":        "模型工具调用参数未通过校验，已回执要求修正后重试",
			})
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
