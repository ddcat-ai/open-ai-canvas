package repository

import (
	"time"
	"yingce/backend/internal/model"
)

func (r *Repository) APIKeysForUser(userID string) ([]model.APIKey, error) {
	keys := make([]model.APIKey, 0)
	err := r.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&keys).Error
	return keys, err
}

func (r *Repository) APIKeyByHash(hash string) (*model.APIKey, error) {
	var key model.APIKey
	err := r.db.Where("token_hash = ?", hash).First(&key).Error
	return &key, err
}

func (r *Repository) APIKeyForUser(userID, id string) (*model.APIKey, error) {
	var key model.APIKey
	err := r.db.Where("user_id = ? AND id = ?", userID, id).First(&key).Error
	return &key, err
}

func (r *Repository) RevokeAPIKey(userID, id string, now time.Time) error {
	return r.db.Model(&model.APIKey{}).Where("user_id = ? AND id = ? AND revoked_at IS NULL", userID, id).Update("revoked_at", now).Error
}
