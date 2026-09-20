package app

import (
	"strings"

	"infinite-canvas/backend/internal/model"
)

// cloudAgentContinuationReply 生成「上一轮接着聊」用的两段内容：
//
//	reply   —— 上一轮 assistant 实际说过的话（作为 assistant 的历史消息）
//	context —— 上一轮收束摘要（独立上下文，不能并进 reply）
//
// 只保留状态、失败原因和已提交生成任务，不把上一轮工具流水当成本轮目标。
func cloudAgentContinuationReply(task *model.Task, run *CloudAgentRun) (string, string, error) {
	text := ""
	if task.Status == model.TaskStatusSucceeded {
		text = taskResultText(task.ResultJSON)
	}
	submitted := make([]string, 0)
	seen := map[string]bool{}
	addSubmitted := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		submitted = append(submitted, id)
	}
	for _, event := range run.Events {
		if event.Type == "assistant_message" {
			text = stringValue(event.Payload["text"])
		}
		if event.Type == "generation_task_created" {
			addSubmitted(stringValue(event.Payload["taskId"]))
		}
		if result, ok := event.Payload["result"].(map[string]any); ok {
			if submittedFlag, _ := result["taskSubmitted"].(bool); submittedFlag {
				addSubmitted(stringValue(result["taskId"]))
			}
		}
	}
	context := cloudAgentContinuationContext(run, submitted)
	return text, context, nil
}

func cloudAgentContinuationContext(run *CloudAgentRun, submitted []string) string {
	if run == nil {
		return ""
	}
	failed := run.Status == "failed" || strings.TrimSpace(run.FailureMessage) != ""
	if run.Status == "completed" && !failed && len(submitted) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("上一轮已结束（")
	b.WriteString(firstNonEmpty(run.Status, "unknown"))
	b.WriteString("）。")
	if failed {
		reason := strings.TrimSpace(run.FailureMessage)
		if reason == "" {
			reason = run.Status
		}
		b.WriteString(" 上一轮失败：")
		b.WriteString(truncateRunes(reason, 240))
	}
	if len(submitted) > 0 {
		if len(submitted) > 8 {
			submitted = submitted[:8]
		}
		b.WriteString(" 已提交生成任务：")
		b.WriteString(strings.Join(submitted, ", "))
	}
	return b.String()
}
