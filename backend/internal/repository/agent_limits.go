package repository

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

const DefaultAgentMaxRunsPerUser = 5

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
	if err := lockAgentRunAdmissions(tx, task.UserID); err != nil {
		return err
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

func lockAgentRunAdmissions(tx *gorm.DB, userID string) error {
	switch tx.Dialector.Name() {
	case "postgres":
		return tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?)::bigint)", "agent-runs:"+userID).Error
	case "sqlite":
		return tx.Exec("UPDATE tasks SET progress = progress WHERE 1 = 0").Error
	default:
		return gorm.ErrInvalidData
	}
}

func lockAgentStoragePool(tx *gorm.DB) error {
	switch tx.Dialector.Name() {
	case "postgres":
		return tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?)::bigint)", "agent-storage:global").Error
	case "sqlite":
		return tx.Exec("UPDATE agent_storage_usages SET stored_bytes = stored_bytes WHERE 1 = 0").Error
	default:
		return gorm.ErrInvalidData
	}
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
		if err := lockAgentStoragePool(r.db); err != nil {
			return err
		}
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
	return r.ensureAgentStorageUsage(userID)
}

func (r *Repository) ensureAgentStorageUsage(userID string) error {
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
	var limit int64
	if delta > 0 {
		var err error
		limit, err = r.agentHistoryLimitBytes()
		if err != nil {
			return err
		}
		q = q.Where("stored_bytes <= ?", limit-delta)
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
		// Make room from old terminal runs before rejecting a new write. The
		// current run is excluded by the age cutoff, so its checkpoint transaction
		// cannot compact its own rows while they are still being assembled.
		if _, compactErr := r.compactOldestCloudAgentHistoryLocked(userID, time.Now().Add(-time.Minute), delta); compactErr != nil {
			return compactErr
		} else {
			result = q.Updates(map[string]any{"stored_bytes": gorm.Expr("stored_bytes + ?", delta), "updated_at": time.Now()})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 1 {
				return r.enforceGlobalAgentStorageLimit()
			}
		}
		return &kernel.AppError{Status: kernel.CodeForbidden, Code: kernel.CodeQuotaExceeded, Reason: kernel.ReasonAgentHistoryCapacityExceeded,
			Message: fmt.Sprintf("本次写入将超过账号 Agent 历史的 %d MiB 上限。请联系管理员调高 Agent 历史额度或清理历史；购买文件空间不会增加此额度。", limit>>20)}
	}
	if delta > 0 {
		return r.enforceGlobalAgentStorageLimit()
	}
	return nil
}

func (r *Repository) enforceGlobalAgentStorageLimit() error {
	globalLimit, err := r.agentHistoryGlobalLimitBytes()
	if err != nil {
		return err
	}
	var total int64
	if err := r.db.Model(&model.AgentStorageUsage{}).Select("COALESCE(SUM(stored_bytes), 0)").Scan(&total).Error; err != nil {
		return err
	}
	if total <= globalLimit {
		return nil
	}
	if _, err := r.compactOldestCloudAgentHistoryGlobalLocked(time.Now().Add(-time.Minute), total-globalLimit); err != nil {
		return err
	}
	if err := r.db.Model(&model.AgentStorageUsage{}).Select("COALESCE(SUM(stored_bytes), 0)").Scan(&total).Error; err != nil {
		return err
	}
	if total <= globalLimit {
		return nil
	}
	return &kernel.AppError{Status: kernel.CodeForbidden, Code: kernel.CodeQuotaExceeded, Reason: kernel.ReasonAgentHistoryCapacityExceeded,
		Message: fmt.Sprintf("平台 Agent 热历史池已达到 %d MiB 上限，请整理或删除历史", globalLimit>>20)}
}

func (r *Repository) agentHistoryLimitBytes() (int64, error) {
	policy := struct{ Resource model.AgentHistoryQuota }{Resource: model.AgentHistoryQuota{AgentHistoryMB: model.DefaultAgentHistoryMB, AgentHistoryGlobalMB: model.DefaultAgentHistoryGlobalMB}}
	setting, err := r.SystemSettingOptional(model.RuntimePolicySettingKey)
	if err != nil {
		return 0, err
	}
	if setting != nil {
		if err := json.Unmarshal([]byte(setting.ValueJSON), &policy); err != nil {
			return 0, fmt.Errorf("读取 Agent 历史额度失败: %w", err)
		}
	}
	return policy.Resource.LimitBytes()
}

func (r *Repository) agentHistoryGlobalLimitBytes() (int64, error) {
	policy := struct{ Resource model.AgentHistoryQuota }{Resource: model.AgentHistoryQuota{AgentHistoryMB: model.DefaultAgentHistoryMB, AgentHistoryGlobalMB: model.DefaultAgentHistoryGlobalMB}}
	setting, err := r.SystemSettingOptional(model.RuntimePolicySettingKey)
	if err != nil {
		return 0, err
	}
	if setting != nil {
		if err := json.Unmarshal([]byte(setting.ValueJSON), &policy); err != nil {
			return 0, fmt.Errorf("读取 Agent 历史额度失败: %w", err)
		}
	}
	return policy.Resource.GlobalLimitBytes()
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
