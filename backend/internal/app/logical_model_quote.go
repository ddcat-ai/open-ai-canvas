package app

import (
	"strings"

	"infinite-canvas/backend/internal/model"
)

// LogicalModelQuote 是创作端当前参数命中的实际供应线路报价。
// Token 视频在上游返回真实 usage 前只能预估，创建任务仍以账务预留逻辑为准。
type LogicalModelQuote struct {
	LogicalModelID     string              `json:"logicalModelId"`
	BillingMode        string              `json:"billingMode"`
	Quantity           int64               `json:"quantity"`
	AmountMicrocredits int64               `json:"amountMicrocredits"`
	Estimated          bool                `json:"estimated"`
	VideoTokenEstimate *VideoTokenEstimate `json:"videoTokenEstimate,omitempty"`
}

type ChannelModelQuoteRequest struct {
	ChannelID string             `json:"channelId"`
	ModelKey  string             `json:"modelKey"`
	Intent    ModelRequestIntent `json:"intent"`
}

// QuoteChannelModel uses the same admission/defaults/SKU selection as task
// creation, without reserving credits or submitting a provider request.
func (s *Service) QuoteChannelModel(req ChannelModelQuoteRequest) (*LogicalModelQuote, error) {
	if strings.TrimSpace(req.ChannelID) == "" || strings.TrimSpace(req.ModelKey) == "" {
		return nil, InvalidModelSelection("报价必须指定系统渠道和模型")
	}
	if err := validateQuoteIntent(req.Intent); err != nil {
		return nil, err
	}
	input := quoteInput(req.Intent, req.ModelKey)
	config := input["config"].(map[string]any)
	config["channelId"] = req.ChannelID
	input, err := s.resolveSystemChannelModelSelection(input, "canvas_"+req.Intent.Capability, req.Intent.Operation)
	if err != nil {
		return nil, err
	}
	config = input["config"].(map[string]any)
	estimate := estimateTaskBillingTokens(input, req.Intent.Capability)
	intent := ModelRequestIntentFromTaskInput(input, "canvas_"+req.Intent.Capability, req.Intent.Operation)
	order, err := s.newBillingOrderWithPriceTier("", "", "quote", req.ChannelID, req.ModelKey, req.Intent.Capability, "model_quote", billingQuantity(req.Intent.Capability, config["videoSeconds"]), estimate, stringValue(config["priceTierId"]), intent)
	if err != nil {
		return nil, err
	}
	return quoteFromOrder("", order, estimate), nil
}

func validateQuoteIntent(intent ModelRequestIntent) error {
	if intent.Capability != "text" && intent.Capability != "image" && intent.Capability != "video" && intent.Capability != "audio" {
		return BadAuthRequest("报价请求缺少有效的模型能力类型")
	}
	for _, count := range intent.Inputs {
		if count < 0 || count > 128 {
			return BadAuthRequest("报价参考素材数量必须为 0 到 128 的整数")
		}
	}
	return nil
}

func quoteFromOrder(logicalModelID string, order *model.BillingOrder, estimate tokenBillingEstimate) *LogicalModelQuote {
	quote := &LogicalModelQuote{LogicalModelID: logicalModelID, BillingMode: order.BillingMode, Quantity: order.Quantity, AmountMicrocredits: order.AmountMicrocredits, Estimated: order.BillingMode == "token"}
	if order.BillingMode == "token" && order.Capability == "video" {
		quote.VideoTokenEstimate = estimate.Video
	}
	return quote
}

func (s *Service) QuoteLogicalModel(logicalModelID string, intent ModelRequestIntent) (*LogicalModelQuote, error) {
	if err := validateQuoteIntent(intent); err != nil {
		return nil, err
	}
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
	providerModelKey := routed.ChannelModel.ProviderModelKey
	if routed.PriceTier != nil {
		providerModelKey = firstNonEmpty(routed.PriceTier.ProviderModelKey, providerModelKey)
	}
	input["config"].(map[string]any)["providerModelKey"] = providerModelKey
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
		return quoteFromOrder(routed.LogicalModel.ID, order, tokenEstimate), nil
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
		if capability == "video" && (routed.LogicalModel.InputPriceMicrocredits != 0 || routed.LogicalModel.CachedPriceMicrocredits != 0) {
			return nil, BadAuthRequest("视频 Token 仅按视频用量定价，请将输入与缓存价格设为 0")
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
	if amount < 0 {
		return nil, BadAuthRequest("当前模型尚未配置有效的用户价格")
	}
	quote := &LogicalModelQuote{
		LogicalModelID:     routed.LogicalModel.ID,
		BillingMode:        routed.LogicalModel.BillingMode,
		Quantity:           quantity,
		AmountMicrocredits: amount,
		Estimated:          routed.LogicalModel.BillingMode == "token",
	}
	if quote.Estimated && capability == "video" {
		quote.VideoTokenEstimate = tokenEstimate.Video
	}
	return quote, nil
}

func quoteInput(intent ModelRequestIntent, modelKey string) map[string]any {
	config := make(map[string]any, len(intent.Options)+1)
	for key, value := range intent.Options {
		config[key] = value
	}
	config["model"] = modelKey
	input := map[string]any{"mode": intent.Capability, "config": config}
	for kind, key := range map[string]string{"image": "referenceImages", "video": "referenceVideos", "audio": "referenceAudios"} {
		if count := intent.Inputs[kind]; count > 0 {
			input[key] = make([]any, count)
		}
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
