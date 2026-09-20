package handler

import "infinite-canvas/backend/internal/model"

// 成本字段只在已通过 service 管理员校验的模型编辑接口中显式投影。
type adminChannelModelPriceTier struct {
	model.ChannelModelPriceTier
	CostPricing model.CreditCostPricing `json:"costPricing"`
}

type adminChannelModelResponse struct {
	model.ChannelModel
	PriceTiers []adminChannelModelPriceTier `json:"priceTiers"`
}

func adminChannelModel(item model.ChannelModel) adminChannelModelResponse {
	tiers := make([]adminChannelModelPriceTier, 0, len(item.PriceTiers))
	for _, tier := range item.PriceTiers {
		tiers = append(tiers, adminChannelModelPriceTier{ChannelModelPriceTier: tier, CostPricing: tier.CostPricing})
	}
	return adminChannelModelResponse{ChannelModel: item, PriceTiers: tiers}
}
