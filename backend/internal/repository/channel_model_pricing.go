package repository

import (
	"errors"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

var ErrChannelModelPriceConflict = errors.New("channel model prices changed concurrently")

// UpdateChannelModelSalePrices commits the entire selection or nothing. Only
// pricing columns are written; version checks protect the cost snapshot used by app.
func (r *Repository) UpdateChannelModelSalePrices(channelID string, items []model.ChannelModel) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, item := range items {
			result := tx.Model(&model.ChannelModel{}).
				Where("id = ? AND channel_id = ? AND price_version = ? AND updated_at = ?", item.ID, channelID, item.PriceVersion, item.UpdatedAt).
				Updates(map[string]any{
					"unit_price_microcredits":         item.UnitPriceMicrocredits,
					"input_token_price_microcredits":  item.InputTokenPriceMicrocredits,
					"output_token_price_microcredits": item.OutputTokenPriceMicrocredits,
					"cached_token_price_microcredits": item.CachedTokenPriceMicrocredits,
					"price_version":                   item.PriceVersion + 1,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrChannelModelPriceConflict
			}
			for _, tier := range item.PriceTiers {
				if !tier.Enabled {
					continue
				}
				result = tx.Model(&model.ChannelModelPriceTier{}).
					Where("id = ? AND channel_model_id = ? AND price_version = ? AND updated_at = ?", tier.ID, item.ID, tier.PriceVersion, tier.UpdatedAt).
					Updates(map[string]any{
						"unit_price_microcredits":         tier.UnitPriceMicrocredits,
						"input_token_price_microcredits":  tier.InputTokenPriceMicrocredits,
						"output_token_price_microcredits": tier.OutputTokenPriceMicrocredits,
						"cached_token_price_microcredits": tier.CachedTokenPriceMicrocredits,
						"price_version":                   tier.PriceVersion + 1,
					})
				if result.Error != nil {
					return result.Error
				}
				if result.RowsAffected != 1 {
					return ErrChannelModelPriceConflict
				}
			}
		}
		return nil
	})
}
