package repository

import (
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrBulkUserNotFound    = errors.New("bulk user not found")
	ErrBulkCurrentAdmin    = errors.New("bulk includes current admin")
	ErrBulkLastActiveAdmin = errors.New("bulk removes last active admin")
)

type AdminUserCounts struct {
	LedgerEntries int64 `json:"ledgerEntries"`
	Tasks         int64 `json:"tasks"`
	APICalls      int64 `json:"apiCalls"`
	AuditEvents   int64 `json:"auditEvents"`
}

func (r *Repository) AppendAdminAudit(event *model.AdminAuditEvent) error {
	return r.db.Create(event).Error
}

// BulkDisableUsers 把管理员保留校验、会话清理、状态更新和审计写入放在同一事务中，避免部分停用。
func (r *Repository) BulkDisableUsers(actorID string, userIDs []string, events []model.AdminAuditEvent, now time.Time) ([]model.User, error) {
	var users []model.User
	err := r.db.Transaction(func(tx *gorm.DB) error {
		query := tx.Where("id IN ?", userIDs)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.Find(&users).Error; err != nil {
			return err
		}
		if len(users) != len(userIDs) {
			return ErrBulkUserNotFound
		}
		for _, user := range users {
			if user.ID == actorID {
				return ErrBulkCurrentAdmin
			}
		}
		var remainingAdmins int64
		if err := tx.Model(&model.User{}).
			Where("role = ? AND status = ? AND id NOT IN ?", model.UserRoleAdmin, model.UserStatusActive, userIDs).
			Count(&remainingAdmins).Error; err != nil {
			return err
		}
		if remainingAdmins == 0 {
			return ErrBulkLastActiveAdmin
		}
		if err := tx.Delete(&model.AuthSession{}, "user_id IN ?", userIDs).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.User{}).Where("id IN ?", userIDs).Updates(map[string]any{"status": model.UserStatusDisabled, "updated_at": now}).Error; err != nil {
			return err
		}
		if len(events) > 0 {
			if err := tx.Create(&events).Error; err != nil {
				return err
			}
		}
		for index := range users {
			users[index].Status = model.UserStatusDisabled
			users[index].UpdatedAt = now
		}
		return nil
	})
	return users, err
}

func (r *Repository) AdminAuditEvents(targetType string, targetID string, limit int, offset int) ([]model.AdminAuditEvent, int64, error) {
	query := r.db.Model(&model.AdminAuditEvent{})
	if targetType != "" {
		query = query.Where("target_type = ?", targetType)
	}
	if targetID != "" {
		query = query.Where("target_id = ?", targetID)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var events []model.AdminAuditEvent
	err := query.Order("created_at desc").Limit(limit).Offset(offset).Find(&events).Error
	return events, total, err
}

func (r *Repository) AdminUserCounts(userID string) (AdminUserCounts, error) {
	var counts AdminUserCounts
	queries := []struct {
		model any
		where string
		value *int64
	}{
		{&model.CreditLedgerEntry{}, "user_id = ?", &counts.LedgerEntries},
		{&model.Task{}, "user_id = ?", &counts.Tasks},
		{&model.ApiCallLog{}, "user_id = ?", &counts.APICalls},
		{&model.AdminAuditEvent{}, "target_type = 'user' AND target_id = ?", &counts.AuditEvents},
	}
	for _, query := range queries {
		if err := r.db.Model(query.model).Where(query.where, userID).Count(query.value).Error; err != nil {
			return AdminUserCounts{}, err
		}
	}
	return counts, nil
}

func (r *Repository) AdminUserTasks(userID string, limit int, offset int) ([]model.Task, int64, error) {
	query := r.db.Model(&model.Task{}).Where("user_id = ?", userID)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var tasks []model.Task
	err := query.Select("id", "user_id", "session_id", "project_id", "type", "status", "stage", "progress", "operation", "provider", "model", "billing_order_id", "provider_request_id", "poll_stage", "attempts", "started_at", "completed_at", "created_at", "updated_at").
		Order("created_at desc").Limit(limit).Offset(offset).Find(&tasks).Error
	return tasks, total, err
}

func (r *Repository) DisableRedeemBatch(batchID string, now time.Time) (int64, error) {
	result := r.db.Model(&model.RedeemCode{}).
		Where("batch_id = ? AND status = ? AND (expires_at IS NULL OR expires_at > ?)", batchID, model.RedeemCodeUnused, now).
		Updates(map[string]any{"status": model.RedeemCodeDisabled, "updated_at": now})
	return result.RowsAffected, result.Error
}

func (r *Repository) DisableRedeemCode(batchID string, codeID string, now time.Time) (bool, error) {
	result := r.db.Model(&model.RedeemCode{}).
		Where("id = ? AND batch_id = ? AND status = ? AND (expires_at IS NULL OR expires_at > ?)", codeID, batchID, model.RedeemCodeUnused, now).
		Updates(map[string]any{"status": model.RedeemCodeDisabled, "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) APICallLog(id string) (*model.ApiCallLog, error) {
	var log model.ApiCallLog
	if err := r.db.First(&log, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &log, nil
}
