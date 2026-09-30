package app

import (
	"context"
	"errors"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// CleanupPending is the durable hand-off between orchestration and task/canvas
// cleanup. HTTP cancellation and the background scheduler use the same path.
func (s *Service) finishCloudAgentCleanup(ctx context.Context, run *model.CloudAgentExecution) error {
	if !run.CleanupPending || !cloudAgentRunTerminal(run.Status) {
		return nil
	}
	state, decodeErr := cloudAgentDecode(run)
	activeID, mediaID, canvasID := run.ActiveTaskID, run.MediaTaskID, run.CanvasID
	if decodeErr == nil {
		activeID, mediaID, canvasID = state.ActiveTaskID, state.MediaTaskID, state.Request.CanvasID
	}
	// 本轮若正停在压缩上（被取消/失败收尾），要在取消子任务之前把保底检查点落盘并清掉压缩态：
	// 终态轮次不会再被调度器推进，否则 ContextCompaction 会永远挂在"正在压缩"、检查点永久丢失。
	// keepTerminal=true：收尾只落检查点与事件，绝不把 failed/cancelled 复活成 completed。
	if decodeErr == nil && state.ContextCompaction != nil {
		if err := s.finalizeCloudAgentInterruptedCompaction(run, &state, "本轮在压缩期间结束，已使用服务端保底检查点"); err != nil && !errors.Is(err, errCloudAgentCheckpoint) {
			return err
		}
		// 收尾那一步要再写一次控制面，必须先重新读：上面的检查点写入推进了 revision。
		refreshed, readErr := s.repo.CloudAgent(run.UserID, run.ID)
		if readErr != nil {
			return readErr
		}
		run = refreshed
	}
	seen := map[string]bool{}
	for _, id := range []string{run.ID, activeID, mediaID} {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		if err := ctx.Err(); err != nil {
			return err
		}
		task, err := s.repo.TaskForUser(run.UserID, id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return err
		}
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			source := model.TaskCancellationParentFailed
			if run.Status == "cancelled" {
				source = model.TaskCancellationParentCancelled
			}
			if _, err = s.taskLifecycle().cancelTaskWithIntent(ctx, run.UserID, id, model.TaskCancellationIntent{Source: source}); err != nil {
				// Completion may win the cancellation race. Re-read rather than
				// treating a truthful terminal result as a permanent cleanup error.
				latest, readErr := s.repo.TaskForUser(run.UserID, id)
				if readErr != nil || !cloudAgentTaskTerminal(latest.Status) {
					return err
				}
			}
		}
	}
	if mediaID != "" && decodeErr == nil && state.CallIndex < len(state.Calls) {
		err := s.advanceCloudAgentMedia(run, &state, state.Calls[state.CallIndex])
		if err != nil && !errors.Is(err, errCloudAgentCheckpoint) {
			return err
		}
		if err == nil {
			var readErr error
			run, readErr = s.repo.CloudAgent(run.UserID, run.ID)
			if readErr != nil {
				return readErr
			}
			mediaID = ""
		}
	}
	// A damaged/oversized transcript cannot record another tool event. The
	// control-plane CAS and canvas terminal write must still be able to commit.
	var mediaTask *model.Task
	var policy RuntimePolicySetting
	if mediaID != "" && canvasID != "" {
		var err error
		mediaTask, err = s.repo.TaskForUser(run.UserID, mediaID)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			mediaTask = nil
		}
		policy, err = s.RuntimePolicy()
		if err != nil {
			return err
		}
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		if mediaTask != nil {
			targetNodeID := ""
			if taskContext := taskClientContext(mediaTask.InputJSON); taskContext != nil {
				targetNodeID = taskContext.NodeID
			}
			if _, err := completeCloudAgentMediaNode(repo, run.UserID, canvasID, targetNodeID, mediaTask, policy); err != nil {
				var appErr *AppError
				if !errors.Is(err, gorm.ErrRecordNotFound) && !(errors.As(err, &appErr) && (appErr.Status == 400 || appErr.Status == 409)) {
					return err
				}
				current.FailureMessage = cloudAgentSafeToolError(err) + "；任务记录保留在任务中心"
			}
		}
		current.CleanupPending = false
		current.ActiveTaskID, current.MediaTaskID = "", ""
		if err := repo.ReleaseCloudAgentResourceLeasesByRun(run.UserID, run.ID); err != nil {
			return err
		}
		return nil
	})
}
