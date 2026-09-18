package app

import (
	"strings"

	"infinite-canvas/backend/internal/model"
)

// cloudAgentParentCanBeSuperseded 判断上一轮能否因执行合同变更直接接新轮。
// 只有上一轮没有正在跑的模型任务时才允许，避免两轮并发写同一张画布。
func (s *Service) cloudAgentParentCanBeSuperseded(userID, parentID string) bool {
	execution, err := s.repo.CloudAgent(userID, parentID)
	if err != nil {
		return false
	}
	state, err := cloudAgentDecode(execution)
	if err != nil {
		return false
	}
	if validateCloudAgentPolicySnapshot(state.Policy) == nil {
		return false
	}
	if strings.TrimSpace(state.ActiveTaskID) == "" {
		return true
	}
	task, err := s.repo.TaskForUser(userID, state.ActiveTaskID)
	if err != nil {
		return true
	}
	return task.Status != model.TaskStatusQueued && task.Status != model.TaskStatusRunning
}
