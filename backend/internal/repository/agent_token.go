package repository

import (
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// Agent Token 仓储层。
//
// 所有权约束一律下推到 SQL 的 WHERE 条件里（user_id = ?），
// 不做"先查后判"，避免并发下的 TOCTOU 与"改到别人令牌"的事故。

func (r *Repository) CreateAgentToken(token *model.AgentToken) error {
	return r.db.Create(token).Error
}

func (r *Repository) AgentTokensByUser(userID string) ([]model.AgentToken, error) {
	var tokens []model.AgentToken
	if err := r.db.Where("user_id = ?", userID).Order("created_at desc").Find(&tokens).Error; err != nil {
		return nil, err
	}
	return tokens, nil
}

func (r *Repository) AgentTokenByID(id string) (*model.AgentToken, error) {
	var token model.AgentToken
	if err := r.db.Where("id = ?", id).First(&token).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &token, nil
}

// AgentTokenByHash 按 hash(token) 精确查找——明文永远不参与查询。
func (r *Repository) AgentTokenByHash(hash string) (*model.AgentToken, error) {
	var token model.AgentToken
	if err := r.db.Where("token_hash = ?", hash).First(&token).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &token, nil
}

// RevokeAgentToken 只吊销"属于该用户且尚未吊销"的令牌；影响 0 行视为不存在。
func (r *Repository) RevokeAgentToken(id string, userID string, revokedAt time.Time) (bool, error) {
	result := r.db.Model(&model.AgentToken{}).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", id, userID).
		Update("revoked_at", revokedAt)
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

func (r *Repository) MarkAgentTokenUsed(id string, usedAt time.Time) error {
	return r.db.Model(&model.AgentToken{}).Where("id = ?", id).Update("last_used_at", usedAt).Error
}

// AgentTokenUserByID 全字段取归属用户。
// 刻意不用 UsersByIDs（它只 Select id/username/display_name，Status 为空值，
// 会把"active 用户"误判成非 active —— 本次踩坑实测修正）。
func (r *Repository) AgentTokenUserByID(id string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("id = ?", id).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &user, nil
}
