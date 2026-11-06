package app

import (
	"errors"
	"fmt"
	"sort"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type ChannelModelRepriceRequest struct {
	ModelID      string                           `json:"modelId"`
	PriceVersion int64                            `json:"priceVersion"`
	PriceTiers   []ChannelModelTierRepriceRequest `json:"priceTiers"`
}

type ChannelModelTierRepriceRequest struct {
	ID           string            `json:"id"`
	PriceVersion int64             `json:"priceVersion"`
	Prices       map[string]*int64 `json:"prices"`
}

// RepriceAdminChannelModels only changes sale prices, never model availability or cost.
func (s *Service) RepriceAdminChannelModels(actor *model.User, channelID string, requests []ChannelModelRepriceRequest) (int, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return 0, err
	}
	if _, err := s.adminSystemChannel(channelID); err != nil {
		return 0, err
	}
	selected, err := normalizeChannelModelRepriceRequests(requests)
	if err != nil {
		return 0, err
	}
	items, err := s.repo.ChannelModels(channelID, true)
	if err != nil {
		return 0, err
	}
	return s.applyChannelModelReprice(items, selected)
}

// RepriceAdminAllChannelModels 是跨渠道模型视图的统一调价：所选模型可来自不同系统渠道，
// 与单渠道调价使用同一套版本校验，并在一个事务里整批提交。
func (s *Service) RepriceAdminAllChannelModels(actor *model.User, requests []ChannelModelRepriceRequest) (int, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return 0, err
	}
	selected, err := normalizeChannelModelRepriceRequests(requests)
	if err != nil {
		return 0, err
	}
	ids := make([]string, 0, len(selected))
	for id := range selected {
		ids = append(ids, id)
	}
	items, err := s.repo.ChannelModelsByIDs(ids)
	if err != nil {
		return 0, err
	}
	channelIDs := make([]string, 0, len(items))
	for _, item := range items {
		channelIDs = append(channelIDs, item.ChannelID)
	}
	channels, err := s.repo.SystemChannelsByIDs(channelIDs, true)
	if err != nil {
		return 0, err
	}
	system := make(map[string]bool, len(channels))
	for _, channel := range channels {
		system[channel.ID] = true
	}
	scoped := items[:0]
	for _, item := range items {
		if system[item.ChannelID] {
			scoped = append(scoped, item)
		}
	}
	return s.applyChannelModelReprice(scoped, selected)
}

func normalizeChannelModelRepriceRequests(requests []ChannelModelRepriceRequest) (map[string]ChannelModelRepriceRequest, error) {
	if len(requests) == 0 || len(requests) > 100 {
		return nil, BadAuthRequest("单次请选择 1 到 100 个渠道模型")
	}
	selected := make(map[string]ChannelModelRepriceRequest, len(requests))
	for _, request := range requests {
		id := strings.TrimSpace(request.ModelID)
		if _, duplicate := selected[id]; id == "" || duplicate || request.PriceVersion < 1 {
			return nil, BadAuthRequest("渠道模型 ID 或价格版本无效，且模型不能重复")
		}
		selected[id] = request
	}
	return selected, nil
}

