package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func (s *Service) BatchUpdateAdminChannelModels(actor *model.User, channelID string, requests []BatchChannelModelUpdate) (int, error) {
	if strings.TrimSpace(channelID) == "" {
		return 0, BadAuthRequest("请选择系统渠道")
	}
	return s.batchUpdateAdminChannelModels(actor, channelID, requests)
}

func (s *Service) BatchUpdateAdminAllChannelModels(actor *model.User, requests []BatchChannelModelUpdate) (int, error) {
	return s.batchUpdateAdminChannelModels(actor, "", requests)
}

func (s *Service) batchUpdateAdminChannelModels(actor *model.User, channelID string, requests []BatchChannelModelUpdate) (int, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return 0, err
	}
	if len(requests) == 0 || len(requests) > 100 {
		return 0, BadAuthRequest("单次请选择 1 到 100 个渠道模型")
	}
	byID := make(map[string]BatchChannelModelUpdate, len(requests))
	ids := make([]string, 0, len(requests))
	for _, req := range requests {
		if req.ModelID == "" || strings.TrimSpace(req.ModelID) != req.ModelID || req.PriceVersion < 0 || req.CapabilityVersion < 0 {
			return 0, BadAuthRequest("模型标识或版本无效")
		}
		if _, exists := byID[req.ModelID]; exists {
			return 0, BadAuthRequest("不能重复选择同一个模型")
		}
		if len(req.Changes.fields()) == 0 {
			return 0, BadAuthRequest("请选择需要批量修改的项目")
		}
		if stamp, err := time.Parse(time.RFC3339Nano, req.UpdatedAt); err != nil || stamp.IsZero() {
			return 0, BadAuthRequest("模型更新时间无效，请刷新后重试")
		}
		byID[req.ModelID] = req
		ids = append(ids, req.ModelID)
	}
	sort.Strings(ids)
	// Discover only the lock targets outside the transaction, then recheck all
	// ownership and versions after taking the existing task-admission locks.
	refs, err := s.repo.ChannelModelsByIDs(ids)
	if err != nil {
		return 0, err
	}
	if len(refs) != len(ids) {
		return 0, BadAuthRequest("所选模型已删除，请刷新后重试")
	}
	channelSet := map[string]bool{}
	modelChannels := map[string]string{}
	for _, item := range refs {
		if channelID != "" && item.ChannelID != channelID {
			return 0, BadAuthRequest("所选模型不属于当前 Key 分组")
		}
		channelSet[item.ChannelID], modelChannels[item.ID] = true, item.ChannelID
	}
	channelIDs := sortedKeys(channelSet)
	channels, err := s.repo.SystemChannelsByIDs(channelIDs, true)
	if err != nil {
		return 0, err
	}
	if len(channels) != len(channelIDs) {
		return 0, BadAuthRequest("只能批量修改系统渠道模型")
	}
	err = s.repo.Transaction(func(repo *repository.Repository) error {
		if err := repo.LockChannelConfiguration(actor.ID, channelIDs); err != nil {
			return err
		}
		currentActor, err := repo.User(actor.ID)
		if err != nil {
			return err
		}
		if err := s.RequireAdmin(currentActor); err != nil {
			return err
		}
		if currentActor.Status != model.UserStatusActive {
			return Forbidden("管理员账号已停用")
		}
		currentChannels := make(map[string]*model.ModelChannel, len(channelIDs))
		for _, id := range channelIDs {
			currentChannels[id], err = repo.AdminSystemChannel(id)
			if err != nil {
				return err
			}
		}
		items, err := repo.ChannelModelsForBatchUpdate(ids)
		if err != nil {
			return err
		}
		if len(items) != len(ids) {
			return repository.ErrChannelModelPriceConflict
		}
		prepared := make([]batchModelUpdate, 0, len(items))
		for i := range items {
			item := &items[i]
			req := byID[item.ID]
			expected, _ := time.Parse(time.RFC3339Nano, req.UpdatedAt)
			if modelChannels[item.ID] != item.ChannelID || currentChannels[item.ChannelID] == nil || item.PriceVersion != req.PriceVersion || item.CapabilityVersion != req.CapabilityVersion || !item.UpdatedAt.Equal(expected) {
				return BadAuthRequest("模型 " + item.ModelKey + " 已被其他操作修改，请刷新后重试；本次未修改任何模型")
			}
			update, err := s.prepareBatchModelUpdate(repo, currentChannels[item.ChannelID], *item, req.Changes)
			if err != nil {
				return BadAuthRequest("模型 " + item.ModelKey + "：" + err.Error() + "；本次未修改任何模型")
			}
			prepared = append(prepared, update)
		}
		for _, update := range prepared {
			if err := repo.UpdateChannelModelBatch(&update.before, &update.after, update.columns, update.replaceTiers, update.changes.PricingEnabled != nil); err != nil {
				return err
			}
			if update.before.Protocol != update.after.Protocol || update.before.Capability != update.after.Capability {
				if err := repo.RecordChannelProtocolSelection(currentChannels[update.after.ChannelID].WebsiteID, actor.ID, &update.after); err != nil {
					return err
				}
			}
		}
		for _, id := range channelIDs {
			if err := repo.SyncChannelModelNames(id, time.Now()); err != nil {
				return err
			}
			changes := make([]map[string]any, 0)
			for _, update := range prepared {
				if update.after.ChannelID == id {
					changes = append(changes, map[string]any{"modelId": update.after.ID, "fields": update.changes.fields()})
				}
			}
			event, err := newAdminAuditEvent(actor, "channel_model.batch_update", "model_channel", id, "批量修改渠道模型", map[string]any{"models": changes})
			if err != nil {
				return err
			}
			if err := repo.AppendAdminAudit(event); err != nil {
				return err
			}
		}
		return nil
	})
	if errors.Is(err, repository.ErrChannelModelPriceConflict) || errors.Is(err, repository.ErrTaskStateConflict) || errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, BadAuthRequest("模型或渠道配置已变化，请刷新后重试；本次未修改任何模型")
	}
	if err != nil {
		return 0, err
	}
	s.invalidateRouteCatalog()
	return len(requests), nil
}

