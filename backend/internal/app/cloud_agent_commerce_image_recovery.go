package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
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
	policy, err := s.cloudAgentMediaRetryPolicy(run.UserID, task)
	if err != nil {
		var appErr *AppError
		if errors.As(err, &appErr) {
			return false, nil
		}
		return false, err
	}
	if !policy.RequiresPromptChange {
		return false, nil
	}
	remaining, err := s.cloudAgentRemainingBudget(run.UserID, state)
	if err != nil {
		return false, err
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

// Any newly finished item must publish progress even if the first item is slow.
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
		task, err := s.waitCloudAgentTask(ctx, taskID)
		if err != nil && ctx.Err() == nil {
			// A failed media job is still a settled delivery that must publish its
			// tool result. Database and ownership failures are not delivery states.
			if terminal, lookupErr := s.repo.TaskForUser(userID, taskID); lookupErr == nil && cloudAgentTaskTerminal(terminal.Status) {
				return terminal, nil
			}
		}
		return task, err
	}
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		run, err = s.ownedCloudAgent(ctx, userID, runID)
		if err != nil {
			return nil, err
		}
		if cloudAgentRunTerminal(run.Status) {
			return nil, context.Canceled
		}
		state, err = cloudAgentDecode(run)
		if err != nil || !cloudAgentBatchPending(&state) {
			return nil, err
		}
		capacityExpired := false
		waitingForCapacity := state.CommerceBatch.WaitingForCapacity
		for _, entry := range state.CommerceBatch.Items {
			var task *model.Task
			var err error
			if state.CommerceBatch.Kind == "images" {
				task, err = s.repo.TaskForUser(userID, entry.TaskID)
				if errors.Is(err, gorm.ErrRecordNotFound) {
					task, err = nil, nil
				}
			} else {
				task, _, err = cloudAgentCommerceLatestTask(s.repo, userID, &state, entry.ItemID)
			}
			if err != nil {
				return nil, err
			}
			if task == nil {
				capacityExpired = capacityExpired || entry.Prepared == nil || time.Now().After(entry.Prepared.Quote.ExpiresAt)
				// A restart can occur after freezing the batch but before its first
				// admission/capacity checkpoint. Recover that same pending item.
				if state.CommerceBatch.Kind == "images" || cloudAgentCommerceDependenciesReady(s.repo, userID, &state, entry.ItemID) == nil {
					waitingForCapacity = true
				}
				continue
			}
			if cloudAgentTaskTerminal(task.Status) && (task.ID == taskID || !cloudAgentContainsString(state.CommerceBatch.CompletedTaskIDs, task.ID)) {
				return task, nil
			}
			if state.CommerceBatch.Kind != "images" && !cloudAgentContainsString(state.CommerceBatch.ReportedFailures, task.ID) {
				repair, err := s.cloudAgentCommerceImageCanRepair(run, &state, task)
				if err != nil || repair {
					return task, err
				}
			}
		}
		if waitingForCapacity {
			// Capacity belongs to the user, not this batch. A task in another run
			// may free the first slot; no worker or database lock is held here.
			policy, err := s.RuntimePolicy()
			if err != nil {
				return nil, err
			}
			active, err := s.repo.ActiveTaskCountForUser(userID)
			if err != nil {
				return nil, err
			}
			if capacityExpired || active < int64(policy.Task.ActiveTaskLimit) {
				return nil, nil
			}
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
}

// A frozen batch may be waiting for its first slot without a MediaTaskID.
// Completed tools retained for repair do not represent an active wait.
func cloudAgentBatchPending(state *cloudAgentRuntime) bool {
	return state != nil && state.CommerceBatch != nil && state.CallIndex >= 0 && state.CallIndex < len(state.Calls) && cloudAgentCommerceBatchCall(state.Calls[state.CallIndex].Function.Name)
}

func cloudAgentMediaPending(state *cloudAgentRuntime) bool {
	return state != nil && (state.MediaTaskID != "" || cloudAgentBatchPending(state))
}

func cloudAgentCommerceBatchCall(name string) bool {
	return name == "commerce_plan_submit" || name == "commerce_plan_wait" || name == "generate_image_batch"
}

const cloudAgentCommerceRecoveryInstruction = "保持静默，立即仅对 failedItems 中 action=rewrite_prompt 的失败图片重新规划场景提示词，去除触发拒绝的内容或歧义，保留原商品、版式、文案、素材、规格及整套风格；用 generate_media 传 commercePlanId、commerceItemId、retryFailedTaskId 和 retryPrompt。不得重做成功或进行中的图片。随后调用 commerce_plan_wait 等待其余图片和修复结果，全部结束后统一回复；中间不向用户逐条报告失败或索要确认。"
