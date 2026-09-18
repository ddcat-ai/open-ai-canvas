package app

import (
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const cloudAgentMaxEmptyOutputNudges = 2

// cloudAgentEmptyModelOutput 判断模型任务是不是「上游成功、但正文与工具调用都为空」。
// 开思考时偶发只流 reasoning、可见正文和工具调用都空，解析层会归为「没有返回内容」。
func cloudAgentEmptyModelOutput(task *model.Task) bool {
	if task == nil || task.Status == model.TaskStatusSucceeded {
		return false
	}
	return strings.Contains(task.Error, "没有返回内容")
}

func (s *Service) correctCloudAgentEmptyOutput(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.EmptyOutputNudged++
		state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{
			"role":    "user",
			"content": "你上一条回复是**空的**：既没有正文，也没有任何工具调用。请直接继续 —— 要么调用工具推进当前任务，要么给出结论；不要复述这条提示。",
		})
		state.ActiveTaskID = ""
		state.Calls = nil
		state.CallIndex = 0
		return cloudAgentSave(current, state)
	})
}
