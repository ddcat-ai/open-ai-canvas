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
			if _, err = s.CancelTask(ctx, run.UserID, id); err != nil {
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
		return nil
	})
}
