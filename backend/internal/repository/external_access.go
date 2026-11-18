package repository

import (
	"errors"
	"time"

	"yingce/backend/internal/model"
)

var ErrMCPAuthorizationCodeUsed = errors.New("MCP authorization code already used")

func (r *Repository) CreateUserAPIKey(key *model.UserAPIKey) error {
	return r.db.Create(key).Error
}

func (r *Repository) UserAPIKeys(userID string) ([]model.UserAPIKey, error) {
	var keys []model.UserAPIKey
	err := r.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&keys).Error
	return keys, err
}

func (r *Repository) UserAPIKeyByHash(hash string) (*model.UserAPIKey, error) {
	var key model.UserAPIKey
	err := r.db.Where("token_hash = ? AND revoked_at IS NULL", hash).First(&key).Error
	return &key, err
}

func (r *Repository) RevokeUserAPIKey(userID, keyID string) (int64, error) {
	now := time.Now()
	result := r.db.Model(&model.UserAPIKey{}).Where("id = ? AND user_id = ? AND revoked_at IS NULL", keyID, userID).Update("revoked_at", &now)
	return result.RowsAffected, result.Error
}

func (r *Repository) TouchUserAPIKey(keyID string) {
	r.db.Model(&model.UserAPIKey{}).Where("id = ?", keyID).Update("last_used_at", time.Now())
}

func (r *Repository) TaskByExternalKey(userID, key string) (*model.Task, error) {
	var task model.Task
	err := r.db.Where("user_id = ? AND external_idempotency_key = ?", userID, key).First(&task).Error
	return &task, err
}

func (r *Repository) MCPClient(clientID string) (*model.MCPClient, error) {
	var client model.MCPClient
	err := r.db.Where("client_id = ?", clientID).First(&client).Error
	return &client, err
}

func (r *Repository) CreateMCPClient(client *model.MCPClient) error {
	return r.db.Create(client).Error
}

func (r *Repository) CreateMCPAuthorizationCode(code *model.MCPAuthorizationCode) error {
	return r.db.Create(code).Error
}

// ConsumeMCPAuthorizationCode is single-use even when two token requests race.
func (r *Repository) ConsumeMCPAuthorizationCode(hash string, now time.Time) (*model.MCPAuthorizationCode, error) {
	var code model.MCPAuthorizationCode
	if err := r.db.Where("code_hash = ? AND used_at IS NULL AND expires_at > ?", hash, now).First(&code).Error; err != nil {
		return nil, err
	}
	result := r.db.Model(&model.MCPAuthorizationCode{}).Where("id = ? AND used_at IS NULL AND expires_at > ?", code.ID, now).Update("used_at", &now)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrMCPAuthorizationCodeUsed
	}
	return &code, nil
}
