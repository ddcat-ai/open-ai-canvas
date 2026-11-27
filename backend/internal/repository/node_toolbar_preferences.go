package repository

import (
	"yingce/backend/internal/model"

	"gorm.io/gorm/clause"
)

func (r *Repository) UserNodeToolbarPreferences(userID string) ([]model.UserNodeToolbarPreference, error) {
	var preferences []model.UserNodeToolbarPreference
	err := r.db.Where("user_id = ?", userID).Order("node_type").Find(&preferences).Error
	return preferences, err
}

func (r *Repository) SaveUserNodeToolbarPreference(preference *model.UserNodeToolbarPreference) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "node_type"}},
		DoUpdates: clause.AssignmentColumns([]string{"pinned_entry_ids_json", "updated_at"}),
	}).Create(preference).Error
}

func (r *Repository) DeleteUserNodeToolbarPreference(userID, nodeType string) error {
	return r.db.Where("user_id = ? AND node_type = ?", userID, nodeType).Delete(&model.UserNodeToolbarPreference{}).Error
}
