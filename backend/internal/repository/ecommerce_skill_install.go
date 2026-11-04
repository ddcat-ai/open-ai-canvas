package repository

import "yingce/backend/internal/model"

// Prevent background updates from overwriting concurrent administrator edits.
func (r *Repository) CompareAndSwapEcommerceSkill(key, previous, next string) (bool, error) {
	result := r.db.Model(&model.SystemSetting{}).Where("key = ? AND value_json = ?", key, previous).Update("value_json", next)
	return result.RowsAffected == 1, result.Error
}
