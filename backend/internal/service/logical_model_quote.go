package service

import "infinite-canvas/backend/internal/model"

// LogicalModelQuote 是创作端当前参数命中的实际供应线路报价。
// Token 视频在上游返回真实 usage 前只能预估，创建任务仍以账务预留逻辑为准。
type LogicalModelQuote struct {
	LogicalModelID     string `json:"logicalModelId"`
	BillingMode        string `json:"billingMode"`
	Quantity           int64  `json:"quantity"`
	AmountMicrocredits int64  `json:"amountMicrocredits"`
	Estimated          bool   `json:"estimated"`
}

func (s *Service) QuoteLogicalModel(logicalModelID string, intent ModelRequestIntent) (*LogicalModelQuote, error) {
	routed, err := s.ResolveLogicalModel(logicalModelID, intent)
	if err != nil {
		return nil, err
	}
	capability := normalizeCapability(intent.Capability)
	if capability == "" {
		return nil, BadAuthRequest("报价请求缺少模型能力类型")
	}
	resolvedIntent := intent
	resolvedIntent.Options = mergeIntentDefaults(intent.Options, routed.Defaults)
	input := quoteInput(resolvedIntent, routed.ChannelModel.ModelKey)
	quantity := billingQuantity(capability, inputConfigValue(input, "videoSeconds"))
	if capability != "video" {
		quantity = 1
	}
	tokenEstimate := estimateTaskBillingTokens(input, capability)

	if routed.LogicalModel.PricePolicy == "channel" {
		priceTierID := ""
		if routed.PriceTier != nil {
			priceTierID = routed.PriceTier.ID
		}
		order, billingErr := s.newBillingOrderWithPriceTier("", "", "quote", routed.ChannelModel.ChannelID, routed.ChannelModel.ModelKey, capability, "model_quote", quantity, tokenEstimate, priceTierID)
		if billingErr != nil {
			return nil, billingErr
		}
		return &LogicalModelQuote{
			LogicalModelID:     routed.LogicalModel.ID,
			BillingMode:        order.BillingMode,
			Quantity:           order.Quantity,
			AmountMicrocredits: order.AmountMicrocredits,
			Estimated:          order.BillingMode == "token",
		}, nil
	}

	if routed.LogicalModel.PricePolicy != "unified" {
		return nil, BadAuthRequest("当前模型价格策略无效")
	}
	amount := int64(0)
	switch routed.LogicalModel.BillingMode {
	case "fixed_request":
		quantity = 1
		amount = routed.LogicalModel.UnitPriceMicrocredits
	case "per_second":
		if capability != "video" || quantity <= 0 {
			return nil, BadAuthRequest("当前模型按时长计费，但请求未提供有效时长")
		}
		amount, err = creditAmount(routed.LogicalModel.UnitPriceMicrocredits, quantity, 10_000)
	case "token":
		if routed.ChannelModel.Capability != capability || !supportsTokenBilling(capability, routed.ChannelModel.Protocol) {
			return nil, BadAuthRequest("当前供应线路不支持前台模型的 Token 计费方式")
		}
		pricing := &model.ChannelModel{
			InputTokenPriceMicrocredits:  routed.LogicalModel.InputPriceMicrocredits,
			OutputTokenPriceMicrocredits: routed.LogicalModel.OutputPriceMicrocredits,
			CachedTokenPriceMicrocredits: routed.LogicalModel.CachedPriceMicrocredits,
		}
		amount, err = tokenEstimateAmount(pricing, tokenEstimate, 10_000)
		quantity = tokenEstimate.InputTokens + tokenEstimate.OutputTokens
	default:
		return nil, BadAuthRequest("当前模型计费方式暂不支持")
	}
	if err != nil {
		return nil, err
	}
	if amount <= 0 {
		return nil, BadAuthRequest("当前模型尚未配置有效的用户价格")
	}
	return &LogicalModelQuote{
		LogicalModelID:     routed.LogicalModel.ID,
		BillingMode:        routed.LogicalModel.BillingMode,
		Quantity:           quantity,
		AmountMicrocredits: amount,
		Estimated:          routed.LogicalModel.BillingMode == "token",
	}, nil
}

func quoteInput(intent ModelRequestIntent, modelKey string) map[string]any {
	config := make(map[string]any, len(intent.Options)+1)
	for key, value := range intent.Options {
		config[key] = value
	}
	config["model"] = modelKey
	input := map[string]any{"mode": intent.Capability, "config": config}
	if count := intent.Inputs["video"]; count > 0 {
		references := make([]any, count)
		input["referenceVideos"] = references
	}
	return input
}

func inputConfigValue(input map[string]any, key string) any {
	config, _ := input["config"].(map[string]any)
	if config == nil {
		return nil
	}
	return config[key]
}
