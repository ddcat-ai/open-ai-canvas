package service

import (
	"encoding/json"
	"infinite-canvas/backend/internal/model"
)

// ModelCatalogSource 表示模型目录来源
type ModelCatalogSource string

const (
	// ModelCatalogSourceFrontend 前台模型虚拟渠道
	ModelCatalogSourceFrontend ModelCatalogSource = "frontend"
	// ModelCatalogSourceSystem 脱敏的系统渠道模型
	ModelCatalogSourceSystem ModelCatalogSource = "system"
)

// ModelCatalogResponse 统一模型目录响应
type ModelCatalogResponse struct {
	Source   ModelCatalogSource     `json:"source"`
	Models   []PublicLogicalModel   `json:"models,omitempty"`
	Channels []PublicChannelCatalog `json:"channels,omitempty"`
}

// PublicChannelCatalog 公开的渠道目录信息（脱敏）
type PublicChannelCatalog struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	DisplayName string               `json:"displayName"`
	Models      []PublicChannelModel `json:"models"`
}

// PublicChannelModel 公开的渠道模型信息（脱敏）
type PublicChannelModel struct {
	ID               string                        `json:"id"`
	ModelKey         string                        `json:"modelKey"`
	DisplayName      string                        `json:"displayName"`
	Capability       string                        `json:"capability"`
	Protocol         model.ChannelInterfaceType    `json:"protocol"`
	CapabilityConfig map[string]any                `json:"capabilityConfig,omitempty"`
	PriceTiers       []PublicChannelModelPriceTier `json:"priceTiers"`
	PricingMode      string                        `json:"pricingMode"`
	DisplayPrice     *int64                        `json:"displayPrice,omitempty"`
	PriceLabel       string                        `json:"priceLabel"`
	Available        bool                          `json:"available"`
}

