package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

var errCloudAgentCommercePending = errors.New("commerce image delivery is still pending")

// Follow the stable retry chain without replacing any earlier task or output.
func cloudAgentCommerceLatestTask(repo *repository.Repository, userID string, state *cloudAgentRuntime, itemID string) (*model.Task, int, error) {
	id := cloudAgentCommerceTaskID(userID, state.CommercePlan, itemID, state.Request.SessionID)
	var latest *model.Task
	for depth := 0; depth < 128; depth++ {
		task, err := repo.TaskForUser(userID, id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return latest, max(0, depth-1), nil
		}
		if err != nil {
			return nil, 0, err
		}
		if !cloudAgentCommerceTaskMatches(task, state.CommercePlan, itemID) {
			return nil, 0, creationConflict("交付项任务与原方案不一致")
		}
		latest = task
		if task.Status != model.TaskStatusFailed {
			return latest, depth, nil
		}
		id = cloudAgentCommerceRetryTaskID(userID, id)
	}
	return nil, 0, BadAuthRequest("交付项重试链过长")
}

func (s *Service) cloudAgentCommerceImageCanRepair(run *model.CloudAgentExecution, state *cloudAgentRuntime, task *model.Task) (bool, error) {
	if state.CommerceBatch == nil || state.Request.Surface != "creation" || state.Request.PermissionMode == "read_only" || task == nil || task.Type != "canvas_image" || task.Status != model.TaskStatusFailed {
		return false, nil
	}
	if limit := state.Request.Budget.MaxGenerationTasks; limit > 0 && state.Generations >= limit {
		return false, nil
	}
	var input struct {
		Metadata struct {
			RunID string `json:"agentRunId"`
		} `json:"metadata"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Metadata.RunID != run.ID {
		return false, nil
	}
	orders, err := s.repo.BillingOrdersByTaskIDs(run.UserID, state.TaskIDs)
	if err != nil {
		return false, err
	}
	remaining := int64(state.Request.Budget.MaxCredits * float64(CreditScale))
	for _, order := range orders {
		remaining -= order.AmountMicrocredits
	}
	for _, entry := range state.CommerceBatch.Items {
		if cloudAgentCommerceTaskMatches(task, state.CommercePlan, entry.ItemID) && entry.Prepared != nil && entry.Prepared.Quote.AmountMicrocredits > remaining {
			return false, nil
		}
	}
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil || len(attempts) == 0 {
		return false, err
	}
	for _, attempt := range attempts {
		if attempt.Status != "failed" || attempt.DispatchState != "rejected_no_job" && attempt.DispatchState != "failed_no_output" {
			return false, nil
		}
	}
	return true, nil
}

func (s *Service) cloudAgentCommerceAutoImageRetry(run *model.CloudAgentExecution, state *cloudAgentRuntime, itemID, failedID, promptHash string) (bool, error) {
	if state.CommerceBatch == nil || promptHash == "" || !cloudAgentContainsString(state.CommerceBatch.ReportedFailures, failedID) {
		return false, nil
	}
	for _, item := range state.CommerceBatch.Items {
		if item.ItemID != itemID || item.Args.Mode != "image" {
			continue
		}
		task, _, err := cloudAgentCommerceLatestTask(s.repo, run.UserID, state, itemID)
		if err != nil || task == nil || task.ID != failedID {
			return false, err
		}
		return s.cloudAgentCommerceImageCanRepair(run, state, task)
	}
	return false, nil
}

// A failed image must wake the Agent even if the batch's first image is slow.
func (s *Service) waitCloudAgentMediaTask(ctx context.Context, userID, runID, taskID string) (*model.Task, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, err
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, err
	}
	if state.CommerceBatch == nil || state.CallIndex >= len(state.Calls) || !cloudAgentCommerceBatchCall(state.Calls[state.CallIndex].Function.Name) {
		return s.waitCloudAgentTask(ctx, taskID)
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		for _, entry := range state.CommerceBatch.Items {
			task, _, err := cloudAgentCommerceLatestTask(s.repo, userID, &state, entry.ItemID)
			if err != nil {
				return nil, err
			}
			if task == nil {
				continue
			}
			if task.ID == taskID && cloudAgentTaskTerminal(task.Status) {
				return task, nil
			}
			if !cloudAgentContainsString(state.CommerceBatch.ReportedFailures, task.ID) {
				repair, err := s.cloudAgentCommerceImageCanRepair(run, &state, task)
				if err != nil || repair {
					return task, err
				}
			}
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

func cloudAgentCommerceBatchCall(name string) bool {
	return name == "commerce_plan_submit" || name == "commerce_plan_wait"
}

const cloudAgentCommerceRecoveryInstruction = "保持静默，立即仅对 failedItems 中 action=rewrite_prompt 的失败图片重新规划场景提示词，去除触发拒绝的内容或歧义，保留原商品、版式、文案、素材、规格及整套风格；用 generate_media 传 commercePlanId、commerceItemId、retryFailedTaskId 和 retryPrompt。不得重做成功或进行中的图片。随后调用 commerce_plan_wait 等待其余图片和修复结果，全部结束后统一回复；中间不向用户逐条报告失败或索要确认。"
