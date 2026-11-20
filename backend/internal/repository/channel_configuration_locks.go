package repository

import (
	"slices"
	"strings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

// LockSystemChannelConfiguration serializes configuration writes. Call inside a
// transaction, after any website lock. SQLite needs a write before reading.
func (r *Repository) LockSystemChannelConfiguration(channelIDs []string) error {
	ids := slices.Clone(channelIDs)
	slices.Sort(ids)
	ids = slices.Compact(ids)
	for _, id := range ids {
		if strings.TrimSpace(id) == "" {
			return gorm.ErrRecordNotFound
		}
		query := r.db.Model(&model.ModelChannel{}).Where("id = ? AND scope = ?", id, model.ChannelScopeSystem)
		if r.Dialect() == "sqlite" {
			result := query.UpdateColumn("id", gorm.Expr("id"))
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		} else {
			var row model.ModelChannel
			if err := query.Select("id").Clauses(clause.Locking{Strength: "UPDATE"}).First(&row).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *Repository) lockChannelConfigurationActor(userID string) (*model.User, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	query := r.db.Model(&model.User{}).Where("id = ?", userID)
	if r.Dialect() == "sqlite" {
		result := query.UpdateColumn("id", gorm.Expr("id"))
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected != 1 {
			return nil, gorm.ErrRecordNotFound
		}
	}
	var user model.User
	if err := query.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}
