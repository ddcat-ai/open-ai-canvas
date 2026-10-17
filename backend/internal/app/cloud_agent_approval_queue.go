package app

import (
	"errors"
	"log/slog"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 同一模型步骤里可能有多个需要审批的调用（例如连续两次 generate_media）。
// 批准一个后，执行器按 Calls/CallIndex 依序为下一个审批调用建卡，全部处理完才恢复模型；
// 每张卡仍需用户单独批准，媒体任务仍串行（上一张的任务回写完成后才接下一张）。

// cloudAgentQueuedApproval 判断当前批次中的调用是否属于需要审批的调用。
// 只看当前 Calls，不按 call ID 搜索历史：不同模型步骤可能复用同一个 ID。
func cloudAgentQueuedApproval(state *cloudAgentRuntime, call cloudAgentCall) bool {
	media := call.Function.Name == "generate_media" || call.Function.Name == "image_layer_split"
	return cloudAgentToolAllowed(state.Request, call.Function.Name) &&
		((cloudAgentWrite(call.Function.Name) && (media || state.Request.PermissionMode == "request_approval")) ||
			(call.Function.Name == "plan_update" && cloudAgentPlanRequiresFirstApproval(state, call)))
}

// continueCloudAgentApprovalQueue 在被批准的调用落定后接续同批下一个审批调用。
// 返回 true 表示已暂停（新的审批卡、媒体任务进行中或运行已终止），调用方不应恢复模型。
// 只读等非审批调用直接跳过，模型恢复时沿用未执行回执。
func (s *Service) continueCloudAgentApprovalQueue(userID, id string, state *cloudAgentRuntime) (bool, error) {
	limit := len(state.Calls) + 8
	for steps, conflicts := 0, 0; conflicts < 8; steps++ {
		if steps >= limit {
			slog.Warn("agent approval queue step limit reached", "run", id, "steps", steps)
			return false, nil
		}
		run, err := s.repo.CloudAgent(userID, id)
		if err != nil {
			return false, err
		}
		fresh, err := cloudAgentDecode(run)
		if err != nil {
			return false, err
		}
		prompt := state.PiResumePrompt
		*state = fresh
		state.PiResumePrompt = prompt
		if cloudAgentRunTerminal(run.Status) || run.Status == "waiting_approval" || state.MediaTaskID != "" {
			return true, nil
		}
		for state.CallIndex < len(state.Calls) && !cloudAgentQueuedApproval(state, state.Calls[state.CallIndex]) {
			state.CallIndex++
		}
		if state.CallIndex >= len(state.Calls) {
			return false, nil
		}
		// 恢复提示属于已落定的调用，不能带到下一张审批卡。
		state.PiResumePrompt = ""
		err = s.advanceCloudAgentApprovalTool(run, state, true)
		if errors.Is(err, repository.ErrCreationConflict) {
			conflicts++
			continue
		}
		if err != nil {
			return false, err
		}
		// 执行器要么建卡，要么记录错误并推进 CallIndex；重新读取已提交状态再继续。
	}
	return false, repository.ErrCreationConflict
}

// recordCloudAgentQueuedApprovalError 接续调用准入失败时不建卡、不终止运行，
// 只把错误记为该调用的工具结果，再处理同批下一个调用。
func (s *Service) recordCloudAgentQueuedApprovalError(run *model.CloudAgentExecution, state *cloudAgentRuntime, err error) error {
	slog.Warn("agent queued approval admission rejected", "run", run.ID, "error", err)
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		cloudAgentRecordToolResult(current, state, state.Calls[state.CallIndex],
			map[string]any{"phase": "admission", "taskSubmitted": false}, cloudAgentWrapMediaAdmissionError(err))
		return cloudAgentSave(current, state)
	})
}

// cloudAgentCurrentBatchUnanswered 判断最后一批 assistant 调用中是否仍有调用没有结果。
func cloudAgentCurrentBatchUnanswered(state *cloudAgentRuntime) bool {
	answered := map[string]bool{}
	for i := len(state.Canonical.Messages) - 1; i >= 0; i-- {
		message := state.Canonical.Messages[i]
		switch stringField(message, "role") {
		case "tool":
			answered[stringField(message, "tool_call_id")] = true
		case "assistant":
			for _, call := range state.Calls {
				if !answered[call.ID] {
					return true
				}
			}
			return false
		}
	}
	return state.CallIndex < len(state.Calls)
}

// cloudAgentRestoreApprovalQueueResults 用服务端已提交的真实结果替换 Pi 历史里的等待审批占位。
// Pi 在审批暂停时先写下占位，Go 执行器之后才提交真实结果。只处理两份历史中最后一批
// assistant 调用：更早步骤里相同的 call ID 不能作为本批结果的依据。
func cloudAgentRestoreApprovalQueueResults(messages []map[string]any, committed canonicalAgentRequest) []map[string]any {
	lastAssistant := func(messages []map[string]any) int {
		for i := len(messages) - 1; i >= 0; i-- {
			if stringField(messages[i], "role") == "assistant" {
				return i
			}
		}
		return -1
	}
	runtimeIndex, canonicalIndex := lastAssistant(messages), lastAssistant(committed.Messages)
	if runtimeIndex < 0 || canonicalIndex < 0 {
		return messages
	}
	runtimeCalls := runtimeAssistantToolCalls(messages[runtimeIndex])
	canonicalCalls := canonicalAgentToolCalls(committed.Messages[canonicalIndex]["tool_calls"])
	if len(runtimeCalls) == 0 || len(runtimeCalls) != len(canonicalCalls) {
		return messages
	}
	for i, call := range canonicalCalls {
		id, err := canonicalAgentToolCallID(call, "tool call")
		function, _ := call["function"].(map[string]any)
		if err != nil || id != runtimeCalls[i].ID || stringField(function, "name") != runtimeCalls[i].Name {
			return messages
		}
	}
	receipts := map[string]string{}
	for _, message := range committed.Messages[canonicalIndex+1:] {
		if stringField(message, "role") != "tool" {
			break
		}
		receipts[stringField(message, "tool_call_id")] = stringField(message, "content")
	}
	restored := append([]map[string]any(nil), messages...)
	for i := runtimeIndex + 1; i < len(messages); i++ {
		message := messages[i]
		if role := stringField(message, "role"); role != "toolResult" && role != "tool" {
			break
		}
		id, err := strictRuntimeStringAliases(message, "tool call", "toolCallId", "tool_call_id", "call_id")
		if content, ok := receipts[id]; err == nil && ok {
			restored[i] = map[string]any{"role": "toolResult", "toolCallId": id,
				"toolName": stringField(message, "toolName"), "isError": cloudAgentToolContentIsError(content),
				"content": []any{map[string]any{"type": "text", "text": content}}}
		}
	}
	return restored
}
