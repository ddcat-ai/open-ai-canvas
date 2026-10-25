package repository

import (
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrUserGroupRatesChanged = errors.New("用户优惠已发生变化，请刷新后重试")

func (r *Repository) UserGroupRates(userID string) (*model.UserGroupRates, error) {
	var row model.UserGroupRates
	err := r.db.First(&row, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return &model.UserGroupRates{UserID: userID, RatesJSON: "{}"}, nil
	}
	return &row, err
}

func (r *Repository) SaveUserGroupRates(row *model.UserGroupRates, expected int64, audit *model.AdminAuditEvent) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var result *gorm.DB
		if expected == 0 {
			result = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(row)
		} else {
			result = tx.Model(&model.UserGroupRates{}).Where("user_id = ? AND version = ?", row.UserID, expected).Updates(map[string]any{"rates_json": row.RatesJSON, "version": row.Version})
		}
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrUserGroupRatesChanged
		}
		return tx.Create(audit).Error
	})
}
