package repository

import (
	"errors"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

var ErrChannelModelPriceConflict = errors.New("模型价格已变化，请刷新后重试")

// UpdateChannelModelSalePrices commits the entire selection or nothing. Only
// pricing columns are written; version checks protect the cost snapshot used by app.
func (r *Repository) UpdateChannelModelSalePrices(items []model.ChannelModel) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, item := range items {
			result := tx.Model(&model.ChannelModel{}).
				Where("id = ? AND channel_id = ? AND price_version = ? AND updated_at = ?", item.ID, item.ChannelID, item.PriceVersion, item.UpdatedAt).
				Updates(map[string]any{
					"unit_price_microcredits":              item.UnitPriceMicrocredits,
					"input_token_price_microcredits":       item.InputTokenPriceMicrocredits,
					"output_token_price_microcredits":      item.OutputTokenPriceMicrocredits,
					"cached_token_price_microcredits":      item.CachedTokenPriceMicrocredits,
					"cache_write_token_price_microcredits": item.CacheWriteTokenPriceMicrocredits,
					"price_version":                        item.PriceVersion + 1,
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
						"unit_price_microcredits":              tier.UnitPriceMicrocredits,
						"input_token_price_microcredits":       tier.InputTokenPriceMicrocredits,
						"output_token_price_microcredits":      tier.OutputTokenPriceMicrocredits,
						"cached_token_price_microcredits":      tier.CachedTokenPriceMicrocredits,
						"cache_write_token_price_microcredits": tier.CacheWriteTokenPriceMicrocredits,
						"price_version":                        tier.PriceVersion + 1,
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

// UpdateChannelModelProtocols 整批写入协议与重新规范化后的能力配置；updated_at 用作乐观锁，
// 防止覆盖并发编辑。价格档不在这里改写。
func (r *Repository) UpdateChannelModelProtocols(items []model.ChannelModel) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, item := range items {
			result := tx.Model(&model.ChannelModel{}).
				Where("id = ? AND channel_id = ? AND updated_at = ?", item.ID, item.ChannelID, item.UpdatedAt).
				Updates(map[string]any{
					"protocol":               item.Protocol,
					"capability_config_json": item.CapabilityConfigJSON,
					"capability_version":     item.CapabilityVersion,
				})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrChannelModelPriceConflict
			}
		}
		return nil
	})
}
