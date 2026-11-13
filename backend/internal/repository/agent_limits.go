package repository

import (
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

const DefaultAgentMaxRunsPerUser = 5

// The quota covers Agent payloads, including native sessions, receipts and undo
// snapshots. Ordinary task data continues to use the configurable task quota.
const AgentStoredDataLimit int64 = 256 << 20

// Release a carrier whose first checkpoint could not fit. A concurrent successful
// initializer wins: its execution/ready marker prevents this terminal update.
func (r *Repository) FailCloudAgentReservation(userID, id, message string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := New(tx).beginAgentStorageWrite(userID); err != nil {
			return err
		}
		return tx.Model(&model.Task{}).
			Where("id = ? AND user_id = ? AND operation = 'cloud_agent' AND agent_execution_ready = false", id, userID).
			Where("NOT EXISTS (SELECT 1 FROM cloud_agent_executions e WHERE e.id = tasks.id AND e.user_id = tasks.user_id)").
			Updates(map[string]any{"status": model.TaskStatusFailed, "error": message, "updated_at": time.Now()}).Error
	})
}

func enforceAgentRunLimit(tx *gorm.DB, task *model.Task, configured []int) error {
	if task.Operation != "cloud_agent" {
		return nil
	}
	limit := DefaultAgentMaxRunsPerUser
	if len(configured) > 0 {
		limit = configured[0]
	}
	if task.UserID == "" || limit < 1 || limit > 64 {
		return gorm.ErrInvalidData
	}
	// Acquire before observing the parent/canvas or count, including on SQLite.
	switch tx.Dialector.Name() {
	case "postgres":
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?)::bigint)", "agent-runs:"+task.UserID).Error; err != nil {
			return err
		}
	case "sqlite":
		if err := tx.Exec("UPDATE tasks SET progress = progress WHERE 1 = 0").Error; err != nil {
			return err
		}
	default:
		return gorm.ErrInvalidData
	}
	var count int64
	err := tx.Raw(`SELECT COUNT(*) FROM tasks t
		LEFT JOIN cloud_agent_executions e ON e.id = t.id AND e.user_id = t.user_id
		WHERE t.user_id = ? AND t.operation = 'cloud_agent' AND (
		(e.id IS NOT NULL AND (e.status NOT IN ('completed', 'failed', 'cancelled', 'rejected') OR e.cleanup_pending = true))
		OR (e.id IS NULL AND t.agent_execution_ready = false AND t.status NOT IN ('succeeded', 'failed', 'cancelled'))
		)`, task.UserID).Scan(&count).Error
	if err != nil {
		return err
	}
	if count >= int64(limit) {
		return kernel.QuotaExceeded(fmt.Sprintf("每个账号最多保留 %d 个进行中的 Agent 对话（含排队和等待确认），请先完成或停止已有对话", limit))
	}
	return nil
}

// beginAgentStorageWrite must run inside the write transaction, before changing
// payloads. PostgreSQL locks across backend instances; SQLite obtains its write
// lock before taking a read snapshot. Nested writes reuse the transaction lock.
func (r *Repository) beginAgentStorageWrite(userID string) error {
	if userID == "" {
		return gorm.ErrInvalidData
	}
	switch r.Dialect() {
	case "postgres":
		if err := r.db.Exec("SELECT pg_advisory_xact_lock(hashtext(?)::bigint)", "agent-storage:"+userID).Error; err != nil {
			return err
		}
	case "sqlite":
		if err := r.db.Exec("UPDATE agent_storage_usages SET stored_bytes = stored_bytes WHERE 1 = 0").Error; err != nil {
			return err
		}
	default:
		return gorm.ErrInvalidData
	}
	var usage model.AgentStorageUsage
	err := r.db.First(&usage, "user_id = ?", userID).Error
	if err == nil {
		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	used, err := r.agentPayloadBytes(userID)
	if err != nil {
		return err
	}
	return r.db.Create(&model.AgentStorageUsage{UserID: userID, StoredBytes: used, UpdatedAt: time.Now()}).Error
}

func (r *Repository) changeAgentStoredBytes(userID string, delta int64) error {
	if delta == 0 {
		return nil
	}
	q := r.db.Model(&model.AgentStorageUsage{}).Where("user_id = ?", userID)
	if delta > 0 {
		q = q.Where("stored_bytes <= ?", AgentStoredDataLimit-delta)
	} else {
		q = q.Where("stored_bytes >= ?", -delta)
	}
	result := q.Updates(map[string]any{"stored_bytes": gorm.Expr("stored_bytes + ?", delta), "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		if delta < 0 {
			return fmt.Errorf("Agent storage accounting is inconsistent")
		}
		return kernel.StorageCapacityExceeded("账号 Agent 会话、事件和撤销历史已达到 256MiB 上限，请联系管理员清理历史数据")
	}
	return nil
}

// AgentStoredBytes reads the ledger once initialized, including pre-upgrade
// payloads. A missing ledger is measured, never silently reported as zero.
func (r *Repository) AgentStoredBytes(userID string) (int64, error) {
	var usage model.AgentStorageUsage
	err := r.db.First(&usage, "user_id = ?", userID).Error
	if err == nil {
		return usage.StoredBytes, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, err
	}
	return r.agentPayloadBytes(userID)
}

func (r *Repository) agentPayloadBytes(userID string) (int64, error) {
	var total int64
	for _, field := range []struct{ table, column string }{
		{"cloud_agent_executions", "state_json"},
		{"cloud_agent_pi_sessions", "session_jsonl"},
		{"cloud_agent_event_records", "event_json"},
		{"cloud_agent_message_records", "message_json"},
		{"cloud_agent_canvas_mutations", "before_json"},
	} {
		length := "length(CAST(COALESCE(" + field.column + ", '') AS BLOB))"
		if r.Dialect() == "postgres" {
			length = "octet_length(COALESCE(" + field.column + ", ''))"
		}
		var size int64
		if err := r.db.Table(field.table).Select("COALESCE(SUM("+length+"), 0)").Where("user_id = ?", userID).Scan(&size).Error; err != nil {
			return 0, err
		}
		total += size
	}
	return total, nil
}
