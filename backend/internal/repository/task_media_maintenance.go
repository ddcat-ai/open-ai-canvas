package repository

import (
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

func (r *Repository) LockFailedTaskMedia(task *model.Task, owner string, audit *model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		result := tx.Model(&model.Task{}).Where("id = ? AND user_id = ? AND status = ? AND media_recovery_json = ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)", task.ID, task.UserID, model.TaskStatusFailed, task.MediaRecoveryJSON, now).
			Updates(map[string]any{"lease_owner": owner, "lease_expires_at": now.Add(5 * time.Minute)})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		return tx.Create(audit).Error
	})
}

func (r *Repository) UnlockFailedTaskMedia(taskID, owner string) error {
	return r.db.Model(&model.Task{}).Where("id = ? AND lease_owner = ?", taskID, owner).Updates(map[string]any{"lease_owner": "", "lease_expires_at": nil}).Error
}

func (r *Repository) UpdateDiscardedTaskMedia(taskID, owner, encrypted string) error {
	result := r.db.Model(&model.Task{}).Where("id = ? AND status = ? AND lease_owner = ? AND lease_expires_at > ?", taskID, model.TaskStatusFailed, owner, time.Now()).Updates(map[string]any{"media_recovery_json": encrypted, "updated_at": time.Now()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskStateConflict
	}
	return nil
}
