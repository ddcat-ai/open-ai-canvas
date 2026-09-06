package repository

import (
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm/clause"
)

func (r *Repository) PluginPlatformState(pluginID string) (*model.PluginPlatformState, error) {
	var state model.PluginPlatformState
	result := r.db.Where("plugin_id = ?", pluginID).Limit(1).Find(&state)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	return &state, nil
}

func (r *Repository) PluginPlatformStates() ([]model.PluginPlatformState, error) {
	var states []model.PluginPlatformState
	err := r.db.Order("plugin_id asc").Find(&states).Error
	return states, err
}

func (r *Repository) SavePluginPlatformState(state *model.PluginPlatformState) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "plugin_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"available", "updated_by", "updated_at"}),
	}).Create(state).Error
}

func (r *Repository) DeletePluginPlatformState(pluginID string) error {
	return r.db.Delete(&model.PluginPlatformState{}, "plugin_id = ?", pluginID).Error
}

func (r *Repository) UserPluginState(userID string, pluginID string) (*model.UserPluginState, error) {
	var state model.UserPluginState
	result := r.db.Where("user_id = ? AND plugin_id = ?", userID, pluginID).Limit(1).Find(&state)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, nil
	}
	return &state, nil
}

func (r *Repository) UserPluginStates(userID string) ([]model.UserPluginState, error) {
	var states []model.UserPluginState
	err := r.db.Where("user_id = ?", userID).Order("plugin_id asc").Find(&states).Error
	return states, err
}

func (r *Repository) SaveUserPluginState(state *model.UserPluginState) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "plugin_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"enabled", "updated_at"}),
	}).Create(state).Error
}

func (r *Repository) DeleteUserPluginStates(pluginID string) error {
	return r.db.Delete(&model.UserPluginState{}, "plugin_id = ?", pluginID).Error
}

func (r *Repository) EnabledPluginUserCounts() (map[string]int64, error) {
	type countRow struct {
		PluginID string
		Count    int64
	}
	var rows []countRow
	if err := r.db.Model(&model.UserPluginState{}).
		Select("plugin_id, COUNT(*) AS count").
		Where("enabled = ?", true).
		Group("plugin_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	result := make(map[string]int64, len(rows))
	for _, row := range rows {
		result[row.PluginID] = row.Count
	}
	return result, nil
}
