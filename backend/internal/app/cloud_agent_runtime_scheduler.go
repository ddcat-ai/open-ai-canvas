// 画布 Agent 的调度循环：领取待推进的运行、执行一步、写回检查点。
//
// 调度器按 run 粒度串行推进（乐观锁 revision + CAS）；同一轮的模型调用、工具执行、
// 媒体提交都拆成可重入的小步，进程在任意一步退出后都能从最新检查点继续。

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func (s *Service) cloudAgentExecutionOutput(task *model.Task, initial cloudAgentState, options ...CloudAgentRunViewOptions) (*CloudAgentRun, error) {
	run, err := s.repo.CloudAgent(task.UserID, task.ID)
	if err != nil {
		return nil, err
	}
	state, stateErr := cloudAgentDecode(run)
	if stateErr != nil {
		// A terminal failed run must remain readable even if its durable runtime
		// blob was damaged. Do not invent permissions or approval state; expose
		// only the identity available from the original task input.
		state = cloudAgentRuntime{Request: initial.Request, ParentID: initial.ParentID, CreativeAnchor: initial.CreativeAnchor, Skills: initial.Skills, Profile: initial.Profile, TaskIDs: []string{task.ID}, Events: []CloudAgentEvent{}}
	}
	out := agentRunOutput(task, initial)
	out.Status = run.Status
	out.Revision, out.CleanupPending, out.FailureMessage = run.Revision, run.CleanupPending, run.FailureMessage
	out.UpdatedAt = run.UpdatedAt
	view := CloudAgentRunViewOptions{}
	if len(options) > 0 {
		view = options[0]
	}
	// 事件已全量落库，运行详情只返回一页：默认是尾部窗口，sinceSeq 只取增量。
	// 四个位置字段与 events 一起返回，客户端据此判断"是否还有更早的记录"。
	out.Events = s.cloudAgentRunEventsForView(task.UserID, run, &state, view.SinceSeq, view.EventLimit)
	// EventSeqBase 必须与真正返回的这一页对齐（eventLimit 把它收窄时也一样），
	// 不变量 events[i].seq == eventSeqBase + i + 1 才成立。页为空时退回窗口水位：
	// 那时没有"首条事件"，但仍然要能说明窗口在整条日志里的位置。
	out.EventSeqBase = state.EventSeqBase
	if len(out.Events) > 0 {
		out.EventSeqBase = out.Events[0].Seq - 1
	}
	out.EventCount = s.cloudAgentRunEventCount(task.UserID, run, &state)
	if len(out.Events) > 0 {
		out.LatestSeq = out.Events[len(out.Events)-1].Seq
	}
	if view.SinceSeq == 0 && len(out.Events) < out.EventCount {
		out.EventsTruncated = true
	}
	out.Approval = state.Approval
	if cloudAgentRunTerminal(run.Status) {
		out.Approval = nil
	}
	out.Step = state.Step
	if stateErr == nil && state.ActiveTaskID != "" && (run.Status == "running" || run.Status == "queued") {
		active, err := s.repo.TaskForUser(task.UserID, state.ActiveTaskID)
		if err != nil {
			return nil, err
		}
		if active.TextDraft != "" {
			out.ActiveMessage = map[string]string{"messageId": active.ID, "text": active.TextDraft}
		}
	}
	out.Skills = make([]cloudAgentSkill, 0, len(state.Skills))
	for _, skill := range state.Skills {
		skill.Instruction = ""
		skill.Files = nil
		out.Skills = append(out.Skills, skill)
	}
	orders, err := s.repo.BillingOrdersByTaskIDs(task.UserID, state.TaskIDs)
	if err != nil {
		return nil, err
	}
	for _, order := range orders {
		// AmountMicrocredits is the reservation/quote, not necessarily the amount
		// finally charged. A run can reserve 100000 microcredits and settle at
		// 100000 microcredits (= 0.1 credits), or be refunded altogether. Never
		// expose the reservation as spend, otherwise the Agent claims a charge
		// that did not happen and budget/usage copy diverges from billing.
		if order.Status == model.BillingStatusSettled {
			out.SpentCredits += float64(order.ActualAmountMicrocredits) / float64(CreditScale)
		}
	}
	return out, nil
}