type batchModelUpdate struct {
	before, after model.ChannelModel
	changes       BatchChannelModelChanges
	columns       map[string]any
	replaceTiers  bool
}

func (c BatchChannelModelChanges) fields() []string {
	result := []string{}
	for _, field := range []struct {
		name string
		set  bool
	}{{"capability", c.Capability != nil}, {"protocol", c.Protocol != nil}, {"displayName", c.DisplayName != nil}, {"description", c.Description != nil}, {"enabled", c.Enabled != nil}, {"pricingEnabled", c.PricingEnabled != nil}, {"capabilityTemplate", c.CapabilityTemplate != nil}, {"pricingTemplate", c.PricingTemplate != nil}} {
		if field.set {
			result = append(result, field.name)
		}
	}
	return result
}

func (s *Service) prepareBatchModelUpdate(repo *repository.Repository, channel *model.ModelChannel, before model.ChannelModel, changes BatchChannelModelChanges) (batchModelUpdate, error) {
	after := before
	after.PriceTiers = append([]model.ChannelModelPriceTier(nil), before.PriceTiers...)
	columns := map[string]any{}
	replaceTiers := changes.PricingTemplate != nil
	if changes.DisplayName != nil {
		after.DisplayName = strings.TrimSpace(*changes.DisplayName)
		if after.DisplayName == "" {
			after.DisplayName = "未分类"
		}
		if len([]rune(after.DisplayName)) > 160 {
			return batchModelUpdate{}, BadAuthRequest("模型展示名不能超过 160 字")
		}
		columns["display_name"] = after.DisplayName
	}
	if changes.Description != nil {
		after.Description = strings.TrimSpace(*changes.Description)
		if len([]rune(after.Description)) > 500 {
			return batchModelUpdate{}, BadAuthRequest("备注不能超过 500 字")
		}
		columns["description"] = after.Description
	}
	if changes.Enabled != nil {
		after.Enabled = *changes.Enabled
		columns["enabled"] = after.Enabled
	}
	// Metadata and deactivation must remain usable even when an imported model
	// has no calling contract, or its old protocol/configuration is unavailable.
	if !changes.requiresModelContract() {
		if changes.PricingEnabled != nil {
			if len(after.PriceTiers) == 0 && before.PriceConfigured {
				// Keep explicit legacy prices in a disabled tier before clearing
				// the model's availability summary. Deactivation must also work
				// with an obsolete calling contract or invalid old amounts.
				tier := batchLegacyPriceTier(before)
				id, err := repo.NextPrefixedID("PTIER")
				if err != nil {
					return batchModelUpdate{}, err
				}
				tier.ID, tier.PriceVersion = id, 1
				tier.SelectorKey, tier.SelectorJSON = "{}", "{}"
				tier.ProviderModelKey = firstNonEmpty(before.ProviderModelKey, before.ModelKey)
				after.PriceTiers = []model.ChannelModelPriceTier{tier}
				replaceTiers = true
			}
			for i := range after.PriceTiers {
				after.PriceTiers[i].Enabled = false
			}
			after.PriceConfigured = false
			after.PriceVersion++
			columns["price_configured"], columns["price_version"] = false, after.PriceVersion
		}
		return batchModelUpdate{before: before, after: after, changes: changes, columns: columns, replaceTiers: replaceTiers}, nil
	}
	config, upstream, err := s.prepareBatchModelContract(channel, before, &after, changes, columns)
	if err != nil {
		return batchModelUpdate{}, err
	}
	capability, protocol := after.Capability, after.Protocol
	if template := changes.PricingTemplate; template != nil {
		if err := validateBatchPricingTemplate(template, after, upstream); err != nil {
			return batchModelUpdate{}, err
		}
		after.PriceCurrency, err = normalizePriceCurrency(template.PriceCurrency)
		if err != nil {
			return batchModelUpdate{}, err
		}
		after.ReferenceVideoBilling = template.ReferenceVideoBilling
		after.PriceTiers, err = normalizeChannelModelPriceTiersWithIDs(ChannelModelRequest{CapabilityConfig: config, PriceTiers: template.PriceTiers}, capability, protocol, upstream, repo.NextPrefixedID)
		if err != nil {
			return batchModelUpdate{}, err
		}
		columns["price_currency"], columns["reference_video_billing"] = after.PriceCurrency, after.ReferenceVideoBilling
	}
	if changes.PricingEnabled != nil {
		if len(after.PriceTiers) == 0 {
			// Legacy rows have only scalar prices. Materialize one default tier
			// inside this transaction, without treating model enabled as pricing.
			after.PriceTiers, err = normalizeChannelModelPriceTiersWithIDs(ChannelModelRequest{PriceTiers: []ChannelModelPriceTierRequest{batchTierRequest(batchLegacyPriceTier(before))}}, capability, protocol, upstream, repo.NextPrefixedID)
			if err != nil {
				return batchModelUpdate{}, err
			}
			replaceTiers = true
		}
		for i := range after.PriceTiers {
			tier := &after.PriceTiers[i]
			if *changes.PricingEnabled && !batchTierAmountsComplete(after, *tier) {
				return batchModelUpdate{}, BadAuthRequest(fmt.Sprintf("价格档 %d 金额尚未配置完整，不能开启可供用户使用", i+1))
			}
			tier.Enabled = *changes.PricingEnabled
			if tier.Enabled {
				tier.PriceConfigured = true
			}
		}
	}
	if err := validateBatchFinalPrices(after, config); err != nil {
		return batchModelUpdate{}, err
	}
	if changes.PricingTemplate != nil || changes.PricingEnabled != nil {
		s.applyChannelModelPriceTierSummary(&after, after.PriceTiers)
		after.PriceVersion++
		columns["price_version"], columns["billing_mode"], columns["price_configured"] = after.PriceVersion, after.BillingMode, after.PriceConfigured
		columns["unit_price_microcredits"], columns["input_token_price_microcredits"] = after.UnitPriceMicrocredits, after.InputTokenPriceMicrocredits
		columns["output_token_price_microcredits"], columns["cached_token_price_microcredits"], columns["cache_write_token_price_microcredits"] = after.OutputTokenPriceMicrocredits, after.CachedTokenPriceMicrocredits, after.CacheWriteTokenPriceMicrocredits
	}
	return batchModelUpdate{before: before, after: after, changes: changes, columns: columns, replaceTiers: replaceTiers}, nil
}

