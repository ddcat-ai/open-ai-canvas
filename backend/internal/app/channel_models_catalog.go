// 渠道模型的上游目录拉取、导入预览与初始同步。

package app

import (
	"context"
	"strings"

	"yingce/backend/internal/model"
)

func (s *Service) FetchAdminChannelModels(ctx context.Context, actor *model.User, channelID string) (*AdminChannelModelFetchResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.adminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	headers, err := ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return nil, err
	}
	// 使用服务端保存的渠道密钥和请求头访问上游，避免敏感配置再次经过浏览器。
	models, err := s.FetchChannelModels(ctx, actor, ChannelModelsRequest{BaseURL: channel.BaseURL, APIKey: channel.APIKey, APIFormat: channel.APIFormat, Headers: headers})
	if err != nil {
		return nil, err
	}
	// 只按当前未删除记录去重；普通手动删除的模型仍可重新拉取，已合并进模型家族的 SKU 除外。
	existing, err := s.repo.ChannelModels(channelID, true)
	if err != nil {
		return nil, err
	}
	known := make(map[string]struct{}, len(existing))
	for _, item := range existing {
		known[channelModelCatalogKey(item.ModelKey)] = struct{}{}
	}
	retired := retiredChannelModelKeys(channel.RetiredModelsJSON)
	missing := make([]model.ChannelModel, 0, len(models))
	for _, name := range models {
		name = strings.TrimPrefix(strings.TrimSpace(name), "models/")
		key := channelModelCatalogKey(name)
		if _, ok := known[key]; ok || retired[key] {
			continue
		}
		// 自动发现不能绕过定价边界；新模型由管理员定价后再手动启用。
		modelID, idErr := s.repo.NextPrefixedID("MODEL")
		if idErr != nil {
			return nil, idErr
		}
		missing = append(missing, model.ChannelModel{ID: modelID, ChannelID: channelID, ModelKey: name, ProviderModelKey: name, DisplayName: name, BillingMode: "fixed_request", Enabled: false, PriceVersion: 1})
	}
	added, err := s.repo.CreateMissingChannelModels(missing)
	if err != nil {
		return nil, err
	}
	if added > 0 {
		s.invalidateRouteCatalog()
	}
	return &AdminChannelModelFetchResult{Models: models, Added: added}, nil
}

// PreviewAdminChannelModels 只读取上游模型目录，不修改渠道模型配置。
func (s *Service) PreviewAdminChannelModels(ctx context.Context, actor *model.User, channelID string) ([]string, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.fetchAdminChannelModelCatalog(ctx, actor, channelID)
}

// ImportAdminChannelModels 只导入管理员明确选择、且仍存在于上游目录中的模型。
func (s *Service) ImportAdminChannelModels(ctx context.Context, actor *model.User, channelID string, selected []string) (*AdminChannelModelFetchResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.adminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	models, err := s.fetchAdminChannelModelCatalog(ctx, actor, channelID)
	if err != nil {
		return nil, err
	}
	if len(selected) == 0 {
		return nil, BadAuthRequest("请至少选择一个要导入的模型")
	}
	if len(selected) > 500 {
		return nil, BadAuthRequest("单次最多导入 500 个模型")
	}
	available := make(map[string]string, len(models))
	for _, name := range models {
		available[channelModelCatalogKey(name)] = name
	}
	chosen := make([]string, 0, len(selected))
	seen := make(map[string]struct{}, len(selected))
	for _, rawName := range selected {
		name := strings.TrimPrefix(strings.TrimSpace(rawName), "models/")
		key := channelModelCatalogKey(name)
		if key == "" {
			continue
		}
		canonical, ok := available[key]
		if !ok {
			return nil, BadAuthRequest("所选模型不在上游模型目录中：" + name)
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		chosen = append(chosen, canonical)
	}
	if len(chosen) == 0 {
		return nil, BadAuthRequest("请至少选择一个有效的模型")
	}

	existing, err := s.repo.ChannelModels(channelID, true)
	if err != nil {
		return nil, err
	}
	known := make(map[string]struct{}, len(existing))
	for _, item := range existing {
		providerKey := firstNonEmpty(item.ProviderModelKey, item.ModelKey)
		known[channelModelCatalogKey(providerKey)] = struct{}{}
	}
	retired := retiredChannelModelKeys(channel.RetiredModelsJSON)
	missing := make([]model.ChannelModel, 0, len(chosen))
	for _, name := range chosen {
		key := channelModelCatalogKey(name)
		if _, ok := known[key]; ok || retired[key] {
			continue
		}
		modelID, idErr := s.repo.NextPrefixedID("MODEL")
		if idErr != nil {
			return nil, idErr
		}
		missing = append(missing, model.ChannelModel{ID: modelID, ChannelID: channelID, ModelKey: name, DisplayName: name, BillingMode: "fixed_request", Enabled: false, PriceConfigured: false, PriceVersion: 1})
		known[key] = struct{}{}
	}
	added, err := s.repo.CreateMissingChannelModels(missing)
	if err != nil {
		return nil, err
	}
	if added > 0 {
		s.invalidateRouteCatalog()
	}
	return &AdminChannelModelFetchResult{Models: chosen, Added: added}, nil
}

func (s *Service) fetchAdminChannelModelCatalog(ctx context.Context, actor *model.User, channelID string) ([]string, error) {
	channel, err := s.adminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	headers, err := ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return nil, err
	}
	models, err := s.FetchChannelModels(ctx, actor, ChannelModelsRequest{BaseURL: channel.BaseURL, APIKey: channel.APIKey, APIFormat: channel.APIFormat, Headers: headers})
	if err != nil {
		return nil, err
	}
	return uniqueNonEmpty(models), nil
}
