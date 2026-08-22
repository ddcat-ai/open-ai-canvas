package service

import "infinite-canvas/backend/internal/model"

// ValidateChannelModelPrice 校验渠道模型价格配置的有效性
// 根据 billingMode 检查必要的价格字段是否已配置
func ValidateChannelModelPrice(billingMode string, capability string, protocol model.ChannelInterfaceType, unitPrice, inputPrice, outputPrice, cachedPrice int64) bool {
	switch billingMode {
	case "fixed_request":
		// 固定价格模式：必须配置单价且大于 0
		return unitPrice > 0
	case "per_second":
		// 按秒计费：必须配置单价且大于 0
		return unitPrice > 0
	case "token":
		// Token 计费：根据协议要求校验
		if capability == "video" && (protocol == model.ChannelInterfaceVolcengineArkVideo || protocol == model.ChannelInterfaceVolcengineJiMengVideo) {
			// 火山方舟视频必须配置输出价格
			return outputPrice > 0
		}
		// 文本模型：至少配置一项价格
		return inputPrice > 0 || outputPrice > 0 || cachedPrice > 0
	default:
		return false
	}
}

// ValidatePriceTierPrice 校验价格档的价格配置有效性
func ValidatePriceTierPrice(tier *model.ChannelModelPriceTier) bool {
	if tier == nil {
		return false
	}
	return ValidateChannelModelPrice(tier.BillingMode, "", "", tier.UnitPriceMicrocredits, tier.InputTokenPriceMicrocredits, tier.OutputTokenPriceMicrocredits, tier.CachedTokenPriceMicrocredits)
}

// ComputePriceConfigured 根据价格内容计算 PriceConfigured 标志
// 不再允许手动设置 PriceConfigured，必须由价格字段派生
func ComputePriceConfigured(billingMode string, capability string, protocol model.ChannelInterfaceType, unitPrice, inputPrice, outputPrice, cachedPrice int64) bool {
	return ValidateChannelModelPrice(billingMode, capability, protocol, unitPrice, inputPrice, outputPrice, cachedPrice)
}

// ComputeTierPriceConfigured 计算价格档的 PriceConfigured 标志
func ComputeTierPriceConfigured(tier *model.ChannelModelPriceTier) bool {
	if tier == nil {
		return false
	}
	return ComputePriceConfigured(tier.BillingMode, "", "", tier.UnitPriceMicrocredits, tier.InputTokenPriceMicrocredits, tier.OutputTokenPriceMicrocredits, tier.CachedTokenPriceMicrocredits)
}

// HasValidPrice 检查渠道模型是否有有效价格
// 对于有价格档的模型，检查是否至少有一个启用且价格有效的价格档
func HasValidPrice(channelModel *model.ChannelModel) bool {
	if channelModel == nil {
		return false
	}

	// 如果有价格档，检查价格档
	if len(channelModel.PriceTiers) > 0 {
		for _, tier := range channelModel.PriceTiers {
			if tier.Enabled && ValidatePriceTierPrice(&tier) {
				return true
			}
		}
		return false
	}

	// 否则检查模型级别的价格
	return ValidateChannelModelPrice(channelModel.BillingMode, channelModel.Capability, channelModel.Protocol, channelModel.UnitPriceMicrocredits, channelModel.InputTokenPriceMicrocredits, channelModel.OutputTokenPriceMicrocredits, channelModel.CachedTokenPriceMicrocredits)
}

// ValidateLogicalModelPrice 校验前台模型的价格配置
func ValidateLogicalModelPrice(pricePolicy string, billingMode string, unitPrice, inputPrice, outputPrice, cachedPrice int64) bool {
	if pricePolicy == "channel" {
		// 跟随渠道价格，不需要校验前台价格
		return true
	}
	// 统一定价模式，按 billingMode 校验
	return ValidateChannelModelPrice(billingMode, "", "", unitPrice, inputPrice, outputPrice, cachedPrice)
}
