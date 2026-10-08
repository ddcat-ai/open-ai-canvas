// 渠道模型与价格档的持久化。
//
// 修改渠道下的模型前先锁定渠道行（lockSystemChannelForModelMutation），避免并发编辑
// 产生重复价格档或遗漏名称同步。

package repository

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

type AdminRedeemCodeRow struct {
	model.RedeemCode
	RedeemedUsername    string `json:"redeemedUsername" gorm:"column:redeemed_username"`
	RedeemedDisplayName string `json:"redeemedDisplayName" gorm:"column:redeemed_display_name"`
}

func (r *Repository) ChannelModels(channelID string, includeDisabled bool) ([]model.ChannelModel, error) {
	var items []model.ChannelModel
	query := r.db.Where("channel_id = ?", channelID).Order("sort_order asc, created_at asc, id asc")
	if !includeDisabled {
		query = query.Where("enabled = ?", true)
	}
	if err := query.Find(&items).Error; err != nil {
		return nil, err
	}
	pointers := make([]*model.ChannelModel, len(items))
	for index := range items {
		pointers[index] = &items[index]
	}
	return items, r.attachChannelModelPriceTiers(pointers)
}

func (r *Repository) ChannelModelReferences(channelIDs []string) ([]model.ChannelModel, error) {
	if len(channelIDs) == 0 {
		return []model.ChannelModel{}, nil
	}
	var items []model.ChannelModel
	if err := r.db.Select("id", "channel_id", "model_key", "display_name", "sort_order", "enabled").
		Where("channel_id IN ?", channelIDs).
		Order("channel_id asc, sort_order asc, created_at asc, id asc").
		Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

func (r *Repository) CreateDuplicatedSystemChannel(channel *model.ModelChannel, channelModels []model.ChannelModel, priceTiers []model.ChannelModelPriceTier) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(channel).Error; err != nil {
			return err
		}
		if len(channelModels) > 0 {
			if err := tx.Create(&channelModels).Error; err != nil {
				return err
			}
		}
		if len(priceTiers) > 0 {
			if err := tx.Create(&priceTiers).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) ChannelModelByID(channelID string, id string) (*model.ChannelModel, error) {
	var item model.ChannelModel
	if err := r.db.First(&item, "id = ? AND channel_id = ?", id, channelID).Error; err != nil {
		return nil, err
	}
	if err := r.attachChannelModelPriceTiers([]*model.ChannelModel{&item}); err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) ChannelModelByKey(channelID string, modelKey string) (*model.ChannelModel, error) {
	var item model.ChannelModel
	if err := r.db.First(&item, "channel_id = ? AND model_key = ? AND enabled = ?", channelID, modelKey, true).Error; err != nil {
		return nil, err
	}
	if err := r.attachChannelModelPriceTiers([]*model.ChannelModel{&item}); err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) ChannelModelByKeyIncludingDisabled(channelID string, modelKey string) (*model.ChannelModel, error) {
	var item model.ChannelModel
	if err := r.db.First(&item, "channel_id = ? AND model_key = ?", channelID, modelKey).Error; err != nil {
		return nil, err
	}
	if err := r.attachChannelModelPriceTiers([]*model.ChannelModel{&item}); err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) SaveChannelModel(item *model.ChannelModel) error {
	return r.db.Save(item).Error
}

// SaveChannelModelWithPriceTiers 原子保存系统模型与其活动价格档。移除价格档采用软删除，
// 让已结算订单的 PriceTierID 仍能回溯到原始配置版本。
func (r *Repository) SaveChannelModelWithPriceTiers(item *model.ChannelModel, tiers []model.ChannelModelPriceTier) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing []model.ChannelModelPriceTier
		if err := tx.Where("channel_model_id = ?", item.ID).Find(&existing).Error; err != nil {
			return err
		}
		existingByKey := make(map[string]model.ChannelModelPriceTier, len(existing))
		for _, tier := range existing {
			existingByKey[channelModelPriceTierKey(tier)] = tier
		}
		selected := make(map[string]bool, len(tiers))
		for index := range tiers {
			tier := &tiers[index]
			tier.ChannelModelID = item.ID
			key := channelModelPriceTierKey(*tier)
			if existingTier, exists := existingByKey[key]; exists {
				tier.ID = existingTier.ID
				tier.PriceVersion = existingTier.PriceVersion + 1
				if err := tx.Save(tier).Error; err != nil {
					return err
				}
			} else if err := tx.Create(tier).Error; err != nil {
				return err
			}
			selected[tier.ID] = true
		}
		for _, tier := range existing {
			if selected[tier.ID] {
				continue
			}
			if err := tx.Delete(&tier).Error; err != nil {
				return err
			}
		}
		if err := tx.Save(item).Error; err != nil {
			return err
		}
		return nil
	})
}