// applyChannelModelReprice 只处理 items 中的模型；调用方负责把 items 限定在允许修改的系统渠道内。
func (s *Service) applyChannelModelReprice(items []model.ChannelModel, selected map[string]ChannelModelRepriceRequest) (int, error) {
	updates := make([]model.ChannelModel, 0, len(selected))
	for _, item := range items {
		request, exists := selected[item.ID]
		if !exists {
			continue
		}
		if request.PriceVersion != item.PriceVersion {
			return 0, BadAuthRequest("模型价格已变化，请刷新后重新调价；本次未修改任何价格")
		}
		tiers := make(map[string]ChannelModelTierRepriceRequest, len(request.PriceTiers))
		for _, tier := range request.PriceTiers {
			if _, duplicate := tiers[tier.ID]; tier.ID == "" || duplicate {
				return 0, BadAuthRequest("规格 ID 不能为空或重复")
			}
			tiers[tier.ID] = tier
		}
		active := 0
		for index := range item.PriceTiers {
			tier := &item.PriceTiers[index]
			if !tier.Enabled {
				continue
			}
			active++
			input, exists := tiers[tier.ID]
			if !exists || input.PriceVersion != tier.PriceVersion {
				return 0, BadAuthRequest("规格价格已变化或提交不完整，请刷新后重新调价")
			}
			if err := applyChannelModelTierPrices(tier, item.Capability, item.Protocol, input.Prices); err != nil {
				return 0, BadAuthRequest(fmt.Sprintf("模型 %s（规格 %s）：%s；本次未修改任何价格", item.ModelKey, tier.SelectorKey, err.Error()))
			}
		}
		if active == 0 || active != len(tiers) {
			return 0, BadAuthRequest("模型 " + item.ModelKey + " 的规格提交不完整或包含无效规格；本次未修改任何价格")
		}
		s.applyChannelModelPriceTierSummary(&item, item.PriceTiers)
		updates = append(updates, item)
	}
	if len(updates) != len(selected) {
		return 0, BadAuthRequest("所选模型已删除或不属于系统渠道，请刷新后重试")
	}
	// Consistent lock order for overlapping batch requests.
	sort.Slice(updates, func(i, j int) bool { return updates[i].ID < updates[j].ID })
	if err := s.repo.UpdateChannelModelSalePrices(updates); err != nil {
		if errors.Is(err, repository.ErrChannelModelPriceConflict) {
			return 0, BadAuthRequest("模型价格已被其他操作修改，请刷新后重试；本次未修改任何价格")
		}
		return 0, err
	}
	s.invalidateRouteCatalog()
	return len(updates), nil
}

func applyChannelModelTierPrices(tier *model.ChannelModelPriceTier, capability string, protocol model.ChannelInterfaceType, prices map[string]*int64) error {
	if tier.ID == "" || !tier.PriceConfigured || !tier.CostPricing.Configured {
		return BadAuthRequest("请先保存完整的规格成本价和销售价配置")
	}
	if err := validateCreditCostPricing(capability, tier.BillingMode, tier.CostPricing); err != nil {
		return err
	}
	fields := map[string]*int64{"unitPriceMicrocredits": &tier.UnitPriceMicrocredits}
	if tier.BillingMode == "token" {
		fields = map[string]*int64{"outputTokenPriceMicrocredits": &tier.OutputTokenPriceMicrocredits}
		if capability != "video" {
			fields["inputTokenPriceMicrocredits"] = &tier.InputTokenPriceMicrocredits
			fields["cachedTokenPriceMicrocredits"] = &tier.CachedTokenPriceMicrocredits
			fields["cacheWriteTokenPriceMicrocredits"] = &tier.CacheWriteTokenPriceMicrocredits
		}
	}
	if len(prices) != len(fields) {
		return BadAuthRequest("必须提交当前计费方式的全部销售价，且不能包含其他字段")
	}
	for key, target := range fields {
		value, exists := prices[key]
		if !exists || value == nil || *value < 0 || *value > 9_007_199_254_740_991 {
			return BadAuthRequest("销售价缺失或超出有效范围")
		}
		*target = *value
	}
	return validateChannelModelTierPricing(capability, protocol, tier.BillingMode, ChannelModelPriceTierRequest{
		CostPricing: tier.CostPricing, UnitPriceMicrocredits: tier.UnitPriceMicrocredits,
		InputTokenPriceMicrocredits: tier.InputTokenPriceMicrocredits, OutputTokenPriceMicrocredits: tier.OutputTokenPriceMicrocredits,
		CachedTokenPriceMicrocredits: tier.CachedTokenPriceMicrocredits, CacheWriteTokenPriceMicrocredits: tier.CacheWriteTokenPriceMicrocredits,
	})
}