// Runs one bounded transition at a time; no model HTTP call or approval wait holds a DB lock.
func (s *Service) advanceCloudAgentByID(userID, id string) error {
	// Do not decode the task input/runtime before checking for an existing
	// execution. A damaged runtime must be terminally recoverable, not
	// accidentally replaced by a fresh execution row.
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		return err
	}
	if task.Operation != cloudAgentOperation {
		return kernel.NotFound("Agent 运行不存在")
	}
	run, lookupErr := s.repo.CloudAgent(userID, id)
	if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		_, initial, taskErr := s.cloudAgentTask(userID, id)
		if taskErr != nil {
			return taskErr
		}
		if err := s.ensureCloudAgentExecution(task, initial); err != nil {
			return err
		}
		run, lookupErr = s.repo.CloudAgent(userID, id)
	}
	if lookupErr != nil {
		return lookupErr
	}
	return s.advanceCloudAgent(run)
}

func (s *Service) advanceCloudAgents() {
	s.agentSchedulerMu.Lock()
	defer s.agentSchedulerMu.Unlock()
	roots, err := s.repo.CloudAgentRoots()
	if err != nil {
		log.Printf("agent recovery: %v", err)
		return
	}
	for _, task := range roots {
		_, state, e := s.cloudAgentTask(task.UserID, task.ID)
		if e == nil {
			e = s.ensureCloudAgentExecution(&task, state)
		}
		if e != nil {
			log.Printf("agent recovery %s: %v", task.ID, e)
		}
	}
	runs, err := s.repo.ActiveCloudAgentsAfter(s.agentSchedulerCursor, 50)
	if err == nil && len(runs) == 0 && s.agentSchedulerCursor != "" {
		s.agentSchedulerCursor = ""
		runs, err = s.repo.ActiveCloudAgentsAfter("", 50)
	}
	if err != nil {
		log.Printf("agent scheduler: %v", err)
		return
	}
	for i := range runs {
		s.agentSchedulerCursor = runs[i].ID
		if s.terminateStuckCloudAgent(&runs[i]) {
			continue
		}
		err = s.advanceCloudAgent(&runs[i])
		if err == nil {
			s.clearCloudAgentSchedulerConflict(runs[i].ID)
			continue
		}
		if errors.Is(err, repository.ErrCreationConflict) {
			s.noteCloudAgentSchedulerConflict(runs[i].ID)
			continue
		}
		log.Printf("agent transition %s: %v", runs[i].ID, err)
	}
}

// wakeCloudAgentScheduler lets a completed model step resume its Agent without
// waiting for the periodic recovery scan. The ticker remains authoritative for
// other workers and missed in-process notifications.
func (s *Service) wakeCloudAgentScheduler() {
	if s == nil || s.agentSchedulerWake == nil {
		return
	}
	select {
	case s.agentSchedulerWake <- struct{}{}:
	default:
	}
}

