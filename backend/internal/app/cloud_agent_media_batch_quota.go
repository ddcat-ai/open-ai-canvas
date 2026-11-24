package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// A full transcript quota must not keep terminal batches and their leases alive.
// This path writes real task results, then replaces only the finished batch's
// execution metadata with a smaller receipt. It cannot append events or undo data.
func (s *Service) finishCloudAgentMediaBatchAtCapacity(ctx context.Context, run *model.CloudAgentExecution) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return false, err
	}
	s.storageMu.Lock()
	err = s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		if !cloudAgentRunTerminal(current.Status) || !current.CleanupPending {
			return repository.ErrCreationConflict
		}
		state, err := cloudAgentDecode(current)
		if err != nil {
			return err
		}
		batch := state.MediaBatch
		if batch == nil {
			return repository.ErrCreationConflict
		}
		for index := range batch.Items {
			if err := ctx.Err(); err != nil {
				return err
			}
			item := &batch.Items[index]
			if item.Status == cloudAgentMediaBatchItemPending {
				item.Status = cloudAgentMediaBatchItemCancelled
				continue
			}
			if item.Status != cloudAgentMediaBatchItemSubmitted {
				continue
			}
			task, err := repo.TaskForUser(run.UserID, item.taskID())
			if errors.Is(err, gorm.ErrRecordNotFound) {
				item.Status = cloudAgentMediaBatchItemFailed
				continue
			}
			if err != nil {
				return err
			}
			// finishCloudAgentCleanup retains submitted upstream work on user
			// cancellation and cancels other tasks. Wait for that durable outcome.
			if !cloudAgentTaskTerminal(task.Status) {
				return errCloudAgentMediaBatchWait
			}
			_, writeErr := completeCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, item.NodeID, task, policy)
			if writeErr != nil {
				var appErr *AppError
				if !errors.Is(writeErr, gorm.ErrRecordNotFound) && !(errors.As(writeErr, &appErr) && (appErr.Status == 400 || appErr.Status == 409)) {
					return writeErr
				}
			}
			item.Status = cloudAgentMediaBatchItemFailed
			if task.Status == model.TaskStatusSucceeded && writeErr == nil {
				item.Status, item.Error = cloudAgentMediaBatchItemSucceeded, ""
			}
			if writeErr != nil {
				recordTaskWritebackDiagnostic(task, item.NodeID, "failed", "canvas_writeback_failed", writeErr)
			} else {
				recordTaskWritebackDiagnostic(task, item.NodeID, "succeeded", "", nil)
			}
			if err := repo.UpdateTaskExecutionDiagnostic(run.UserID, task.ID, task.ExecutionDiagnosticJSON); err != nil {
				return err
			}
		}
		batch.Phase, batch.MaxRetries = cloudAgentMediaBatchPhaseDone, 0
		if err := cloudAgentStoreTerminalBatchReceipt(current, batch); err != nil {
			return err
		}
		if current.FailureMessage == "" {
			current.FailureMessage = "Agent 会话存储已满；批次已收尾，未追加日志，任务结果请查看画布或任务中心"
		}
		return repo.ReleaseCloudAgentResourceLeases(run.UserID, batch.ID)
	})
	s.storageMu.Unlock()
	if errors.Is(err, errCloudAgentMediaBatchWait) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	latest, err := s.repo.CloudAgent(run.UserID, run.ID)
	if err != nil {
		return false, err
	}
	if err := s.finishCloudAgentCleanup(ctx, latest); err != nil {
		return false, err
	}
	return true, nil
}

func cloudAgentStoreTerminalBatchReceipt(run *model.CloudAgentExecution, batch *cloudAgentMediaBatch) error {
	var stateJSON map[string]json.RawMessage
	if err := json.Unmarshal([]byte(run.StateJSON), &stateJSON); err != nil {
		return err
	}
	batchJSON, err := json.Marshal(batch)
	if err != nil {
		return err
	}
	var receipt map[string]json.RawMessage
	if err := json.Unmarshal(batchJSON, &receipt); err != nil {
		return err
	}
	var items []map[string]json.RawMessage
	if err := json.Unmarshal(receipt["items"], &items); err != nil {
		return err
	}
	for _, item := range items {
		// These fields authorize a future submission/retry. A terminal batch
		// cannot use them; keep its task IDs, prices, titles and outcome receipt.
		delete(item, "arguments")
		delete(item, "resolvedHash")
		delete(item, "specHash")
	}
	if receipt["items"], err = json.Marshal(items); err != nil {
		return err
	}
	if stateJSON["mediaBatch"], err = json.Marshal(receipt); err != nil {
		return err
	}
	raw, err := json.Marshal(stateJSON)
	if err != nil {
		return err
	}
	if len(raw) > len(run.StateJSON) {
		return fmt.Errorf("terminal Agent batch receipt cannot increase stored bytes")
	}
	run.StateJSON = string(raw)
	_, err = cloudAgentDecode(run)
	return err
}
