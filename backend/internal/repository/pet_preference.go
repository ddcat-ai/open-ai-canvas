package repository

import (
	"errors"
	"gorm.io/gorm/clause"
	"time"
	"yingce/backend/internal/model"
)

var ErrPetPreferenceConflict = errors.New("pet preference changed")

func (r *Repository) SavePetPreferenceSetting(key, userID, before, after string) error {
	if before == "" {
		result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.SystemSetting{Key: key, ValueJSON: after, UpdatedBy: userID})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrPetPreferenceConflict
		}
		return nil
	}
	result := r.db.Model(&model.SystemSetting{}).Where("key = ? AND value_json = ?", key, before).Updates(map[string]any{"value_json": after, "updated_by": userID, "updated_at": time.Now().UTC()})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrPetPreferenceConflict
	}
	return nil
}
