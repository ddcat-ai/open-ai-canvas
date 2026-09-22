package repository

import (
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) CreatePublicAPIKey(key *model.PublicAPIKey) error {
	return r.db.Create(key).Error
}

func (r *Repository) PublicAPIKeys(userID string) ([]model.PublicAPIKey, error) {
	var keys []model.PublicAPIKey
	err := r.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&keys).Error
	return keys, err
}

func (r *Repository) PublicAPIKeyForUser(userID, id string) (*model.PublicAPIKey, error) {
	var key model.PublicAPIKey
	if err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&key).Error; err != nil {
		return nil, err
	}
	return &key, nil
}

func (r *Repository) PublicAPIKeyByHash(hash string) (*model.PublicAPIKey, error) {
	var key model.PublicAPIKey
	if err := r.db.Where("hash = ?", hash).First(&key).Error; err != nil {
		return nil, err
	}
	return &key, nil
}

func (r *Repository) RevokePublicAPIKey(userID, id string, now time.Time) (bool, error) {
	result := r.db.Model(&model.PublicAPIKey{}).
		Where("id = ? AND user_id = ? AND status = ?", id, userID, model.PublicAPIKeyStatusActive).
		Updates(map[string]any{"status": model.PublicAPIKeyStatusRevoked, "revoked_at": now, "updated_at": now})
	return result.RowsAffected > 0, result.Error
}

func (r *Repository) TouchPublicAPIKey(id string, now time.Time) error {
	return r.db.Model(&model.PublicAPIKey{}).Where("id = ?", id).Updates(map[string]any{"last_used_at": now, "updated_at": now}).Error
}

func (r *Repository) PublicGenerationRequestByIdempotency(apiKeyID, endpoint, hash string) (*model.PublicGenerationRequest, error) {
	var item model.PublicGenerationRequest
	err := r.db.Where("api_key_id = ? AND endpoint = ? AND idempotency_hash = ?", apiKeyID, endpoint, hash).First(&item).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) PublicGenerationRequestByTask(apiKeyID, userID, taskID string) (*model.PublicGenerationRequest, error) {
	var item model.PublicGenerationRequest
	if err := r.db.Where("api_key_id = ? AND user_id = ? AND task_id = ?", apiKeyID, userID, taskID).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) CreatePublicGenerationRequest(item *model.PublicGenerationRequest) error {
	return r.db.Create(item).Error
}

func (r *Repository) TaskByCreationSubmission(userID, submissionID string) (*model.Task, error) {
	var task model.Task
	if err := r.db.Where("user_id = ? AND creation_submission_id = ?", userID, submissionID).First(&task).Error; err != nil {
		return nil, err
	}
	return &task, nil
}