func (c BatchChannelModelChanges) requiresModelContract() bool {
	return c.Capability != nil || c.Protocol != nil || c.CapabilityTemplate != nil || c.PricingTemplate != nil ||
		(c.Enabled != nil && *c.Enabled) || (c.PricingEnabled != nil && *c.PricingEnabled)
}

// Resolve the final calling contract before applying prices. Explicit templates
// can repair an old config; a protocol-only change preserves and validates it.
func (s *Service) prepareBatchModelContract(channel *model.ModelChannel, before model.ChannelModel, after *model.ChannelModel, changes BatchChannelModelChanges, columns map[string]any) (*ModelCapabilityConfig, string, error) {
	if changes.Capability != nil {
		capability := normalizeCapability(*changes.Capability)
		if capability == "" || capability != *changes.Capability {
			return nil, "", BadAuthRequest("请选择有效的模型类型")
		}
		if before.Capability != "" && before.Capability != capability {
			return nil, "", BadAuthRequest("批量修改不能改变已有模型类型")
		}
		after.Capability = capability
	}
	protocolID := string(before.Protocol)
	if changes.Protocol != nil {
		protocolID = strings.TrimSpace(*changes.Protocol)
		if protocolID == "" {
			return nil, "", BadAuthRequest("请选择有效的模型请求协议")
		}
	}
	if template := changes.CapabilityTemplate; template != nil {
		if template.CapabilityConfig == nil {
			return nil, "", BadAuthRequest("能力模板不能为空")
		}
	}
	_, upstream, capability, protocol, err := s.normalizeChannelModelContract(channel, ChannelModelRequest{ModelKey: after.ModelKey, ProviderModelKey: after.ProviderModelKey, Capability: after.Capability, Protocol: protocolID})
	if err != nil {
		return nil, "", err
	}
	var config *ModelCapabilityConfig
	if changes.CapabilityTemplate != nil {
		config = changes.CapabilityTemplate.CapabilityConfig
	} else if before.Capability == "" && capability != "audio" {
		config = DefaultModelCapabilityConfigForModel(string(protocol), upstream)
	} else if before.Capability != "" {
		config, err = DecodeModelCapabilityConfig(before.CapabilityConfigJSON)
		if err != nil {
			return nil, "", err
		}
	}
	if capability == "text" || capability == "image" || capability == "video" {
		config, err = NormalizeModelCapabilityConfigForModel(capability, string(protocol), upstream, config, s.protocolRegistry())
		if err != nil {
			return nil, "", err
		}
	}
	after.Capability, after.Protocol = capability, protocol
	if changes.Capability != nil || changes.Protocol != nil || changes.CapabilityTemplate != nil {
		encoded, err := json.Marshal(config)
		if err != nil {
			return nil, "", err
		}
		after.CapabilityConfigJSON = string(encoded)
		if after.Capability != before.Capability || after.Protocol != before.Protocol || after.CapabilityConfigJSON != before.CapabilityConfigJSON {
			after.CapabilityVersion++
		}
		columns["capability"], columns["protocol"] = after.Capability, after.Protocol
		columns["capability_config_json"], columns["capability_version"] = after.CapabilityConfigJSON, after.CapabilityVersion
	}
	return config, upstream, nil
}
