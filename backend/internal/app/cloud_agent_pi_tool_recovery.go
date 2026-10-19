package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const cloudAgentPiUnexecutedCallText = "该工具调用尚未提交执行：本轮在前序操作等待审批时已暂停。如仍需要该操作，请根据当前用户要求重新规划。"

func cloudAgentPiDeclaredCall(state *cloudAgentRuntime, call cloudAgentCall) bool {
	if state == nil || state.PiModelTaskID == "" {
		return false
	}
	digest, err := cloudAgentCallDigest(call)
	if err != nil {
		return false
	}
	for _, expected := range state.PiModelCalls {
		actual, err := cloudAgentCallDigest(expected)
		if expected.ID == call.ID && expected.Function.Name == call.Function.Name && err == nil && actual == digest {
			return true
		}
	}
	return false
}

func (s *Service) validateCloudAgentPiDeclaredCall(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	receipt, err := s.repo.CloudAgentReceipt(run.UserID, run.ID, "tool", call.ID)
	if err == nil {
		digest, e := cloudAgentCallDigest(call)
		if e == nil && receipt.Name == call.Function.Name && receipt.InputSHA256 == digest {
			return nil
		}
		return NewAppError(409, "工具调用与执行回执不符")
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if !cloudAgentPiDeclaredCall(state, call) {
		return NewAppError(409, "工具调用与已提交模型结果不配对")
	}
	return nil
}

// Receipt-first recovery never enters an executor. A missing receipt is only
// evidence of non-execution for a server-committed declaration that was never
// admitted; an old, pending, unknown, or digest-mismatched call fails closed.
func (s *Service) recoverCloudAgentPiTool(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall, replayOnly bool) (any, error) {
	receipt, err := s.repo.CloudAgentReceipt(run.UserID, run.ID, "tool", call.ID)
	if err == nil {
		digest, e := cloudAgentCallDigest(call)
		if e != nil || receipt.Name != call.Function.Name || receipt.InputSHA256 != digest {
			return nil, NewAppError(409, "工具回执待定、未知或不匹配，未伪造结果或重发")
		}
		if receipt.Status != "committed" {
			if run.Status == "cancelled" && !run.CleanupPending {
				return map[string]any{"content": cloudAgentPiCancelledCallContent, "isError": true}, nil
			}
			if run.Status == "failed" && !run.CleanupPending {
				return map[string]any{"content": cloudAgentPiFailedCallContent, "isError": true}, nil
			}
			return nil, NewAppError(409, "工具回执待定、未知或不匹配，未伪造结果或重发")
		}
		return cloudAgentReceiptResponse(receipt)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if !cloudAgentWrite(call.Function.Name) {
		if content, ok := cloudAgentCommittedToolReplay(state, call); ok {
			return map[string]any{"content": content, "isError": cloudAgentToolContentIsError(content)}, nil
		}
	}
	if run.Status == "cancelled" && !run.CleanupPending && cloudAgentPiDeclaredCall(state, call) {
		return map[string]any{"content": cloudAgentPiCancelledCallContent, "isError": true}, nil
	}
	if run.Status == "failed" && !run.CleanupPending && cloudAgentPiDeclaredCall(state, call) {
		return map[string]any{"content": cloudAgentPiFailedCallContent, "isError": true}, nil
	}
	if replayOnly || !cloudAgentPiDeclaredCall(state, call) {
		return nil, NewAppError(409, "缺少可证明的工具执行回执，未自动恢复")
	}
	for _, admitted := range state.Calls {
		if admitted.ID == call.ID {
			return nil, NewAppError(409, "工具已进入执行器但无已提交回执，需要核对")
		}
	}
	if state.Approval != nil || state.ActiveTaskID != "" || state.MediaTaskID != "" {
		return nil, NewAppError(409, "运行仍有未结算步骤，不能推定工具未执行")
	}
	task, err := s.repo.TaskForUser(run.UserID, state.PiModelTaskID)
	if err != nil || task.AgentRunID != run.ID || task.Operation != cloudAgentStepOperation || task.Status != model.TaskStatusSucceeded {
		return nil, NewAppError(409, "无法确认工具来源的已提交模型步骤")
	}
	content := cloudAgentPiUnexecutedCallText
	if run.Status == "rejected" {
		content = cloudAgentPiRejectedCallContent
	}
	return map[string]any{"content": content, "isError": true}, nil
}

// Repair missing pairs in the current native branch only; never replace it with
// a longer stale pre-compaction server transcript.
func (s *Service) repairCloudAgentPiMissingResults(run *model.CloudAgentExecution, state *cloudAgentRuntime, messages []map[string]any) ([]map[string]any, error) {
	repaired := make([]map[string]any, 0, len(messages))
	for i := 0; i < len(messages); i++ {
		message := messages[i]
		repaired = append(repaired, message)
		if stringField(message, "role") != "assistant" {
			continue
		}
		calls := canonicalAgentToolCalls(message["tool_calls"])
		if len(calls) == 0 {
			continue
		}
		answered := map[string]bool{}
		next := i + 1
		for next < len(messages) && stringField(messages[next], "role") == "tool" {
			answered[stringField(messages[next], "tool_call_id")] = true
			repaired = append(repaired, messages[next])
			next++
		}
		for _, raw := range calls {
			encoded, err := json.Marshal(raw)
			if err != nil {
				return nil, err
			}
			var call cloudAgentCall
			if err = json.Unmarshal(encoded, &call); err != nil {
				return nil, err
			}
			if answered[call.ID] {
				continue
			}
			result, err := s.recoverCloudAgentPiTool(run, state, call, false)
			if err != nil {
				return nil, fmt.Errorf("repair %s: %w", call.ID, err)
			}
			payload := result.(map[string]any)
			repaired = append(repaired, map[string]any{"role": "tool", "tool_call_id": call.ID, "content": payload["content"]})
		}
		i = next - 1
	}
	return repaired, nil
}

const cloudAgentPiRejectedCallContent = `{"phase":"user_rejected","taskSubmitted":false,"charged":false,"text":"用户拒绝了上一轮方案；该操作未提交，不重发旧操作。"}`

// 只陈述取消事实，缺失回执不能据此推断未收费或未提交。
const cloudAgentPiCancelledCallContent = `{"phase":"user_cancelled","text":"用户已停止上一轮；此工具调用的最终结果未在会话中确认，已有任务与费用以任务中心和账单为准。不要重发旧操作，按当前新需求继续。"}`

const cloudAgentPiFailedCallContent = `{"phase":"parent_failed","text":"上一轮已失败；此调用的最终结果未在会话中确认，不能推断未提交或未计费。先查真实任务状态；已完成或进行中的任务不重发，按本轮明确重试目标处理。"}`

// Only the atomic rejection of this exact waiting approval can close its pending
// admission receipt. A receipt with a task, unknown state, or different input is
// never reclassified as unexecuted. Recovery itself remains strictly read-only.
func commitCloudAgentPiRejectedReceipt(repo *repository.Repository, run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	if run.Status != "waiting_approval" || state.Approval == nil {
		return nil
	}
	call := state.Approval.Call
	receipt, err := repo.CloudAgentReceipt(run.UserID, run.ID, "tool", call.ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	digest, err := cloudAgentCallDigest(call)
	if state.Approval.ReceiptInputSHA256 != "" {
		digest, err = state.Approval.ReceiptInputSHA256, nil
	}
	if err != nil || receipt.Name != call.Function.Name || receipt.InputSHA256 != digest || receipt.Status != "pending" || receipt.TaskID != "" || state.ActiveTaskID != "" || state.MediaTaskID != "" {
		return NewAppError(409, "审批操作已有待核对执行状态，未覆盖回执")
	}
	receipt.Status, receipt.Content, receipt.IsError = "committed", cloudAgentPiRejectedCallContent, true
	return repo.SaveCloudAgentReceipt(receipt)
}