func (s *Service) advanceCloudAgent(run *model.CloudAgentExecution) (err error) {
	defer func() {
		if errors.Is(err, errCloudAgentCheckpoint) {
			message := "Agent 运行状态保存失败，本轮已停止；已有任务结果保留在任务中心"
			var checkpointErr *cloudAgentCheckpointError
			if errors.As(err, &checkpointErr) {
				log.Printf("agent checkpoint rejected run=%s stage=%s error=%v", run.ID, checkpointErr.Stage, checkpointErr.Err)
				if checkpointErr.Stage == "state size" {
					message = "Agent 上下文或执行记录超过安全限制，本轮已停止；已有任务结果保留在任务中心"
				}
			} else {
				message = "Agent 运行状态保存失败，本轮已停止；已有任务结果保留在任务中心"
			}
			err = s.terminateCloudAgent(run, message)
		}
	}()
	if run.CleanupPending {
		return s.finishCloudAgentCleanup(context.Background(), run)
	}
	if run.Status != "running" && run.Status != "queued" {
		return nil
	}
	state, err := cloudAgentDecodeForExecution(run)
	if err != nil {
		var appErr *AppError
		if errors.As(err, &appErr) && appErr != nil {
			return s.terminateCloudAgent(run, appErr.Message)
		}
		return s.terminateCloudAgent(run, "Agent 运行状态损坏，本轮已停止")
	}
	// 单步边界每次推进都重新解析：管理员改配置后，正在跑的这一轮下一步就用新值。
	state.StepLimits, err = s.cloudAgentStepLimits()
	if err != nil {
		return err
	}
	if state.ActiveTaskID != "" {
		task, err := s.repo.TaskForUser(run.UserID, state.ActiveTaskID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return s.terminateCloudAgent(run, "Agent 模型任务已不存在，本轮已停止")
		}
		if err != nil {
			return err // Transient database failures must not terminate a live task.
		}
		// 停在压缩上时，这个在跑的任务就是压缩调用：它的结果只用来生成检查点，
		// 不走"正文/工具调用"那套解析，也不会计入步数。
		if state.ContextCompaction != nil {
			return s.advanceCloudAgentContextCompaction(run, &state, task)
		}
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			// 将已持久化的模型增量转成 Agent 事件；不拆分完整答案伪装成流式。
			if task.TextDraft != state.ActiveTextDraft {
				delta := ""
				eventType := "assistant_snapshot"
				payload := map[string]any{"messageId": task.ID, "text": task.TextDraft, "replace": true}
				if strings.HasPrefix(task.TextDraft, state.ActiveTextDraft) {
					delta = strings.TrimPrefix(task.TextDraft, state.ActiveTextDraft)
					if delta == "" {
						return nil
					}
					eventType = "assistant_delta"
					payload = map[string]any{"messageId": task.ID, "text": delta}
				}
				if err := s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
					state.event(run.ID, eventType, payload)
					state.ActiveTextDraft = task.TextDraft
					return cloudAgentSave(current, &state)
				}); err != nil {
					return err
				}
			}
			return nil
		}
		var result struct {
			Text      string           `json:"text"`
			Reasoning string           `json:"reasoning"`
			ToolCalls []cloudAgentCall `json:"toolCalls"`
			Legacy    []cloudAgentCall `json:"tool_calls"`
		}
		if task.Status == model.TaskStatusSucceeded {
			if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
				return s.terminateCloudAgent(run, "模型任务结果损坏，本轮已停止")
			}
			calls := result.ToolCalls
			if len(calls) == 0 {
				calls = result.Legacy
			}
			if violation := cloudAgentOutputViolation(result.Text, len(calls)); violation != "" {
				return s.correctCloudAgentOutput(run, &state, violation)
			}
			if err := validateCloudAgentCalls(calls); err != nil {
				return s.correctCloudAgentOutput(run, &state, "工具调用无效或重复（callId 不能重复、参数必须是 JSON 对象）")
			}
			result.ToolCalls = calls
		}
		if task.Status != model.TaskStatusSucceeded && cloudAgentTruncatedToolArguments(task) {
			return s.correctCloudAgentTruncatedCalls(run, &state)
		}
		if cloudAgentEmptyModelOutput(task) {
			if state.EmptyOutputNudged < cloudAgentMaxEmptyOutputNudges {
				return s.correctCloudAgentEmptyOutput(run, &state)
			}
			// 催过仍然空：改为"关思考 + 放大输出预算"重试同一步，而不是把整轮判死。
			if state.EmptyOutputEscalated < cloudAgentMaxEmptyOutputEscalations {
				return s.correctCloudAgentEmptyOutputEscalation(run, &state)
			}
		}
		// 单步墙钟到点同样是可恢复失败：关思考重试一次，而不是把整轮判死。
		if cloudAgentStepTimedOut(task) && state.StepTimeoutEscalated < cloudAgentMaxStepTimeoutEscalations {
			return s.correctCloudAgentStepTimeout(run, &state)
		}
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			if task.Status != model.TaskStatusSucceeded {
				current.Status = "failed"
				text, reason := cloudAgentModelFailure(task)
				current.FailureMessage = truncateRunes(text, 1000)
				cloudAgentDropInterjections(run.ID, "本轮已结束："+truncateRunes(text, 120), &state)
				state.event(run.ID, "run_failed", map[string]any{"text": text, "reason": reason, "taskId": task.ID})
				return cloudAgentSave(current, &state)
			}
			calls := result.ToolCalls
			if result.Reasoning != "" {
				state.event(run.ID, "reasoning_message", map[string]any{"messageId": task.ID + ":reasoning", "text": truncateRunes(result.Reasoning, 8000)})
			}
			if result.Text != "" {
				state.event(run.ID, "assistant_message", map[string]any{"messageId": task.ID, "text": result.Text})
				// 普通正文可能是读取失败或多图混合回答，不能自动归为某张图的视觉事实。
				if len(calls) == 0 {
					state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": result.Text})
				}
			}
			state.ActiveTaskID = ""
			if len(calls) > 0 || strings.TrimSpace(result.Text) != "" {
				state.EmptyOutputNudged = 0
			}
			state.Canonical.ToolChoice = "auto"
			state.Calls = calls
			state.CallIndex = 0
			state.StepSnapshotHash = cloudAgentCaptureStepSnapshotHash(calls)
			if len(calls) > 0 {
				state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": result.Text, "tool_calls": calls})
			}
			if len(calls) == 0 {
				if len(state.PendingInterjections) > 0 {
					if !cloudAgentStepBudgetExhausted(&state) {
						return cloudAgentSave(current, &state)
					}
					cloudAgentDropInterjections(run.ID, "本轮已达到模型调用上限", &state)
				}
				if !cloudAgentStepBudgetExhausted(&state) && !state.ActionNudged {
					if pending := cloudAgentPendingPlanItems(state.Plan); len(pending) > 0 {
						state.ActionNudged = true
						state.Canonical.Messages = append(state.Canonical.Messages, cloudAgentPlanNudgeMessage(&state, pending[0]))
						return cloudAgentSave(current, &state)
					}
				}
				current.Status = "completed"
			}
			return cloudAgentSave(current, &state)
		})
	}
	if state.CallIndex < len(state.Calls) {
		if handled, err := s.advanceCloudAgentReadBatch(run, &state); handled {
			return err
		}
		return s.advanceCloudAgentTool(run, &state)
	}
	// 兜底 flush：本批调用都执行完了（无论最后一个调用是不是看图、有没有被中断），
	// 缓冲里的图片必须在这里合并成一条 user 消息落到全部 tool 结果之后。少了这一步，
	// "看图不是最后一个调用"的批次会把图片永久丢掉，而对应的 tool 回执已经在历史里。
	// 幂等：正常路径（最后一个调用就是看图）已经在 cloudAgentRecordToolResult 里 flush 过。
	cloudAgentFlushPendingImages(&state)
	// 已经请求过压缩：这次推进只负责把压缩调用发出去（它不计入步数，见 enqueueCloudAgentTask）。
	if state.ContextCompaction != nil && state.ContextCompaction.Status == "requested" {
		return s.enqueueCloudAgentContextCompaction(run, &state)
	}
	contextBudget := s.cloudAgentContextBudgetForRequest(state.Request)
	if compactCloudAgentContext(&state.Canonical, contextBudget) {
		// Evicted read bodies must be obtainable again after compaction.
		state.ProfileReads = nil
	}
	if stepLimit := cloudAgentStepLimit(state.Request); stepLimit > 0 && state.Step >= stepLimit {
		return s.failCloudAgent(run, &state, fmt.Sprintf("达到 %d 次模型调用上限，本轮已停止", stepLimit))
	}
	cloudAgentDrainInterjections(run.ID, &state)
	// 轮内唯一裁剪 = 图片：超出保留轮次的看图结果换成文字回执（正文一律保留）。
	// 它必须在压缩判定之前跑：图片是最贵的一类内容，先移出再评估 token 压力才有意义。
	if changed, pruned := cloudAgentPruneInspectedImages(&state.Canonical, nil); changed {
		state.event(run.ID, "context_images_pruned", map[string]any{
			"prunedImages": pruned, "retentionRounds": cloudAgentImageRetentionRounds,
			"text": "图片裁剪：移出超出保留轮次的看图结果",
		})
	}
	canonical, contextErr := s.cloudAgentModelContext(run, &state, contextBudget)
	if contextErr != nil {
		// 真实任务帧与用户要求有时在下一步建模时就超过输入预算；
		// 它会先于下方常规 token 判据失败，仍需给语义压缩一次机会。
		if errors.Is(contextErr, errCloudAgentContextOverBudget) {
			if requested, err := s.cloudAgentRequestCompaction(run, &state, contextBudget, contextBudget.CompactAtTokens); err != nil || requested {
				return err
			}
		}
		var appErr *AppError
		if errors.As(contextErr, &appErr) {
			return s.failCloudAgent(run, &state, appErr.Message)
		}
		return contextErr
	}
	s.attachCloudAgentLessons(&canonical, run.UserID, cloudAgentLessonTaskText(&state))
	references, refErr := s.cloudAgentImageReferences(run.UserID, state.Request, &canonical)
	if refErr != nil {
		return s.failCloudAgent(run, &state, cloudAgentSafeToolError(refErr))
	}
	// 单步输出上限与思考开关：默认按策略给每一步带上界（不带上界时上游按剩余上下文放行，
	// 思考模型可以把单步拖到几分钟）；空输出升级重试时改为关思考 + 放大预算。
	stepThinking := cloudAgentReasoningEnabled(state.Policy.ReasoningMode) && !state.ForceThinkingOff
	stepOutputTokens := cloudAgentStepOutputBudget(state.StepLimits, state.BoostStepOutputBudget)
	input := map[string]any{"mode": "text", "prompt": state.Request.Prompt, "agentRequests": map[string]any{"canonical": canonical}, "config": map[string]any{"channelId": state.Request.ChannelID, "channelModelKey": state.Request.ChannelModelKey, "model": firstNonEmpty(state.Request.ChannelModelKey, state.Request.Model)}, "textOptions": map[string]any{"stream": true, "thinking": stepThinking, "maxOutputTokens": stepOutputTokens}}
	if len(references) > 0 {
		input["referenceImages"] = references
	}
	tokens, tokenErr := cloudAgentRequestEstimatedTokens(&canonical)
	if tokenErr != nil {
		return s.failCloudAgent(run, &state, "模型上下文估算失败，请稍后重试")
	}
	// 超预算不再直接判死：先暂停步进、把历史压成结构化检查点，压完用压缩后的上下文继续本轮。
	// 次数上限（cloudAgentMaxCompactionsPerRun）用完仍超预算时，才回到下面的判死路径。
	// 分工：这是轮内的**语义压缩**（触发者是 token 线，或没配窗口时的字节/条数兜底）；
	// compactCloudAgentContext 是轮内可重读正文的**就地卸载**，跨轮 textHistory 由
	// trimCloudAgentTextHistory 兜底——三者对象不同、不会互相打架。
	if requested, err := s.cloudAgentRequestCompaction(run, &state, contextBudget, tokens); err != nil || requested {
		return err
	}
	if tokens > contextBudget.InputBudgetTokens {
		return s.failCloudAgent(run, &state, cloudAgentContextBudgetMessage(contextBudget))
	}
	req := CreateTaskRequest{ProjectID: state.Request.CanvasID, Type: "canvas_text", Operation: "cloud_agent_step", Prompt: state.Request.Prompt, Model: state.Request.Model, LogicalModelID: state.Request.LogicalModelID, Input: input}
	return s.enqueueCloudAgentTask(run, &state, req, nil)
}

