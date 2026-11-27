package app

import "yingce/backend/internal/model"

// 成本仅向后台核验入口投影，供 MCP 写入价格后核对；普通模型列表继续隐藏成本。
type AdminChannelModelCostTier struct {
	ID                                         string                  `json:"id"`
	Selector                                   map[string]string       `json:"selector,omitempty"`
	Resolution                                 string                  `json:"resolution,omitempty"`
	VideoSeconds                               int                     `json:"videoSeconds,omitempty"`
	BillingMode                                string                  `json:"billingMode"`
	ProviderModelKey                           string                  `json:"providerModelKey,omitempty"`
	CostPricing                                model.CreditCostPricing `json:"costPricing"`
	UnitPriceMicrocredits                      int64                   `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits                int64                   `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits               int64                   `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits               int64                   `json:"cachedTokenPriceMicrocredits"`
	CacheWriteTokenPriceMicrocredits           int64                   `json:"cacheWriteTokenPriceMicrocredits"`
	ReferenceVideoUnitPriceMicrocredits        int64                   `json:"referenceVideoUnitPriceMicrocredits"`
	ReferenceVideoOutputTokenPriceMicrocredits int64                   `json:"referenceVideoOutputTokenPriceMicrocredits"`
	ImagePricing                               *model.ImagePricing     `json:"imagePricing,omitempty"`
	PriceConfigured                            bool                    `json:"priceConfigured"`
	Enabled                                    bool                    `json:"enabled"`
}

type AdminChannelModelCost struct {
	ID               string                      `json:"id"`
	ChannelID        string                      `json:"channelId"`
	ChannelName      string                      `json:"channelName"`
	ModelKey         string                      `json:"modelKey"`
	ProviderModelKey string                      `json:"providerModelKey"`
	DisplayName      string                      `json:"displayName"`
	ChannelLabel     string                      `json:"channelLabel"`
	Capability       string                      `json:"capability"`
	PriceCurrency    string                      `json:"priceCurrency"`
	PriceVersion     int64                       `json:"priceVersion"`
	Enabled          bool                        `json:"enabled"`
	PriceTiers       []AdminChannelModelCostTier `json:"priceTiers"`
}

// 独立的只读成本入口便于单独授权和审计，不扩大普通列表的数据可见范围。
func (s *Service) AdminChannelModelCosts(actor *model.User) ([]AdminChannelModelCost, error) {
	items, err := s.AdminAllChannelModels(actor)
	if err != nil {
		return nil, err
	}
	out := make([]AdminChannelModelCost, 0, len(items))
	for _, item := range items {
		tiers := make([]AdminChannelModelCostTier, 0, len(item.PriceTiers))
		for _, tier := range item.PriceTiers {
			tiers = append(tiers, AdminChannelModelCostTier{
				ID:                                  tier.ID,
				Selector:                            tier.Selector,
				Resolution:                          tier.Resolution,
				VideoSeconds:                        tier.VideoSeconds,
				BillingMode:                         tier.BillingMode,
				ProviderModelKey:                    tier.ProviderModelKey,
				CostPricing:                         tier.CostPricing,
				UnitPriceMicrocredits:               tier.UnitPriceMicrocredits,
				InputTokenPriceMicrocredits:         tier.InputTokenPriceMicrocredits,
				OutputTokenPriceMicrocredits:        tier.OutputTokenPriceMicrocredits,
				CachedTokenPriceMicrocredits:        tier.CachedTokenPriceMicrocredits,
				CacheWriteTokenPriceMicrocredits:    tier.CacheWriteTokenPriceMicrocredits,
				ReferenceVideoUnitPriceMicrocredits: tier.ReferenceVideoUnitPriceMicrocredits,
				ReferenceVideoOutputTokenPriceMicrocredits: tier.ReferenceVideoOutputTokenPriceMicrocredits,
				ImagePricing:    tier.ImagePricing,
				PriceConfigured: tier.PriceConfigured,
				Enabled:         tier.Enabled,
			})
		}
		out = append(out, AdminChannelModelCost{
			ID:               item.ID,
			ChannelID:        item.ChannelID,
			ChannelName:      item.ChannelName,
			ModelKey:         item.ModelKey,
			ProviderModelKey: item.ProviderModelKey,
			DisplayName:      item.DisplayName,
			ChannelLabel:     item.ChannelLabel,
			Capability:       item.Capability,
			PriceCurrency:    item.PriceCurrency,
			PriceVersion:     item.PriceVersion,
			Enabled:          item.Enabled,
			PriceTiers:       tiers,
		})
	}
	return out, nil
}
