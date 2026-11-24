package repository

import (
	"time"

	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

// ChannelModelsForBatchUpdate is called after the ordered website/channel locks.
func (r *Repository) ChannelModelsForBatchUpdate(ids []string) ([]model.ChannelModel, error) {
	var items []model.ChannelModel
	if err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", ids).Order("id").Find(&items).Error; err != nil {
		return nil, err
	}
	var tiers []model.ChannelModelPriceTier
	if err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).Where("channel_model_id IN ?", ids).Order("channel_model_id, selector_key, id").Find(&tiers).Error; err != nil {
		return nil, err
	}
	for i := range items {
		for _, tier := range tiers {
			if tier.ChannelModelID == items[i].ID {
				tier.Selector = model.DecodeSKUSelector(tier.SelectorJSON)
				items[i].PriceTiers = append(items[i].PriceTiers, tier)
			}
		}
	}
	return items, nil
}

// UpdateChannelModelBatch writes a sparse model update. Metadata and availability
// edits never serialize the other pricing fields back through a form request.
func (r *Repository) UpdateChannelModelBatch(before, after *model.ChannelModel, fields map[string]any, replaceTiers, availability bool) error {
	now := nextChannelEditVersion(r.db.NowFunc(), before.UpdatedAt)
	fields["updated_at"] = now
	result := r.db.Model(&model.ChannelModel{}).Where("id = ? AND channel_id = ? AND price_version = ? AND capability_version = ? AND updated_at = ?",
		before.ID, before.ChannelID, before.PriceVersion, before.CapabilityVersion, before.UpdatedAt).Updates(fields)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrChannelModelPriceConflict
	}
	after.UpdatedAt = now
	if replaceTiers {
		return r.replaceChannelModelPriceTiers(after.ID, before.PriceTiers, after.PriceTiers, now)
	}
	if availability {
		for _, tier := range after.PriceTiers {
			result := r.db.Model(&model.ChannelModelPriceTier{}).
				Where("id = ? AND channel_model_id = ? AND price_version = ? AND updated_at = ?", tier.ID, before.ID, tier.PriceVersion, tier.UpdatedAt).
				Updates(map[string]any{"enabled": tier.Enabled, "price_configured": tier.PriceConfigured, "price_version": tier.PriceVersion + 1, "updated_at": now})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return ErrChannelModelPriceConflict
			}
		}
	}
	return nil
}

func (r *Repository) replaceChannelModelPriceTiers(modelID string, existing, tiers []model.ChannelModelPriceTier, now time.Time) error {
	byKey := make(map[string]model.ChannelModelPriceTier, len(existing))
	for _, tier := range existing {
		byKey[channelModelPriceTierKey(tier)] = tier
	}
	selected := make(map[string]bool, len(tiers))
	for i := range tiers {
		tier := &tiers[i]
		tier.ChannelModelID = modelID
		tier.UpdatedAt = now
		if previous, ok := byKey[channelModelPriceTierKey(*tier)]; ok {
			tier.ID, tier.CreatedAt, tier.PriceVersion = previous.ID, previous.CreatedAt, previous.PriceVersion+1
			if err := r.db.Save(tier).Error; err != nil {
				return err
			}
		} else if err := r.db.Create(tier).Error; err != nil {
			return err
		}
		selected[tier.ID] = true
	}
	for _, tier := range existing {
		if !selected[tier.ID] {
			if err := r.db.Delete(&tier).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