// PublicChannelModelPriceTier 公开的渠道模型价格档（脱敏）
type PublicChannelModelPriceTier struct {
	ID                           string            `json:"id"`
	Selector                     map[string]string `json:"selector,omitempty"`
	Resolution                   string            `json:"resolution"`
	VideoSeconds                 int               `json:"videoSeconds"`
	BillingMode                  string            `json:"billingMode"`
	UnitPriceMicrocredits        int64             `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits  int64             `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits int64             `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits int64             `json:"cachedTokenPriceMicrocredits"`
}

// ModelCatalog 返回统一的模型目录
// 根据 frontendModelsEnabled 开关返回前台模型或系统渠道模型
func (s *Service) ModelCatalog(intent *ModelRequestIntent) (*ModelCatalogResponse, error) {
	frontendEnabled, err := s.FeatureEnabled(FeatureFrontendModels)
	if err != nil {
		return nil, err
	}

	if frontendEnabled {
		// 返回前台模型目录
		models, err := s.PublicLogicalModels(intent)
		if err != nil {
			return nil, err
		}
		return &ModelCatalogResponse{
			Source: ModelCatalogSourceFrontend,
			Models: models,
		}, nil
	}

	// 返回脱敏的系统渠道模型目录
	channels, err := s.publicSystemChannelCatalog(intent)
	if err != nil {
		return nil, err
	}
	return &ModelCatalogResponse{
		Source:   ModelCatalogSourceSystem,
		Channels: channels,
	}, nil
}

// publicSystemChannelCatalog 返回脱敏后的系统渠道模型目录
// 只包含普通用户可见的信息，不包含密钥、Base URL、供应商信息等
func (s *Service) publicSystemChannelCatalog(intent *ModelRequestIntent) ([]PublicChannelCatalog, error) {
	channels, err := s.repo.SystemChannels(true)
	if err != nil {
		return nil, err
	}

	result := make([]PublicChannelCatalog, 0, len(channels))
	for _, channel := range channels {
		if !channel.Enabled {
			continue
		}

		channelModels, err := s.repo.ChannelModels(channel.ID, false)
		if err != nil {
			return nil, err
		}

		publicModels := make([]PublicChannelModel, 0, len(channelModels))
		for _, cm := range channelModels {
			if !cm.Enabled {
				continue
			}

			// 如果提供了意图，进行能力过滤
			if intent != nil && !s.channelModelMatchesIntent(&cm, intent) {
				continue
			}

			publicModel := s.sanitizeChannelModel(&cm)
			publicModels = append(publicModels, publicModel)
		}

		if len(publicModels) > 0 {
			result = append(result, PublicChannelCatalog{
				ID:          channel.ID,
				Name:        channel.Name,
				DisplayName: channel.Name,
				Models:      publicModels,
			})
		}
	}

	return result, nil
}

// sanitizeChannelModel 脱敏渠道模型，只保留用户可见的信息
func (s *Service) sanitizeChannelModel(cm *model.ChannelModel) PublicChannelModel {
	// 价格档已经在 cm.PriceTiers 中加载
	priceTiers := cm.PriceTiers

	// 转换为公开的价格档
	publicTiers := make([]PublicChannelModelPriceTier, 0, len(priceTiers))
	for _, tier := range priceTiers {
		if !tier.Enabled || !tier.PriceConfigured || !ValidatePriceTierPrice(&tier, cm.Capability, cm.Protocol) {
			continue
		}
		publicTiers = append(publicTiers, PublicChannelModelPriceTier{
			ID:                           tier.ID,
			Selector:                     model.DecodeSKUSelector(tier.SelectorJSON),
			Resolution:                   tier.Resolution,
			VideoSeconds:                 tier.VideoSeconds,
			BillingMode:                  tier.BillingMode,
			UnitPriceMicrocredits:        tier.UnitPriceMicrocredits,
			InputTokenPriceMicrocredits:  tier.InputTokenPriceMicrocredits,
			OutputTokenPriceMicrocredits: tier.OutputTokenPriceMicrocredits,
			CachedTokenPriceMicrocredits: tier.CachedTokenPriceMicrocredits,
		})
	}

	// 计算价格展示
	pricingMode, displayPrice, priceLabel := computeChannelModelPriceDisplay(cm, publicTiers)

	// 解析能力配置
	var capabilityConfig map[string]any
	if cm.CapabilityConfigJSON != "" {
		config, _ := DecodeModelCapabilityConfig(cm.CapabilityConfigJSON)
		if config != nil {
			normalized, _ := NormalizeModelCapabilityConfig(cm.Capability, string(cm.Protocol), config)
			if normalized != nil {
				// 转换为 map[string]any
				capabilityConfig = modelCapabilityConfigToMap(normalized)
			}
		}
	}

	return PublicChannelModel{
		ID:               cm.ID,
		ModelKey:         cm.ModelKey,
		DisplayName:      cm.DisplayName,
		Capability:       cm.Capability,
		Protocol:         cm.Protocol,
		CapabilityConfig: capabilityConfig,
		PriceTiers:       publicTiers,
		PricingMode:      pricingMode,
		DisplayPrice:     displayPrice,
		PriceLabel:       priceLabel,
		Available:        len(publicTiers) > 0 || (len(priceTiers) == 0 && HasValidPrice(cm)),
	}
}

// computeChannelModelPriceDisplay 计算渠道模型的价格展示信息
func computeChannelModelPriceDisplay(cm *model.ChannelModel, priceTiers []PublicChannelModelPriceTier) (string, *int64, string) {
	if len(priceTiers) == 0 {
		return "provider", nil, "未配置"
	}

	if len(priceTiers) == 1 {
		tier := priceTiers[0]
		price := getChannelTierDisplayPrice(tier)
		if price > 0 {
			return "provider", &price, ""
		}
	}

	// 多个价格档，显示"按渠道规格计费"
	return "provider", nil, "按渠道规格计费"
}

// getChannelTierDisplayPrice 获取渠道价格档的展示价格
func getChannelTierDisplayPrice(tier PublicChannelModelPriceTier) int64 {
	if tier.BillingMode == "fixed_request" || tier.BillingMode == "per_second" {
		return tier.UnitPriceMicrocredits
	}
	if tier.OutputTokenPriceMicrocredits > 0 {
		return tier.OutputTokenPriceMicrocredits
	}
	if tier.InputTokenPriceMicrocredits > 0 {
		return tier.InputTokenPriceMicrocredits
	}
	return 0
}

// channelModelMatchesIntent 检查渠道模型是否匹配意图
func (s *Service) channelModelMatchesIntent(cm *model.ChannelModel, intent *ModelRequestIntent) bool {
	if intent.Capability != "" && cm.Capability != intent.Capability {
		return false
	}
	// 这里可以添加更多的能力匹配逻辑
	return true
}

// modelCapabilityConfigToMap 将 ModelCapabilityConfig 转换为 map[string]any
func modelCapabilityConfigToMap(config *ModelCapabilityConfig) map[string]any {
	if config == nil {
		return nil
	}
	encoded, err := json.Marshal(config)
	if err != nil {
		return nil
	}
	var result map[string]any
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil
	}
	return result
}
