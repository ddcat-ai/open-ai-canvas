package app

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const maxAdminChannelModelBatchProtocolCount = 100

// UpdateAdminChannelModelsProtocol 批量切换同一系统渠道内模型的调用协议。
func (s *Service) UpdateAdminChannelModelsProtocol(actor *model.User, channelID string, ids []string, protocolID string) (int, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return 0, err
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, BadAuthRequest("系统渠道不存在或已删除")
		}
		return 0, err
	}
	selected, err := normalizeChannelModelProtocolIDs(ids)
	if err != nil {
		return 0, err
	}
	items, err := s.repo.ChannelModels(channelID, true)
	if err != nil {
		return 0, err
	}
	return s.applyChannelModelsProtocol(actor, items, selected, map[string]*model.ModelChannel{channel.ID: channel}, protocolID)
}

// UpdateAdminAllChannelModelsProtocol 是跨渠道模型视图的批量切换协议：所选模型可来自不同系统渠道，
// 每个模型按所属渠道校验协议鉴权要求，整批在一个事务里提交。
func (s *Service) UpdateAdminAllChannelModelsProtocol(actor *model.User, ids []string, protocolID string) (int, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return 0, err
	}
	selected, err := normalizeChannelModelProtocolIDs(ids)
	if err != nil {
		return 0, err
	}
	items, err := s.repo.ChannelModelsByIDs(sortedKeys(selected))
	if err != nil {
		return 0, err
	}
	channelIDs := make([]string, 0, len(items))
	for _, item := range items {
		channelIDs = append(channelIDs, item.ChannelID)
	}
	channelList, err := s.repo.SystemChannelsByIDs(channelIDs, true)
	if err != nil {
		return 0, err
	}
	channels := make(map[string]*model.ModelChannel, len(channelList))
	for index := range channelList {
		channels[channelList[index].ID] = &channelList[index]
	}
	return s.applyChannelModelsProtocol(actor, items, selected, channels, protocolID)
}

func normalizeChannelModelProtocolIDs(ids []string) (map[string]bool, error) {
	modelIDs := uniqueNonEmpty(ids)
	if len(modelIDs) == 0 || len(modelIDs) > maxAdminChannelModelBatchProtocolCount {
		return nil, BadAuthRequest("单次请选择 1 到 100 个渠道模型")
	}
	selected := make(map[string]bool, len(modelIDs))
	for _, id := range modelIDs {
		selected[id] = true
	}
	return selected, nil
}

func sortedKeys(values map[string]bool) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// applyChannelModelsProtocol 保留能力配置与价格档，只按新协议重新规范化并校验；
// channels 只含允许修改的系统渠道，不在其中的模型视为越权，整批拒绝。
func (s *Service) applyChannelModelsProtocol(actor *model.User, items []model.ChannelModel, selected map[string]bool, channels map[string]*model.ModelChannel, protocolID string) (int, error) {
	registry := s.protocolRegistry()
	updates := make([]model.ChannelModel, 0, len(selected))
	for _, item := range items {
		channel := channels[item.ChannelID]
		if !selected[item.ID] || channel == nil {
			continue
		}
		name := firstNonEmpty(item.DisplayName, item.ModelKey)
		_, providerModelKey, capability, protocol, contractErr := s.normalizeChannelModelContract(channel, ChannelModelRequest{
			ModelKey: item.ModelKey, ProviderModelKey: item.ProviderModelKey, Capability: item.Capability, Protocol: protocolID,
		})
		if contractErr != nil {
			return 0, BadAuthRequest("模型 " + name + "：" + contractErr.Error() + "；本次未修改任何模型")
		}
		if capability == "text" || capability == "image" || capability == "video" {
			config, decodeErr := DecodeModelCapabilityConfig(item.CapabilityConfigJSON)
			if decodeErr != nil {
				return 0, BadAuthRequest("模型 " + name + " 的能力配置无效，请先单独编辑保存")
			}
			normalized, normalizeErr := NormalizeModelCapabilityConfigForModel(capability, string(protocol), providerModelKey, config, registry)
			if normalizeErr != nil {
				return 0, BadAuthRequest("模型 " + name + " 的能力配置不适用于新协议：" + normalizeErr.Error() + "；请单独编辑该模型")
			}
			encoded, encodeErr := json.Marshal(normalized)
			if encodeErr != nil {
				return 0, encodeErr
			}
			if item.CapabilityConfigJSON != string(encoded) {
				item.CapabilityVersion++
			}
			item.CapabilityConfigJSON = string(encoded)
		}
		if err := validateChannelModelTierCapabilities(item.PriceTiers, item.CapabilityConfigJSON, capability, string(protocol)); err != nil {
			return 0, BadAuthRequest("模型 " + name + " 的价格档不适用于新协议：" + err.Error() + "；请单独编辑该模型")
		}
		item.Protocol = protocol
		updates = append(updates, item)
	}
	if len(updates) != len(selected) {
		return 0, BadAuthRequest("所选渠道模型中存在已删除或不属于系统渠道的记录，请刷新后重试")
	}
	sort.Slice(updates, func(i, j int) bool { return updates[i].ID < updates[j].ID })
	if err := s.repo.UpdateChannelModelProtocols(updates); err != nil {
		if errors.Is(err, repository.ErrChannelModelPriceConflict) {
			return 0, BadAuthRequest("模型配置已被其他操作修改，请刷新后重试；本次未修改任何模型")
		}
		return 0, err
	}
	s.invalidateRouteCatalog()
	byChannel := map[string][]string{}
	for _, item := range updates {
		byChannel[item.ChannelID] = append(byChannel[item.ChannelID], item.ModelKey)
	}
	for channelID, keys := range byChannel {
		if err := s.appendAdminAudit(actor, "channel_model.batch_protocol", "model_channel", channelID, "批量修改渠道模型协议为 "+strings.TrimSpace(protocolID), map[string]any{"channelId": channelID, "protocol": strings.TrimSpace(protocolID), "modelKeys": keys}); err != nil {
			return 0, err
		}
	}
	return len(updates), nil
}
