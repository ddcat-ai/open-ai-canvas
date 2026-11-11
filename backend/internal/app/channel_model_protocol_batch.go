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
	selected, err := normalizeChannelModelProtocolIDs(ids)
	if err != nil {
		return 0, err
	}
	if channelID == "" {
		return 0, BadAuthRequest("请选择系统渠道")
	}
	return s.updateChannelModelProtocolTargets(actor, channelID, singleChannelModelProtocolTargets(selected, protocolID))
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
	return s.updateChannelModelProtocolTargets(actor, "", singleChannelModelProtocolTargets(selected, protocolID))
}

func singleChannelModelProtocolTargets(selected map[string]bool, protocolID string) map[string]string {
	targets := make(map[string]string, len(selected))
	for id := range selected {
		targets[id] = protocolID
	}
	return targets
}

func normalizeChannelModelProtocolGroups(groups []ChannelModelProtocolGroup) (map[string]string, error) {
	if len(groups) == 0 || len(groups) > 4 {
		return nil, BadAuthRequest("单次请选择 1 到 4 个协议分组")
	}
	targets := map[string]string{}
	for _, group := range groups {
		protocol := strings.TrimSpace(group.Protocol)
		if len(group.ModelIDs) == 0 || protocol == "" {
			return nil, BadAuthRequest("每个分组都需要模型和调用协议")
		}
		for _, rawID := range group.ModelIDs {
			id := strings.TrimSpace(rawID)
			if id == "" {
				return nil, BadAuthRequest("分组模型标识不能为空")
			}
			if _, duplicate := targets[id]; duplicate {
				return nil, BadAuthRequest("分组内或分组之间不能重复选择同一个模型")
			}
			targets[id] = protocol
			if len(targets) > maxAdminChannelModelBatchProtocolCount {
				return nil, BadAuthRequest("单次最多修改 100 个渠道模型")
			}
		}
	}
	return targets, nil
}

func (s *Service) updateChannelModelProtocolTargets(actor *model.User, channelID string, targets map[string]string) (int, error) {
	selected := make(map[string]bool, len(targets))
	for id := range targets {
		selected[id] = true
	}
	if channelID != "" {
		channel, err := s.repo.AdminSystemChannel(channelID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return 0, BadAuthRequest("系统渠道不存在或已删除")
			}
			return 0, err
		}
		items, err := s.repo.ChannelModels(channelID, true)
		if err != nil {
			return 0, err
		}
		return s.applyChannelModelsProtocol(actor, items, selected, map[string]*model.ModelChannel{channel.ID: channel}, targets)
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
	return s.applyChannelModelsProtocol(actor, items, selected, channels, targets)
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
func (s *Service) applyChannelModelsProtocol(actor *model.User, items []model.ChannelModel, selected map[string]bool, channels map[string]*model.ModelChannel, targets map[string]string) (int, error) {
	registry := s.protocolRegistry()
	updates := make([]model.ChannelModel, 0, len(selected))
	changed := map[string]bool{}
	for _, item := range items {
		channel := channels[item.ChannelID]
		if !selected[item.ID] || channel == nil {
			continue
		}
		name := firstNonEmpty(item.DisplayName, item.ModelKey)
		_, providerModelKey, capability, protocol, contractErr := s.normalizeChannelModelContract(channel, ChannelModelRequest{
			ModelKey: item.ModelKey, ProviderModelKey: item.ProviderModelKey, Capability: item.Capability, Protocol: targets[item.ID],
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
		changed[item.ID] = item.Protocol != protocol
		item.Protocol = protocol
		updates = append(updates, item)
	}
	if len(updates) != len(selected) {
		return 0, BadAuthRequest("所选渠道模型中存在已删除或不属于系统渠道的记录，请刷新后重试")
	}
	sort.Slice(updates, func(i, j int) bool { return updates[i].ID < updates[j].ID })
	if err := s.repo.Transaction(func(repo *repository.Repository) error {
		websites := map[string]bool{}
		channelIDs := make([]string, 0, len(channels))
		for _, channel := range channels {
			if channel.WebsiteID != "" {
				websites[channel.WebsiteID] = true
			}
			channelIDs = append(channelIDs, channel.ID)
		}
		for _, id := range sortedKeys(websites) {
			if _, err := repo.LockChannelWebsite(id); err != nil {
				return err
			}
		}
		if err := repo.LockSystemChannelConfiguration(channelIDs); err != nil {
			return err
		}
		for _, channel := range channels {
			current, err := repo.AdminSystemChannel(channel.ID)
			if err != nil {
				return err
			}
			if current.WebsiteID != channel.WebsiteID {
				return BadAuthRequest("Key 分组归属已变化，请刷新后重试")
			}
		}
		if err := repo.UpdateChannelModelProtocols(updates); err != nil {
			return err
		}
		for index := range updates {
			item := &updates[index]
			if changed[item.ID] {
				if err := repo.RecordChannelProtocolSelection(channels[item.ChannelID].WebsiteID, actor.ID, item); err != nil {
					return err
				}
			}
		}
		byChannel := map[string][]model.ChannelModel{}
		for _, item := range updates {
			byChannel[item.ChannelID] = append(byChannel[item.ChannelID], item)
		}
		for _, channelID := range channelIDs {
			items := byChannel[channelID]
			keys := make([]string, 0, len(items))
			models := make([]map[string]string, 0, len(items))
			protocols := map[string]bool{}
			for _, item := range items {
				keys = append(keys, item.ModelKey)
				models = append(models, map[string]string{"modelId": item.ID, "modelKey": item.ModelKey, "protocol": string(item.Protocol)})
				protocols[string(item.Protocol)] = true
			}
			summary := "批量修改渠道模型协议"
			metadata := map[string]any{"channelId": channelID, "modelKeys": keys, "models": models}
			if len(protocols) == 1 {
				protocol := sortedKeys(protocols)[0]
				metadata["protocol"] = protocol
				summary += "为 " + protocol
			}
			event, err := newAdminAuditEvent(actor, "channel_model.batch_protocol", "model_channel", channelID, summary, metadata)
			if err != nil {
				return err
			}
			if err := repo.AppendAdminAudit(event); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		if errors.Is(err, repository.ErrChannelModelPriceConflict) {
			return 0, BadAuthRequest("模型配置已被其他操作修改，请刷新后重试；本次未修改任何模型")
		}
		return 0, err
	}
	s.invalidateRouteCatalog()
	return len(updates), nil
}
