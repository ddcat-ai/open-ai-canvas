package repository

import "yingce/backend/internal/model"

func (r *Repository) ChannelModelsForRequestProtocols(ids []string) ([]model.ChannelModel, error) {
	items := []model.ChannelModel{}
	if len(ids) == 0 {
		return items, nil
	}
	err := r.db.Select("id", "channel_id", "model_key", "protocol", "protocol_release").
		Where("protocol IN ?", ids).Order("channel_id, model_key").Find(&items).Error
	return items, err
}
