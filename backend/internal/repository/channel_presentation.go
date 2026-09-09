package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) UpdateSystemChannelPresentation(channelID string, alias *string, sortOrder *int, now time.Time) error {
	updates := map[string]any{"updated_at": now}
	if alias != nil {
		updates["public_alias"] = *alias
	}
	if sortOrder != nil {
		updates["sort_order"] = *sortOrder
	}
	result := r.db.Model(&model.ModelChannel{}).Where("id = ? AND scope = ?", channelID, model.ChannelScopeSystem).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// 排序是展示配置，不重写价格、能力版本或模型标识。
func (r *Repository) UpdateChannelModelSort(channelID, modelID string, sortOrder int, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := r.lockSystemChannelForModelMutation(tx, channelID); err != nil {
			return err
		}
		result := tx.Model(&model.ChannelModel{}).Where("channel_id = ? AND id = ?", channelID, modelID).
			Updates(map[string]any{"sort_order": sortOrder, "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return refreshChannelModelNames(tx, channelID, now)
	})
}
