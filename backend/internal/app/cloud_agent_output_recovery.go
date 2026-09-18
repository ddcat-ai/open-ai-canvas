package app

import (
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func cloudAgentOutputViolation(text string, callCount int) string {
	if len(text) > 32000 {
		return fmt.Sprintf("正文 %d 字符，超过单步 32000 字符上限", len(text))
	}
	if callCount > 8 {
		return fmt.Sprintf("一次发起了 %d 个工具调用，超过单步 8 个上限", callCount)
	}
	return ""
}

func (s *Service) correctCloudAgentOutput(run *model.CloudAgentExecution, state *cloudAgentRuntime, violation string) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{
			"role":    "user",
			"content": fmt.Sprintf("你上一条回复不合规：%s。请**重新输出一次**：正文精简到 32000 字符内，工具调用不超过 8 个；需要更多调用就分成多次，每次只调必要的几个。不要复述这条提示。", violation),
		})
		state.ActiveTaskID = ""
		state.Calls = nil
		state.CallIndex = 0
		return cloudAgentSave(current, state)
	})
}

func cloudAgentTruncatedToolArguments(task *model.Task) bool {
	if task == nil {
		return false
	}
	return strings.Contains(task.Error, "工具参数不是完整 JSON")
}

func (s *Service) correctCloudAgentTruncatedCalls(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{
			"role":    "user",
			"content": "你上一条工具调用的参数 JSON 被输出长度上限截断了（一次写不完）。请**拆成多次调用**重新提交：每次 canvas_apply_ops 只写少量内容（例如分镜表每次不超过 3 行），多次调用累积完成，不要试图一次写完。不要复述这条提示。",
		})
		state.ActiveTaskID = ""
		state.Calls = nil
		state.CallIndex = 0
		return cloudAgentSave(current, state)
	})
}
