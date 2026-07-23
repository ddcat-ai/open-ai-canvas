package service

import (
	"context"
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/model"
)

type ChannelModelRequest struct {
	ModelKey              string `json:"modelKey"`
	DisplayName           string `json:"displayName"`
	Capability            string `json:"capability"`
	BillingMode           string `json:"billingMode"`
	UnitPriceMicrocredits int64  `json:"unitPriceMicrocredits"`
	PriceConfigured       bool   `json:"priceConfigured"`
	Enabled               *bool  `json:"enabled"`
}

// AdminChannelModelFetchResult 是管理员从上游拉目录后的汇总：models 为去重后的标识，added 为本次新建条数。
type AdminChannelModelFetchResult struct {
	Models []string `json:"models"`
	Added  int64    `json:"added"`
}

func (s *Service) EnsureSystemChannelModels() error {
	channels, err := s.repo.SystemChannels(true)
	if err != nil {
		return err
	}
	for index := range channels {
		items, err := s.repo.ChannelModels(channels[index].ID, true)
		if err != nil {
			return err
		}
		if len(items) == 0 {
			if err := s.syncInitialChannelModels(&channels[index], channelModelNames(channels[index])); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) AdminChannelModels(actor *model.User, channelID string) ([]model.ChannelModel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if _, err := s.repo.AdminSystemChannel(channelID); err != nil {
		return nil, err
	}
	return s.ensureChannelModels(channelID, true)
}

func (s *Service) FetchAdminChannelModels(ctx context.Context, actor *model.User, channelID string) (*AdminChannelModelFetchResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	// 使用服务端保存的渠道密钥请求上游，避免密钥为了拉目录再次经过浏览器。
	models, err := s.FetchChannelModels(ctx, actor, ChannelModelsRequest{BaseURL: channel.BaseURL, APIKey: channel.APIKey, APIFormat: channel.APIFormat})
	if err != nil {
		return nil, err
	}
	existing, err := s.repo.ChannelModels(channelID, true)
	if err != nil {
		return nil, err
	}
	known := make(map[string]struct{}, len(existing))
	for _, item := range existing {
		known[item.ModelKey] = struct{}{}
	}
	missing := make([]model.ChannelModel, 0, len(models))
	for _, name := range models {
		if _, ok := known[name]; ok {
			continue
		}
		// 自动发现不能绕过定价边界；新模型由管理员定价后再手动启用。
		missing = append(missing, model.ChannelModel{ID: newID(), ChannelID: channelID, ModelKey: name, DisplayName: name, Capability: capabilityForChannel(*channel), BillingMode: "fixed_request", Enabled: false, PriceVersion: 1})
	}
	added, err := s.repo.CreateMissingChannelModels(missing)
	if err != nil {
		return nil, err
	}
	return &AdminChannelModelFetchResult{Models: models, Added: added}, nil
}

func (s *Service) SaveAdminChannelModel(actor *model.User, channelID string, id string, req ChannelModelRequest) (*model.ChannelModel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	modelKey := strings.TrimPrefix(strings.TrimSpace(req.ModelKey), "models/")
	if modelKey == "" {
		return nil, BadAuthRequest("请填写模型标识")
	}
	capability := normalizeCapability(req.Capability)
	if capability == "" {
		capability = capabilityForChannel(*channel)
	}
	if capability == "" {
		return nil, BadAuthRequest("请选择模型能力")
	}
	billingMode := strings.TrimSpace(req.BillingMode)
	if billingMode == "" {
		billingMode = "fixed_request"
	}
	if billingMode != "fixed_request" {
		return nil, BadAuthRequest("当前版本只支持按次固定计费")
	}
	if req.UnitPriceMicrocredits < 0 {
		return nil, BadAuthRequest("模型积分价格不能小于 0")
	}
	item := &model.ChannelModel{ID: newID(), ChannelID: channelID, Enabled: true, PriceVersion: 1}
	if id != "" {
		item, err = s.repo.ChannelModelByID(channelID, id)
		if err != nil {
			return nil, err
		}
		item.PriceVersion++
	}
	item.ModelKey = modelKey
	item.DisplayName = strings.TrimSpace(req.DisplayName)
	if item.DisplayName == "" {
		item.DisplayName = modelKey
	}
	item.Capability = capability
	item.BillingMode = billingMode
	item.UnitPriceMicrocredits = req.UnitPriceMicrocredits
	item.PriceConfigured = req.PriceConfigured
	if req.Enabled != nil {
		item.Enabled = *req.Enabled
	}
	if err := s.repo.SaveChannelModel(item); err != nil {
		return nil, err
	}
	if err := s.syncChannelModelNames(channel); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) DisableAdminChannelModel(actor *model.User, channelID string, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	item, err := s.repo.ChannelModelByID(channelID, id)
	if err != nil {
		return err
	}
	item.Enabled = false
	item.PriceVersion++
	if err := s.repo.SaveChannelModel(item); err != nil {
		return err
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		return err
	}
	return s.syncChannelModelNames(channel)
}

func (s *Service) syncInitialChannelModels(channel *model.ModelChannel, names []string) error {
	existing, err := s.repo.ChannelModels(channel.ID, true)
	if err != nil {
		return err
	}
	byKey := make(map[string]*model.ChannelModel, len(existing))
	for index := range existing {
		byKey[existing[index].ModelKey] = &existing[index]
	}
	desired := make(map[string]bool, len(names))
	for _, name := range uniqueNonEmpty(names) {
		name = strings.TrimPrefix(name, "models/")
		desired[name] = true
		if item := byKey[name]; item != nil {
			if !item.Enabled {
				item.Enabled = true
				item.PriceVersion++
				if err := s.repo.SaveChannelModel(item); err != nil {
					return err
				}
			}
			continue
		}
		item := model.ChannelModel{ID: newID(), ChannelID: channel.ID, ModelKey: name, DisplayName: name, Capability: capabilityForChannel(*channel), BillingMode: "fixed_request", Enabled: true, PriceVersion: 1}
		if err := s.repo.SaveChannelModel(&item); err != nil {
			return err
		}
	}
	for index := range existing {
		if existing[index].Enabled && !desired[existing[index].ModelKey] {
			existing[index].Enabled = false
			existing[index].PriceVersion++
			if err := s.repo.SaveChannelModel(&existing[index]); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) ensureChannelModels(channelID string, includeDisabled bool) ([]model.ChannelModel, error) {
	items, err := s.repo.ChannelModels(channelID, includeDisabled)
	if err != nil || len(items) > 0 {
		return items, err
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	if err := s.syncInitialChannelModels(channel, channelModelNames(*channel)); err != nil {
		return nil, err
	}
	return s.repo.ChannelModels(channelID, includeDisabled)
}

func (s *Service) syncChannelModelNames(channel *model.ModelChannel) error {
	items, err := s.repo.ChannelModels(channel.ID, false)
	if err != nil {
		return err
	}
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, item.ModelKey)
	}
	encoded, err := json.Marshal(names)
	if err != nil {
		return err
	}
	channel.ModelsJSON = string(encoded)
	return s.repo.Save(channel)
}

func capabilityForChannel(channel model.ModelChannel) string {
	switch channel.InterfaceType {
	case model.ChannelInterfaceOpenAIImage:
		return "image"
	case model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceNewAPIChannel1, model.ChannelInterfaceNewAPIChannel2, model.ChannelInterfaceXAIVideo:
		return "video"
	default:
		return "text"
	}
}