func channelModelPriceTierKey(tier model.ChannelModelPriceTier) string {
	if strings.TrimSpace(tier.SelectorKey) != "" {
		return tier.SelectorKey
	}
	_, key, err := model.CanonicalSKUSelector(map[string]string{
		"vquality":     strings.TrimSpace(tier.Resolution),
		"videoSeconds": strconv.Itoa(tier.VideoSeconds),
	})
	if err != nil {
		return "{}"
	}
	return key
}

func (r *Repository) attachChannelModelPriceTiers(items []*model.ChannelModel) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	var tiers []model.ChannelModelPriceTier
	if r.db.Migrator().HasTable(&model.ChannelModelPriceTier{}) {
		if err := r.db.Where("channel_model_id IN ?", ids).Order("selector_key asc, created_at asc").Find(&tiers).Error; err != nil {
			return err
		}
	}
	for index := range tiers {
		tiers[index].Selector = model.DecodeSKUSelector(tiers[index].SelectorJSON)
	}
	tiersByModelID := make(map[string][]model.ChannelModelPriceTier, len(items))
	for _, tier := range tiers {
		tiersByModelID[tier.ChannelModelID] = append(tiersByModelID[tier.ChannelModelID], tier)
	}
	for _, item := range items {
		item.PriceTiers = tiersByModelID[item.ID]
		// 兼容尚未执行价格档回填的旧数据库；正式迁移会将同一数据持久化为默认档。
		if len(item.PriceTiers) == 0 && item.PriceConfigured {
			item.PriceTiers = []model.ChannelModelPriceTier{{
				ChannelModelID: item.ID, SelectorKey: "{}", SelectorJSON: "{}", Resolution: "*",
				ProviderModelKey: item.ProviderModelKey, BillingMode: item.BillingMode,
				UnitPriceMicrocredits: item.UnitPriceMicrocredits, InputTokenPriceMicrocredits: item.InputTokenPriceMicrocredits,
				OutputTokenPriceMicrocredits: item.OutputTokenPriceMicrocredits, CachedTokenPriceMicrocredits: item.CachedTokenPriceMicrocredits,
				PriceConfigured: item.PriceConfigured, Enabled: item.Enabled, PriceVersion: item.PriceVersion,
			}}
		}
	}
	return nil
}

// PopulateChannelModelPriceTiers 将价格档附着到已经查询出的渠道模型，供路由关系图批量加载使用。
func (r *Repository) PopulateChannelModelPriceTiers(items []model.ChannelModel) error {
	pointers := make([]*model.ChannelModel, len(items))
	for index := range items {
		pointers[index] = &items[index]
	}
	return r.attachChannelModelPriceTiers(pointers)
}

func (r *Repository) PopulateChannelModelPriceTier(item *model.ChannelModel) error {
	if item == nil {
		return nil
	}
	return r.attachChannelModelPriceTiers([]*model.ChannelModel{item})
}

