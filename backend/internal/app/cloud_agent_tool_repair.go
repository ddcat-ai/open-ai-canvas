package app

import (
	"errors"
	"fmt"

	"infinite-canvas/backend/internal/model"
)

const cloudAgentToolAttemptLimit = 3

type cloudAgentToolRepair struct {
	GroupID string `json:"groupId"`
	Attempt int    `json:"attempt"`
}

// Count per tool, not per model step: intervening reads must not reset a failed
// write's allowance. Only explicitly typed, pre-execution errors are repairable.
func cloudAgentTrackToolRepair(runID string, state *cloudAgentRuntime, call cloudAgentCall, result any, err error, payload map[string]any) bool {
	previous, exists := state.ToolRepairs[call.Function.Name]
	if err == nil {
		if exists {
			payload["retry"] = map[string]any{"groupId": previous.GroupID, "attempt": previous.Attempt, "maxAttempts": cloudAgentToolAttemptLimit, "status": "recovered"}
			delete(state.ToolRepairs, call.Function.Name)
		}
		return false
	}
	detail, _ := result.(map[string]any)
	var argumentErr *cloudAgentArgumentError
	if !errors.As(err, &argumentErr) || detail["taskSubmitted"] == true || detail["phase"] == "completion" {
		return false
	}
	if state.ToolRepairs == nil {
		state.ToolRepairs = map[string]cloudAgentToolRepair{}
	}
	if !exists {
		previous.GroupID = runID + ":repair:" + call.ID
	}
	previous.Attempt++
	state.ToolRepairs[call.Function.Name] = previous
	exhausted := previous.Attempt >= cloudAgentToolAttemptLimit
	status := "retrying"
	if exhausted {
		status = "exhausted"
	}
	retry := map[string]any{"groupId": previous.GroupID, "attempt": previous.Attempt, "maxAttempts": cloudAgentToolAttemptLimit, "status": status}
	payload["retry"], detail["retry"] = retry, retry
	return exhausted
}

func cloudAgentRecordToolResult(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall, result any, err error) {
	if !cloudAgentToolResult(run.ID, state, call, result, err) {
		return
	}
	run.Status = "failed"
	run.FailureMessage = truncateRunes(fmt.Sprintf("自动纠正已尝试 %d 次，仍未完成：%s", cloudAgentToolAttemptLimit, cloudAgentSafeToolError(err)), 1000)
	cloudAgentDropInterjections(run.ID, "本轮已结束："+truncateRunes(run.FailureMessage, 120), state)
	state.event(run.ID, "run_failed", map[string]any{
		"text": run.FailureMessage, "reason": "tool_retry_exhausted", "toolName": call.Function.Name,
		"callId": call.ID, "attempts": cloudAgentToolAttemptLimit,
	})
}
