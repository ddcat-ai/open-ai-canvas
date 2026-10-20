package repository

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const (
	AgentSessionDeleted          = "deleted"
	defaultAgentSessionListLimit = 100
	maxAgentSessionListLimit     = 500
)

var (
	ErrAgentSessionBusy        = errors.New("Agent 会话仍有未结束的任务")
	ErrAgentSessionUnavailable = errors.New("Agent 会话不存在")
)

type AgentSessionContinuationError struct {
	SessionID   string
	Activity    CanvasAgentActivity
	StaleParent bool
}

func (e *AgentSessionContinuationError) Error() string {
	if e.StaleParent {
		return "会话已有更新，请同步最新轮次后重新发送"
	}
	return "当前会话仍有 Agent 正在执行，请向该轮补充说明或等待结束"
}

// Serialize task admission with session deletion across processes. Ownership
// is checked separately by the scoped queries inside the transaction.
func lockOwnedWriteUser(tx *gorm.DB, userID string) error {
	if strings.TrimSpace(userID) == "" {
		return gorm.ErrInvalidData
	}
	switch tx.Dialector.Name() {
	case "postgres":
		return tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?)::bigint)", "owned-write:"+userID).Error
	case "sqlite":
		return tx.Exec("UPDATE tasks SET progress = progress WHERE 1 = 0").Error
	default:
		return gorm.ErrInvalidData
	}
}

// LockTaskAdmission must be called on the repository supplied by Transaction or
// MutateCloudAgentRun. It shares the task/session admission lock across replicas;
// the caller's budget check and reservation remain in that same transaction.
func (r *Repository) LockTaskAdmission(userID string) error {
	return lockOwnedWriteUser(r.db, userID)
}

// CreateAgentSession persists a durable Agent conversation identity.
//
// The application layer is responsible for validating the session contract
// and assigning its initial status/surface. The repository only keeps the
// write explicit so callers cannot accidentally create a row without an
// owner.
func (r *Repository) CreateAgentSession(session *model.AgentSession) error {
	if session == nil || strings.TrimSpace(session.ID) == "" || strings.TrimSpace(session.UserID) == "" {
		return gorm.ErrInvalidData
	}
	return r.db.Create(session).Error
}

// AgentSession loads one session in the caller's ownership scope.
func (r *Repository) AgentSession(userID, id string) (*model.AgentSession, error) {
	var session model.AgentSession
	err := r.db.Where("id = ? AND user_id = ?", strings.TrimSpace(id), strings.TrimSpace(userID)).First(&session).Error
	if err != nil {
		return nil, err
	}
	return &session, nil
}

// AgentSessions lists a user's durable sessions, newest first. The secondary
// ID ordering keeps pagination deterministic when two rows share a timestamp.
func (r *Repository) AgentSessions(userID, surface, status string, limit int) ([]model.AgentSession, error) {
	query := r.db.Model(&model.AgentSession{}).Where("user_id = ? AND status <> ?", strings.TrimSpace(userID), AgentSessionDeleted)
	if surface = strings.TrimSpace(surface); surface != "" {
		query = query.Where("surface = ?", surface)
	}
	if status = strings.TrimSpace(status); status != "" {
		query = query.Where("status = ?", status)
	}
	if limit <= 0 {
		limit = defaultAgentSessionListLimit
	}
	if limit > maxAgentSessionListLimit {
		limit = maxAgentSessionListLimit
	}
	var sessions []model.AgentSession
	err := query.Select("id", "user_id", "title", "surface", "last_surface", "status", "revision", "created_at", "updated_at").Order("updated_at DESC, id DESC").Limit(limit).Find(&sessions).Error
	return sessions, err
}

// AgentSessionsForCanvas narrows the durable session index to sessions that
// already have a run on the requested canvas. The subquery keeps the session
// table small and avoids denormalizing canvas ownership into conversations.
func (r *Repository) AgentSessionsForCanvas(userID, canvasID, surface, status string, limit int) ([]model.AgentSession, error) {
	userID = strings.TrimSpace(userID)
	canvasID = strings.TrimSpace(canvasID)
	if canvasID == "" {
		return r.AgentSessions(userID, surface, status, limit)
	}
	query := r.db.Model(&model.AgentSession{}).
		Where("user_id = ? AND status <> ? AND id IN (SELECT session_id FROM cloud_agent_executions WHERE user_id = ? AND canvas_id = ? AND session_id <> '')", userID, AgentSessionDeleted, userID, canvasID)
	if surface = strings.TrimSpace(surface); surface != "" {
		query = query.Where("surface = ?", surface)
	}
	if status = strings.TrimSpace(status); status != "" {
		query = query.Where("status = ?", status)
	}
	if limit <= 0 {
		limit = defaultAgentSessionListLimit
	}
	if limit > maxAgentSessionListLimit {
		limit = maxAgentSessionListLimit
	}
	var sessions []model.AgentSession
	err := query.Order("updated_at DESC, id DESC").Limit(limit).Find(&sessions).Error
	return sessions, err
}

