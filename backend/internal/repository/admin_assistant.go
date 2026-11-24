package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrAssistantConflict = errors.New("assistant state changed")
var ErrAssistantAttachmentQuota = errors.New("assistant attachment quota exceeded")

func (r *Repository) CreateAssistantRecord(value any) error { return r.db.Create(value).Error }
func (r *Repository) AssistantCredential(hash string) (*model.AssistantCredential, error) {
	var row model.AssistantCredential
	err := r.db.Where("token_hash = ?", hash).First(&row).Error
	return &row, err
}
func (r *Repository) AssistantCredentialByID(id string) (*model.AssistantCredential, error) {
	var row model.AssistantCredential
	err := r.db.First(&row, "id = ?", id).Error
	return &row, err
}
func (r *Repository) AssistantCredentials(userID string, page int) ([]model.AssistantCredential, bool, error) {
	var rows []model.AssistantCredential
	err := r.db.Where("user_id = ? AND grant_id = ''", userID).Order("created_at desc, id desc").Offset((page - 1) * 50).Limit(51).Find(&rows).Error
	more := len(rows) > 50
	if more {
		rows = rows[:50]
	}
	return rows, more, err
}
func (r *Repository) AssistantActiveCredentialCount(userID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.AssistantCredential{}).Where("user_id = ? AND grant_id = '' AND revoked_at IS NULL AND expires_at > ?", userID, time.Now()).Count(&count).Error
	return count, err
}
func (r *Repository) RevokeAssistantCredential(userID, id string) error {
	res := r.db.Model(&model.AssistantCredential{}).Where("id = ? AND user_id = ?", id, userID).Update("revoked_at", time.Now())
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
func (r *Repository) AssistantClient(id string) (*model.AssistantOAuthClient, error) {
	var row model.AssistantOAuthClient
	err := r.db.First(&row, "id = ?", id).Error
	return &row, err
}
func (r *Repository) AssistantCode(hash string) (*model.AssistantOAuthCode, error) {
	var row model.AssistantOAuthCode
	err := r.db.First(&row, "id = ?", hash).Error
	return &row, err
}
func (r *Repository) ConsumeAssistantCode(hash string, now time.Time) error {
	res := r.db.Model(&model.AssistantOAuthCode{}).Where("id = ? AND consumed_at IS NULL AND expires_at > ?", hash, now).Update("consumed_at", now)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return ErrAssistantConflict
	}
	return nil
}
func (r *Repository) AssistantGrant(id string) (*model.AssistantGrant, error) {
	var row model.AssistantGrant
	err := r.db.First(&row, "id = ?", id).Error
	return &row, err
}
func (r *Repository) AssistantGrants(userID string, page int) ([]model.AssistantGrant, bool, error) {
	var rows []model.AssistantGrant
	err := r.db.Where("user_id = ?", userID).Order("created_at desc, id desc").Offset((page - 1) * 50).Limit(51).Find(&rows).Error
	more := len(rows) > 50
	if more {
		rows = rows[:50]
	}
	return rows, more, err
}
func (r *Repository) RevokeAssistantGrant(userID, id string) error {
	res := r.db.Model(&model.AssistantGrant{}).Where("id = ? AND user_id = ?", id, userID).Update("revoked_at", time.Now())
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
func (r *Repository) AssistantGrantByRefresh(hash string) (*model.AssistantGrant, error) {
	var row model.AssistantGrant
	err := r.db.First(&row, "refresh_hash = ?", hash).Error
	return &row, err
}
func (r *Repository) AssistantRefreshUse(hash string) (*model.AssistantRefreshUse, error) {
	var row model.AssistantRefreshUse
	err := r.db.First(&row, "hash = ?", hash).Error
	return &row, err
}
func (r *Repository) RotateAssistantRefresh(id, oldHash, newHash string, now time.Time) error {
	res := r.db.Model(&model.AssistantGrant{}).Where("id = ? AND refresh_hash = ? AND revoked_at IS NULL AND expires_at > ?", id, oldHash, now).Update("refresh_hash", newHash)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return ErrAssistantConflict
	}
	return r.db.Create(&model.AssistantRefreshUse{Hash: oldHash, GrantID: id, CreatedAt: now}).Error
}
func (r *Repository) AssistantInvocation(credentialID, key string) (*model.AssistantInvocation, error) {
	var row model.AssistantInvocation
	err := r.db.First(&row, "credential_id = ? AND idempotency_key = ?", credentialID, key).Error
	return &row, err
}
func (r *Repository) ReserveAssistantInvocation(row *model.AssistantInvocation) error {
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(row).Error
}
func (r *Repository) AssistantInvocationByID(userID, id string) (*model.AssistantInvocation, error) {
	var row model.AssistantInvocation
	err := r.db.First(&row, "id = ? AND user_id = ?", id, userID).Error
	return &row, err
}
func (r *Repository) AssistantInvocations(userID string, page int) ([]model.AssistantInvocation, error) {
	var rows []model.AssistantInvocation
	err := r.db.Where("user_id = ?", userID).Order("created_at desc").Offset((page - 1) * 50).Limit(50).Find(&rows).Error
	return rows, err
}
func (r *Repository) TransitionAssistantInvocation(id, from, to string, now time.Time) error {
	values := map[string]any{"status": to}
	if to == "running" {
		values["started_at"] = now
	}
	res := r.db.Model(&model.AssistantInvocation{}).Where("id = ? AND status = ? AND expires_at > ?", id, from, now).Updates(values)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return ErrAssistantConflict
	}
	return nil
}
func (r *Repository) FinishAssistantInvocation(id, status, result string, duration int64, now time.Time) error {
	res := r.db.Model(&model.AssistantInvocation{}).Where("id = ? AND status = 'running'", id).Updates(map[string]any{"status": status, "result_json": result, "duration_ms": duration, "completed_at": now})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected != 1 {
		return ErrAssistantConflict
	}
	return nil
}
func (r *Repository) AssistantAttachment(credentialID, id string) (*model.AssistantAttachment, error) {
	var row model.AssistantAttachment
	err := r.db.First(&row, "id = ? AND credential_id = ? AND expires_at > ?", id, credentialID, time.Now()).Error
	return &row, err
}
func (r *Repository) AssistantAttachmentBytes(credentialID string) (int64, error) {
	var total int64
	err := r.db.Model(&model.AssistantAttachment{}).Where("credential_id = ? AND expires_at > ?", credentialID, time.Now()).Select("COALESCE(SUM(size),0)").Scan(&total).Error
	return total, err
}
func (r *Repository) CreateAssistantAttachmentWithinLimit(row *model.AssistantAttachment, grant bool, limit int64) error {
	return r.Transaction(func(tx *Repository) error {
		// Lock the parent before summing. An UPDATE also serializes SQLite writers.
		var parent any = &model.AssistantCredential{}
		if grant {
			parent = &model.AssistantGrant{}
		}
		res := tx.db.Model(parent).Where("id = ? AND revoked_at IS NULL AND expires_at > ?", row.CredentialID, time.Now()).UpdateColumn("id", gorm.Expr("id"))
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		total, err := tx.AssistantAttachmentBytes(row.CredentialID)
		if err != nil {
			return err
		}
		if total+row.Size > limit {
			return ErrAssistantAttachmentQuota
		}
		return tx.CreateAssistantRecord(row)
	})
}
func (r *Repository) CleanupAssistantAttachments(now time.Time) error {
	return r.db.Where("expires_at <= ?", now).Delete(&model.AssistantAttachment{}).Error
}
func (r *Repository) CleanupAssistantTransient(now time.Time) error {
	if err := r.CleanupAssistantAttachments(now); err != nil {
		return err
	}
	if err := r.db.Where("expires_at < ?", now.Add(-24*time.Hour)).Delete(&model.AssistantOAuthCode{}).Error; err != nil {
		return err
	}
	return r.db.Where("grant_id <> '' AND expires_at < ?", now.Add(-24*time.Hour)).Delete(&model.AssistantCredential{}).Error
}