func compactCloudAgentContext(request *canonicalAgentRequest, budget cloudAgentContextBudget) bool {
	if request == nil {
		return false
	}
	tokens, err := cloudAgentRequestEstimatedTokens(request)
	if err != nil || tokens < budget.CompactAtTokens {
		return false
	}
	// Retain the latest complete tool turn. Never remove call/result envelopes,
	// user instructions, call arguments or write receipts to fabricate a summary.
	cut := len(request.Messages) - 1
	for cut > 0 && stringField(request.Messages[cut], "role") == "tool" {
		cut--
	}
	changed := false
	for _, message := range request.Messages[:max(0, cut)] {
		if stringField(message, "role") != "tool" {
			continue
		}
		var result map[string]any
		if json.Unmarshal([]byte(stringField(message, "content")), &result) != nil || result["contextCompacted"] == true {
			continue
		}
		// Only omit re-readable bodies. Preserve IDs, errors, generation status,
		// approvals and all other structured facts verbatim.
		omitted := false
		if nodes, ok := result["nodes"].([]any); ok {
			facts := make([]map[string]any, 0, len(nodes))
			for _, value := range nodes {
				if node, ok := value.(map[string]any); ok {
					fact := map[string]any{"nodeId": node["id"]}
					for _, key := range []string{"generation", "generationDraft", "outputReference"} {
						if value, exists := node[key]; exists {
							fact[key] = value
						}
					}
					if len(fact) > 1 {
						facts = append(facts, fact)
					}
				}
			}
			if len(facts) > 0 {
				result["observedFacts"] = facts
			}
		}
		for _, key := range []string{"content", "nodes"} {
			if _, exists := result[key]; exists {
				delete(result, key)
				omitted = true
			}
		}
		if !omitted {
			continue
		}
		result["contextCompacted"] = true
		result["guidance"] = "历史读取正文已移出模型上下文；需要时重新读取。保留的历史状态不是当前状态，也不是执行授权，不得据此重复提交生成。"
		body, err := json.Marshal(result)
		if err != nil || len(body) >= len(stringField(message, "content")) {
			continue
		}
		message["content"] = string(body)
		changed = true
	}
	return changed
}

