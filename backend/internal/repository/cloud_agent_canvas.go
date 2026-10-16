package repository

import (
	"errors"

	"yingce/backend/internal/model"
)

var ErrCanvasAgentBusy = errors.New("当前画布已有 Agent 正在执行，请等待结束后再发送")

type CanvasAgentActivity struct {
	RunID          string `json:"runId"`
	Status         string `json:"status"`
	CleanupPending bool   `json:"cleanupPending"`
}

// Keep the admission transaction's observation; a later read may see a
// different run or a release and cannot explain why this request was rejected.
type CanvasAgentBusyError struct {
	Activity CanvasAgentActivity
}

func (e *CanvasAgentBusyError) Error() string { return ErrCanvasAgentBusy.Error() }
func (e *CanvasAgentBusyError) Unwrap() error { return ErrCanvasAgentBusy }

// Split checkpointed executions from uncheckpointed reservations so each branch
// can use its partial index instead of joining every completed historical run.
// Keep predicates literal to match the indexes even with prepared SQL plans.
const canvasAgentActivitySQL = `
SELECT run_id, status, cleanup_pending FROM (
    SELECT t.id AS run_id, COALESCE(e.status, 'queued') AS status, COALESCE(e.cleanup_pending, false) AS cleanup_pending, t.created_at
    FROM cloud_agent_executions e
    JOIN tasks t ON t.id = e.id AND t.user_id = e.user_id
    WHERE e.user_id = ? AND t.project_id = ? AND t.operation = 'cloud_agent'
      AND (e.status NOT IN ('completed', 'failed', 'cancelled', 'rejected') OR e.cleanup_pending = true)
    UNION ALL
    SELECT t.id AS run_id, 'queued' AS status, false AS cleanup_pending, t.created_at
    FROM tasks t
    WHERE t.user_id = ? AND t.project_id = ? AND t.operation = 'cloud_agent'
      AND t.agent_execution_ready = false
      AND t.status NOT IN ('succeeded', 'failed', 'cancelled')
      AND NOT EXISTS (SELECT 1 FROM cloud_agent_executions e WHERE e.id = t.id AND e.user_id = t.user_id)
) AS activity
ORDER BY created_at ASC, run_id ASC LIMIT 1`

// The root task reserves the canvas before the execution checkpoint exists.
// Once present, the execution (including cleanup) is authoritative. Read only
// control fields; polling must not hydrate transcripts or full canvas payloads.
func (r *Repository) CanvasAgentActivity(userID, canvasID string) (*CanvasAgentActivity, error) {
	var activity CanvasAgentActivity
	result := r.db.Raw(canvasAgentActivitySQL, userID, canvasID, userID, canvasID).Scan(&activity)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	return &activity, nil
}

// Must run first in the task-creation transaction, before reads/credit writes.
// The canvas row serializes admission across processes as well as browsers.
func (r *Repository) requireExclusiveCanvasAgent(task *model.Task) error {
	if task.Operation != "cloud_agent" {
		return nil
	}
	if err := r.LockCanvasMutation(task.UserID, task.ProjectID); err != nil {
		return err
	}
	if _, err := r.CanvasProjectMetadata(task.UserID, task.ProjectID); err != nil {
		return err
	}
	activity, err := r.CanvasAgentActivity(task.UserID, task.ProjectID)
	if err != nil {
		return err
	}
	if activity != nil && activity.RunID != task.ID {
		return &CanvasAgentBusyError{Activity: *activity}
	}
	return nil
}
