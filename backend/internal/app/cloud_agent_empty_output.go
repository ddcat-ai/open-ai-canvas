package app

import (
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const cloudAgentMaxEmptyOutputNudges = 2

// cloudAgentMaxEmptyOutputEscalations 是"空输出升级重试"次数：催办没用时改为关思考 + 放大预算。
const cloudAgentMaxEmptyOutputEscalations = 1

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
		state.Canonical.Messages = append(state.Canonical.Messages, cloudAgentRuntimeMessage(cloudAgentRuntimeContext{Kind: cloudAgentContextEmptyOutput}))
		state.ActiveTaskID = ""
		state.Calls = nil
		state.CallIndex = 0
		return cloudAgentSave(current, state)
	})
}

// correctCloudAgentEmptyOutputEscalation 是空输出的兜底：催办无效时关掉上游思考并放大输出预算，
// 重新发同一步（不追加催办消息，避免模型误以为出现了新任务）。
func (s *Service) correctCloudAgentEmptyOutputEscalation(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.EmptyOutputEscalated++
		state.ForceThinkingOff = true
		state.BoostStepOutputBudget = true
		state.ActiveTaskID = ""
		state.Calls = nil
		state.CallIndex = 0
		state.event(run.ID, "model_failure_recovered", map[string]any{
			"reason": "empty_output_escalated",
			"text":   "上游连续返回空内容；已关闭思考并放大输出预算重试同一步",
		})
		return cloudAgentSave(current, state)
	})
}