// 单个工具调用参数的字节上限。中文约一万字——正常调用远低于此；超过通常意味着模型
// 把整份剧本文本塞进了一次调用（线上 run ag3580aca 即此），应由纠偏路径引导拆分，
// 而不是判死整个运行。
const cloudAgentToolArgumentsByteLimit = 32000

func validateCloudAgentCalls(calls []cloudAgentCall) error {
	seen := make(map[string]bool, len(calls))
	for _, call := range calls {
		reason, argumentProblem := cloudAgentInvalidCallReason(call, seen)
		if reason != "" {
			if argumentProblem {
				return errors.New("invalid Agent tool arguments")
			}
			return errors.New("invalid Agent tool call")
		}
	}
	return nil
}

// 连续多少批模型调用含无效参数后放弃纠偏、回到硬失败路径。
const cloudAgentInvalidArgumentStepLimit = 3

// cloudAgentBatchInvalidCalls 找出一批调用里所有无效项，返回 index → 原因，以及
// 是否存在结构类问题（ID 无效/重复、工具名无效——非参数类）。无效调用也登记 seen，
// 避免同批后续调用复用无效调用的 ID 被放行。
//
// 结构类问题不能按参数问题逐调用纠偏：重复 ID 的调用与回执按 ID 配对会产生歧义
// （第二条同 ID 调用的拒绝回执可能被当作第一条有效调用的结果），历史配对校验也会
// 失败——保持整步拒绝的既有语义。参数类（超限/JSON 非法）才走逐调用纠偏。
func cloudAgentBatchInvalidCalls(calls []cloudAgentCall) (map[int]string, bool) {
	seen := make(map[string]bool, len(calls))
	invalid := map[int]string{}
	structural := false
	for index, call := range calls {
		reason, argumentProblem := cloudAgentInvalidCallReason(call, seen)
		if reason == "" {
			continue
		}
		invalid[index] = reason
		seen[call.ID] = true
		if !argumentProblem {
			structural = true
		}
	}
	return invalid, structural
}