// UpdateAgentSession writes mutable session metadata in the caller's owner
// scope. Revision is supplied by the caller; use MutateAgentSession when the
// update must be guarded by an expected revision.
func (r *Repository) UpdateAgentSession(userID string, session *model.AgentSession) error {
	if session == nil || strings.TrimSpace(session.ID) == "" || strings.TrimSpace(userID) == "" {
		return gorm.ErrInvalidData
	}
	if session.UserID != "" && strings.TrimSpace(session.UserID) != strings.TrimSpace(userID) {
		return gorm.ErrRecordNotFound
	}
	updatedAt := session.UpdatedAt
	if updatedAt.IsZero() {
		updatedAt = time.Now()
	}
	result := r.db.Model(&model.AgentSession{}).
		Where("id = ? AND user_id = ?", strings.TrimSpace(session.ID), strings.TrimSpace(userID)).
		Updates(map[string]any{
			"title":           session.Title,
			"surface":         session.Surface,
			"last_surface":    session.LastSurface,
			"status":          session.Status,
			"checkpoint_json": session.CheckpointJSON,
			"revision":        session.Revision,
			"updated_at":      updatedAt,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	session.UpdatedAt = updatedAt
	session.UserID = strings.TrimSpace(userID)
	return nil
}

// TouchAgentSession updates the surface and recency metadata after a run is
// attached to a session. An empty title deliberately leaves the existing
// title unchanged so a later run cannot erase a user-provided name.
func (r *Repository) TouchAgentSession(userID, id, surface, title string) error {
	userID = strings.TrimSpace(userID)
	id = strings.TrimSpace(id)
	if userID == "" || id == "" {
		return gorm.ErrRecordNotFound
	}
	now := time.Now()
	updates := map[string]any{
		"updated_at": now,
		"revision":   gorm.Expr("revision + 1"),
	}
	if surface = strings.TrimSpace(surface); surface != "" {
		updates["surface"] = surface
		updates["last_surface"] = surface
	}
	if title = strings.TrimSpace(title); title != "" {
		updates["title"] = title
	}
	result := r.db.Model(&model.AgentSession{}).
		Where("id = ? AND user_id = ? AND status <> ?", id, userID, AgentSessionDeleted).
		Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// MutateAgentSession performs an optimistic, user-scoped session update. The
// callback receives the row after its revision has been advanced, matching the
// existing CloudAgent mutation contract.
func (r *Repository) MutateAgentSession(userID, id string, revision int64, fn func(*model.AgentSession) error) error {
	if fn == nil {
		return gorm.ErrInvalidData
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.AgentSession{}).
			Where("id = ? AND user_id = ? AND revision = ?", strings.TrimSpace(id), strings.TrimSpace(userID), revision).
			UpdateColumn("revision", gorm.Expr("revision + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCreationConflict
		}
		session, err := New(tx).AgentSession(userID, id)
		if err != nil {
			return err
		}
		if err := fn(session); err != nil {
			return err
		}
		if session.UpdatedAt.IsZero() {
			session.UpdatedAt = time.Now()
		}
		return New(tx).UpdateAgentSession(userID, session)
	})
}

// CloudAgentExecutionsBySession returns newest runs first. An optional before
// cursor is resolved inside the same user/session scope to prevent probing
// another user's run ID. Legacy ConversationID rows remain readable.
func (r *Repository) CloudAgentExecutionsBySession(userID, sessionID string, limit int, before ...string) ([]model.CloudAgentExecution, error) {
	return r.cloudAgentExecutionsBySession(userID, sessionID, limit, true, before...)
}

// Budget admission needs immutable request lineage and task IDs, not hydrated
// transcripts or journal windows while holding the user's admission lock.
func (r *Repository) CloudAgentBudgetRecordsBySession(userID, sessionID string, limit int, before ...string) ([]model.CloudAgentExecution, error) {
	return r.cloudAgentExecutionsBySession(userID, sessionID, limit, false, before...)
}

func (r *Repository) cloudAgentExecutionsBySession(userID, sessionID string, limit int, hydrate bool, before ...string) ([]model.CloudAgentExecution, error) {
	userID = strings.TrimSpace(userID)
	sessionID = strings.TrimSpace(sessionID)
	if userID == "" || sessionID == "" {
		return nil, nil
	}
	if limit <= 0 {
		limit = defaultAgentSessionListLimit
	}
	if limit > maxAgentSessionListLimit {
		limit = maxAgentSessionListLimit
	}
	var runs []model.CloudAgentExecution
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Where(
			"user_id = ? AND (session_id = ? OR (session_id = '' AND conversation_id = ?))",
			userID, sessionID, sessionID,
		)
		if !hydrate {
			query = query.Select("id", "state_json", "created_at")
		}
		if len(before) > 0 && strings.TrimSpace(before[0]) != "" {
			var cursor model.CloudAgentExecution
			if err := tx.Where("id = ? AND user_id = ? AND (session_id = ? OR (session_id = '' AND conversation_id = ?))", strings.TrimSpace(before[0]), userID, sessionID, sessionID).First(&cursor).Error; err != nil {
				return err
			}
			query = query.Where("created_at < ? OR (created_at = ? AND id < ?)", cursor.CreatedAt, cursor.CreatedAt, cursor.ID)
		}
		if err := query.Order("created_at DESC, id DESC").Limit(limit).Find(&runs).Error; err != nil {
			return err
		}
		if !hydrate {
			return nil
		}
		scoped := New(tx)
		for index := range runs {
			if err := scoped.hydrateCloudAgent(&runs[index]); err != nil {
				return err
			}
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return runs, err
}

// DeleteAgentSession removes the conversation from history, not its execution
// journal, billing evidence or generated assets. The user write lock is shared
// with task admission so an in-flight submission cannot revive a deleted row.
func (r *Repository) DeleteAgentSession(userID, id string) error {
	return r.deleteAgentSession(userID, id, nil)
}

func (r *Repository) deleteAgentSession(userID, id string, cutoff *time.Time) error {
	userID, id = strings.TrimSpace(userID), strings.TrimSpace(id)
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockOwnedWriteUser(tx, userID); err != nil {
			return err
		}
		session, err := New(tx).AgentSession(userID, id)
		if err != nil || session.Status == AgentSessionDeleted {
			return err
		}
		if cutoff != nil && (session.Surface != "creation" || !session.UpdatedAt.Before(*cutoff)) {
			return nil
		}
		if session.Surface == "creation" {
			var history struct {
				SourceConversationID string `json:"sourceConversationId"`
			}
			if session.CheckpointJSON != "" {
				if err := json.Unmarshal([]byte(session.CheckpointJSON), &history); err != nil {
					return err
				}
			}
			tasks, err := New(tx).CreationSessionTasks(userID, id, history.SourceConversationID)
			if err != nil {
				return err
			}
			for _, task := range tasks {
				if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
					return ErrAgentSessionBusy
				}
				if cutoff != nil && !task.UpdatedAt.Before(*cutoff) {
					return nil
				}
			}
		}
		runs := tx.Model(&model.CloudAgentExecution{}).
			Where("user_id = ? AND (session_id = ? OR (session_id = '' AND conversation_id = ?))", userID, id, id)
		var count int64
		if err := runs.Where("status NOT IN ? OR cleanup_pending = ?", []string{"completed", "failed", "cancelled", "rejected"}, true).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrAgentSessionBusy
		}
		if cutoff != nil {
			var recent int64
			if err := tx.Model(&model.CloudAgentExecution{}).Where("user_id = ? AND (session_id = ? OR conversation_id = ?) AND updated_at >= ?", userID, id, id, *cutoff).Count(&recent).Error; err != nil {
				return err
			}
			if recent > 0 {
				return nil
			}
		}
		runIDs := tx.Model(&model.CloudAgentExecution{}).Select("id").
			Where("user_id = ? AND (session_id = ? OR (session_id = '' AND conversation_id = ?))", userID, id, id)
		if err := tx.Model(&model.Task{}).
			Where("user_id = ? AND status IN ? AND (id IN (?) OR agent_run_id IN (?))", userID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}, runIDs, runIDs).
			Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrAgentSessionBusy
		}
		// A task may be committed just before its execution row is created.
		// Even terminal legacy tasks can still initialize an Agent execution.
		// Inspect only uninitialized roots, without loading old transcripts.
		var pending []model.Task
		if err := tx.Select("input_json").Where("user_id = ? AND operation = ? AND id NOT IN (SELECT id FROM cloud_agent_executions WHERE user_id = ?)", userID, "cloud_agent", userID).Find(&pending).Error; err != nil {
			return err
		}
		for _, task := range pending {
			sessionID, err := cloudAgentTaskSessionID(task.InputJSON)
			if err != nil {
				return err
			}
			if sessionID == id {
				return ErrAgentSessionBusy
			}
		}
		return tx.Model(session).Updates(map[string]any{"status": AgentSessionDeleted, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

func cloudAgentTaskSessionID(inputJSON string) (string, error) {
	var input struct {
		Agent struct {
			Request struct {
				SessionID string `json:"sessionId"`
			} `json:"request"`
		} `json:"cloudAgent"`
	}
	if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
		return "", err
	}
	return strings.TrimSpace(input.Agent.Request.SessionID), nil
}

// Called inside the existing user-locked task admission transaction, before
// any task or billing write. Older roots without session IDs stay compatible.
func requireActiveAgentSessionForTask(tx *gorm.DB, task *model.Task) error {
	if task.Operation != "cloud_agent" {
		return requireActiveCreationSessionForTask(tx, task)
	}
	id, err := cloudAgentTaskSessionID(task.InputJSON)
	if err != nil || id == "" {
		return err
	}
	var count int64
	if err := tx.Model(&model.AgentSession{}).Where("id = ? AND user_id = ? AND status <> ?", id, task.UserID, AgentSessionDeleted).Count(&count).Error; err != nil {
		return err
	}
	if count != 1 {
		return ErrAgentSessionUnavailable
	}
	return requireCurrentCreationAgentParent(tx, task, id)
}

// Homepage conversations have one continuation path. Check it inside the same
// user-locked transaction as task creation, including roots whose execution
// checkpoint has not been initialized yet. Canvas branching is unchanged.
func requireCurrentCreationAgentParent(tx *gorm.DB, task *model.Task, sessionID string) error {
	var input struct {
		Agent struct {
			ParentID string `json:"parentId"`
			Request  struct {
				Surface string `json:"surface"`
			} `json:"request"`
		} `json:"cloudAgent"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return err
	}
	if input.Agent.Request.Surface != "creation" {
		return nil
	}
	query := func() *gorm.DB {
		return tx.Model(&model.CloudAgentExecution{}).
			Select("id", "status", "cleanup_pending", "created_at").
			Where("user_id = ? AND session_id = ?", task.UserID, sessionID).
			Order("created_at DESC, id DESC")
	}
	reject := func(run model.CloudAgentExecution, stale bool) error {
		return &AgentSessionContinuationError{SessionID: sessionID, StaleParent: stale,
			Activity: CanvasAgentActivity{RunID: run.ID, Status: run.Status, CleanupPending: run.CleanupPending}}
	}
	var active model.CloudAgentExecution
	if err := query().Where("status NOT IN ? OR cleanup_pending = ?", []string{"completed", "failed", "cancelled", "rejected"}, true).Limit(1).Find(&active).Error; err != nil {
		return err
	}
	if active.ID != "" {
		return reject(active, false)
	}
	var pending []model.Task
	if err := tx.Select("id", "input_json").Where("user_id = ? AND operation = ? AND agent_execution_ready = false", task.UserID, "cloud_agent").
		Where("status NOT IN ?", []model.TaskStatus{model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled}).
		Where("NOT EXISTS (SELECT 1 FROM cloud_agent_executions e WHERE e.id = tasks.id AND e.user_id = tasks.user_id)").
		Find(&pending).Error; err != nil {
		return err
	}
	for _, reserved := range pending {
		reservedSessionID, err := cloudAgentTaskSessionID(reserved.InputJSON)
		if err != nil {
			return err
		}
		if reservedSessionID == sessionID {
			return reject(model.CloudAgentExecution{ID: reserved.ID, Status: "queued"}, false)
		}
	}
	var latest model.CloudAgentExecution
	if err := query().Limit(1).Find(&latest).Error; err != nil {
		return err
	}
	if latest.ID != "" && input.Agent.ParentID != latest.ID {
		return reject(latest, true)
	}
	return nil
}
