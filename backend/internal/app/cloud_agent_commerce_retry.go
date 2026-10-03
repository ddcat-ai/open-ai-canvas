package app

import (
	"encoding/json"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type cloudAgentCommerceRetryMetadata struct {
	Metadata struct {
		RetryFailedTaskID string `json:"commerceRetryFailedTaskId"`
		RootTaskID        string `json:"commerceRootTaskId"`
		RetryPromptHash   string `json:"commerceRetryPromptHash"`
	} `json:"metadata"`
}

func cloudAgentCommerceRetryTaskID(userID, failedTaskID string) string {
	return cloudAgentID(userID, "commerce:retry:"+failedTaskID)
}

// New turns do not inherit executable plans. An explicit failed-item retry can
// recover its immutable source plan after checking ownership, session and refs.
func (s *Service) cloudAgentCommerceRetryPlan(userID string, state *cloudAgentRuntime, itemID, failedTaskID string) (*cloudAgentCommercePlan, error) {
	if state.Request.SessionID == "" || validateCloudAgentID(failedTaskID, "失败任务 ID", 80) != nil {
		return nil, BadAuthRequest("重试须指定当前会话的失败任务")
	}
	task, err := s.repo.TaskForUser(userID, failedTaskID)
	if err != nil || task.Status != model.TaskStatusFailed {
		return nil, BadAuthRequest("只能重试已确认失败的任务")
	}
	var input struct {
		Metadata struct {
			RunID string `json:"agentRunId"`
		} `json:"metadata"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Metadata.RunID == "" {
		return nil, BadAuthRequest("失败任务缺少原方案来源")
	}
	run, err := s.repo.CloudAgent(userID, input.Metadata.RunID)
	if err != nil {
		return nil, BadAuthRequest("失败任务的原方案不可用")
	}
	source, err := cloudAgentDecode(run)
	if err != nil || source.Request.Surface != "creation" || source.Request.SessionID != state.Request.SessionID || !cloudAgentCommerceTaskMatches(task, source.CommercePlan, itemID) {
		return nil, BadAuthRequest("失败任务不属于当前会话的已确认方案")
	}
	if err := validateCloudAgentCommercePlan(state.Request, source.CommercePlan); err != nil {
		return nil, err
	}
	return source.CommercePlan, nil
}

func cloudAgentCommerceValidateRetryTarget(repo *repository.Repository, userID string, state *cloudAgentRuntime, itemID, failedTaskID string) error {
	if state == nil || state.CommercePlan == nil || validateCloudAgentID(failedTaskID, "失败任务 ID", 80) != nil {
		return BadAuthRequest("重试须指定本计划的失败任务 ID")
	}
	task, err := repo.TaskForUser(userID, failedTaskID)
	if err != nil || task == nil || task.Status != model.TaskStatusFailed || !cloudAgentCommerceTaskMatches(task, state.CommercePlan, itemID) {
		return BadAuthRequest("只能重试本计划交付项中已确认失败的任务")
	}
	rootID := cloudAgentCommerceTaskID(userID, state.CommercePlan, itemID, state.Request.SessionID)
	if failedTaskID == rootID {
		return nil
	}
	var input cloudAgentCommerceRetryMetadata
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Metadata.RootTaskID != rootID || input.Metadata.RetryFailedTaskID == "" || failedTaskID != cloudAgentCommerceRetryTaskID(userID, input.Metadata.RetryFailedTaskID) {
		return BadAuthRequest("失败任务不属于当前会话的重试链")
	}
	return nil
}

func cloudAgentCommerceRetryTaskMatches(task *model.Task, userID string, state *cloudAgentRuntime, identity cloudAgentCommerceMediaIdentity) bool {
	if state == nil || state.CommercePlan == nil || identity.RetryFailedTaskID == "" || task == nil || task.ID != identity.TaskID || !cloudAgentCommerceTaskMatches(task, state.CommercePlan, identity.ItemID) {
		return false
	}
	var input cloudAgentCommerceRetryMetadata
	return json.Unmarshal([]byte(task.InputJSON), &input) == nil && input.Metadata.RetryFailedTaskID == identity.RetryFailedTaskID && input.Metadata.RetryPromptHash == identity.RetryPromptHash && input.Metadata.RootTaskID == cloudAgentCommerceTaskID(userID, state.CommercePlan, identity.ItemID, state.Request.SessionID)
}

func cloudAgentCommerceSuccessfulDependency(repo *repository.Repository, userID string, state *cloudAgentRuntime, itemID string) bool {
	taskID := cloudAgentCommerceTaskID(userID, state.CommercePlan, itemID, state.Request.SessionID)
	for attempt := 0; attempt < 128; attempt++ {
		task, err := repo.TaskForUser(userID, taskID)
		if err != nil || task == nil || !cloudAgentCommerceTaskMatches(task, state.CommercePlan, itemID) {
			return false
		}
		if task.Status == model.TaskStatusSucceeded {
			return true
		}
		if task.Status != model.TaskStatusFailed {
			return false
		}
		taskID = cloudAgentCommerceRetryTaskID(userID, taskID)
	}
	return false
}