func (r *Repository) DeleteChannelModel(channelID string, id string, now time.Time) error {
	deleted, err := r.DeleteChannelModels(channelID, []string{id}, now)
	if err != nil {
		return err
	}
	if deleted != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// DeleteChannelModels atomically removes a selection and refreshes the channel's
// compatibility model list. Any active route or task reference aborts the whole
// transaction so a bulk action cannot leave the administrator with a partial result.
func (r *Repository) DeleteChannelModels(channelID string, ids []string, now time.Time) (int64, error) {
	ids = uniqueStrings(ids)
	if len(ids) == 0 {
		return 0, gorm.ErrRecordNotFound
	}
	var deleted int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := r.lockSystemChannelForModelMutation(tx, channelID); err != nil {
			return err
		}
		var existing int64
		if err := tx.Model(&model.ChannelModel{}).
			Where("channel_id = ? AND id IN ?", channelID, ids).
			Count(&existing).Error; err != nil {
			return err
		}
		if existing != int64(len(ids)) {
			return gorm.ErrRecordNotFound
		}
		var activeReferences int64
		if err := tx.Table("logical_model_routes AS route").
			Joins("JOIN logical_models AS logical_model ON logical_model.active_revision_id = route.logical_model_revision_id").
			Where("route.channel_model_id IN ?", ids).
			Count(&activeReferences).Error; err != nil {
			return err
		}
		if activeReferences > 0 {
			return ErrChannelModelInUse
		}
		if err := tx.Model(&model.Task{}).
			Where("channel_model_id IN ? AND status IN ?", ids, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).
			Count(&activeReferences).Error; err != nil {
			return err
		}
		if activeReferences > 0 {
			return ErrChannelModelInUse
		}
		result := tx.Model(&model.ChannelModel{}).
			Where("id IN ? AND channel_id = ?", ids, channelID).
			Updates(map[string]any{"enabled": false, "price_version": gorm.Expr("price_version + 1"), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != int64(len(ids)) {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Where("id IN ? AND channel_id = ?", ids, channelID).Delete(&model.ChannelModel{}).Error; err != nil {
			return err
		}
		if err := refreshChannelModelNames(tx, channelID, now); err != nil {
			return err
		}
		deleted = result.RowsAffected
		return nil
	})
	return deleted, err
}

// SyncChannelModelNames serializes compatibility-list refreshes for a system
// channel and derives the list from the committed channel_models rows. Callers
// must not pass a previously-read snapshot because concurrent administrator
// writes could otherwise overwrite a newer catalog.
func (r *Repository) SyncChannelModelNames(channelID string, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := r.lockSystemChannelForModelMutation(tx, channelID); err != nil {
			return err
		}
		return refreshChannelModelNames(tx, channelID, now)
	})
}

func (r *Repository) lockSystemChannelForModelMutation(tx *gorm.DB, channelID string) error {
	query := tx.Select("id").Where("id = ? AND scope = ?", channelID, model.ChannelScopeSystem)
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var channel model.ModelChannel
	return query.First(&channel).Error
}

func refreshChannelModelNames(tx *gorm.DB, channelID string, now time.Time) error {
	var names []string
	if err := tx.Model(&model.ChannelModel{}).
		Where("channel_id = ? AND enabled = ?", channelID, true).
		Order("sort_order asc, created_at asc, id asc").
		Pluck("model_key", &names).Error; err != nil {
		return err
	}
	encoded, err := json.Marshal(names)
	if err != nil {
		return err
	}
	return tx.Model(&model.ModelChannel{}).
		Where("id = ? AND scope = ?", channelID, model.ChannelScopeSystem).
		Updates(map[string]any{"models_json": string(encoded), "updated_at": now}).Error
}

func (r *Repository) CreateMissingChannelModels(items []model.ChannelModel) (int64, error) {
	if len(items) == 0 {
		return 0, nil
	}
	// 拉取目录可能与其他管理员操作并发，唯一键冲突时保留已有定价配置。
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&items)
	return result.RowsAffected, result.Error
}