// cloudAgentInvalidCallReason 返回单个调用未通过校验的原因与是否属于参数问题；
// 空原因表示有效。seen 记录本批已出现的调用 ID（重复即无效），有效调用由本函数登记。
func cloudAgentInvalidCallReason(call cloudAgentCall, seen map[string]bool) (string, bool) {
	if err := validateCloudAgentID(call.ID, "工具调用 ID", 160); err != nil {
		return "调用 ID 无效", false
	}
	if seen[call.ID] {
		return "调用 ID 与同批其他调用重复", false
	}
	if call.Function.Name == "" || len(call.Function.Name) > 80 || !utf8.ValidString(call.Function.Name) {
		return "工具名无效", false
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &map[string]any{}); err != nil {
		return "参数不是合法的 JSON 对象", true
	}
	if len(call.Function.Arguments) > cloudAgentToolArgumentsByteLimit {
		return "参数超过 32000 字节上限（中文约一万字）；长文本请拆分为多次调用，例如先建空结构再逐段追加", true
	}
	seen[call.ID] = true
	return "", false
}

func (s *Service) terminateCloudAgent(run *model.CloudAgentExecution, message string) error {
	if run == nil {
		return errors.New(message)
	}
	if err := s.repo.MarkCloudAgentFailed(run.UserID, run.ID, run.Revision, message); err != nil && !errors.Is(err, repository.ErrCreationConflict) {
		return err
	}
	return nil
}

func (s *Service) failCloudAgent(run *model.CloudAgentExecution, state *cloudAgentRuntime, message string) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		current.Status = "failed"
		current.FailureMessage = truncateRunes(message, 1000)
		cloudAgentDropInterjections(run.ID, "本轮已结束："+truncateRunes(message, 120), state)
		state.event(run.ID, "run_failed", map[string]any{"text": message})
		return cloudAgentSave(current, state)
	})
}

// failCloudAgentAdmission records deterministic tool admission failures in the
// same checkpoint transaction. Transient repository errors must still escape
// the caller so the scheduler can retry them.
func failCloudAgentAdmission(current *model.CloudAgentExecution, state *cloudAgentRuntime, runID string, err error) error {
	message := cloudAgentSafeToolError(err)
	current.Status = "failed"
	current.FailureMessage = message
	state.Approval = nil
	state.event(runID, "run_failed", map[string]any{
		"text":   message,
		"reason": "tool_admission_failed",
	})
	return cloudAgentSave(current, state)
}
