// 渠道模型价格档：选择器规范化、档位能力与计价校验、摘要回填。

package app

import (
	"fmt"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/model"
)

func validateChannelModelTierCapabilities(tiers []model.ChannelModelPriceTier, rawCapabilityConfig string, capability string) error {
	if capability != "video" {
		return nil
	}
	config, err := DecodeModelCapabilityConfig(rawCapabilityConfig)
	if err != nil || config == nil || config.Video == nil {
		return BadAuthRequest("视频模型能力配置无效，无法校验价格档规格")
	}
	resolutionSupported := make(map[string]bool, len(config.Video.Resolutions))
	for _, resolution := range config.Video.Resolutions {
		resolutionSupported[normalizeChannelModelTierResolution(resolution)] = true
	}
	for _, tier := range tiers {
		if tier.Resolution != "*" && !resolutionSupported[normalizeChannelModelTierResolution(tier.Resolution)] {
			return BadAuthRequest("价格档分辨率不在该视频模型支持范围内：" + tier.Resolution)
		}
		if tier.VideoSeconds == 0 {
			continue
		}
		duration := config.Video.Duration
		if tier.Resolution != "*" {
			duration = videoDurationConfigForResolution(config.Video, tier.Resolution)
		}
		if !videoDurationSupportedForConfig(duration) {
			continue
		}
		if duration.Selection == "enum" && !containsInt(duration.Values, tier.VideoSeconds) {
			return BadAuthRequest(fmt.Sprintf("价格档时长 %d 秒不在该视频模型支持范围内", tier.VideoSeconds))
		}
		if duration.Selection == "range" && (tier.VideoSeconds < duration.Min || tier.VideoSeconds > duration.Max || (duration.Step > 0 && (tier.VideoSeconds-duration.Min)%duration.Step != 0)) {
			return BadAuthRequest(fmt.Sprintf("价格档时长 %d 秒不在该视频模型支持范围内", tier.VideoSeconds))
		}
	}
	return nil
}

func videoDurationSupportedForConfig(config VideoDurationConfig) bool {
	if config.Selection == "enum" {
		return len(config.Values) > 0
	}
	return config.Min > 0 && config.Max >= config.Min && config.Step > 0
}

// syncLogicalModelsFromChannelModel 只失效路由目录。系统渠道 SKU 与前台模型目录
// 分别维护：保存渠道模型绝不能自动创建、覆盖或删除前台模型及其线路配置。
func (s *Service) syncLogicalModelsFromChannelModel(actor *model.User, channelModel *model.ChannelModel) error {
	_ = actor
	_ = channelModel
	s.invalidateRouteCatalog()
	return nil
}

func supportsTokenBilling(capability string, _ model.ChannelInterfaceType) bool {
	return capability == "text" || capability == "video"
}

func (s *Service) normalizeChannelModelPriceTiers(req ChannelModelRequest, capability string, protocol model.ChannelInterfaceType, fallbackProviderModelKey string) ([]model.ChannelModelPriceTier, error) {
	inputs := req.PriceTiers
	// 兼容旧管理 API：没有 priceTiers 的请求等价于一个默认价格档。
	if len(inputs) == 0 {
		enabled := true
		inputs = []ChannelModelPriceTierRequest{{
			Resolution: "*", VideoSeconds: 0, ProviderModelKey: fallbackProviderModelKey,
			BillingMode: req.BillingMode, UnitPriceMicrocredits: req.UnitPriceMicrocredits,
			InputTokenPriceMicrocredits: req.InputTokenPriceMicrocredits, OutputTokenPriceMicrocredits: req.OutputTokenPriceMicrocredits,
			CachedTokenPriceMicrocredits: req.CachedTokenPriceMicrocredits, PriceConfigured: req.PriceConfigured, Enabled: &enabled,
		}}
	}
	result := make([]model.ChannelModelPriceTier, 0, len(inputs))
	seen := make(map[string]bool, len(inputs))
	for _, input := range inputs {
		selector, resolution, videoSeconds, selectorErr := normalizeChannelModelTierSelector(capability, input)
		if selectorErr != nil {
			return nil, selectorErr
		}
		_, key, keyErr := model.CanonicalSKUSelector(selector)
		if keyErr != nil {
			return nil, keyErr
		}
		if seen[key] {
			return nil, BadAuthRequest("同一个操作和规格组合只能配置一个价格档")
		}
		seen[key] = true
		billingMode := strings.TrimSpace(input.BillingMode)
		if billingMode == "" {
			billingMode = "fixed_request"
		}
		if err := validateChannelModelTierPricing(capability, protocol, billingMode, input); err != nil {
			return nil, err
		}
		timePricing, err := normalizeChannelTimePricing(input.TimePricing)
		if err != nil {
			return nil, BadAuthRequest(err.Error())
		}
		id, idErr := s.repo.NextPrefixedID("PTIER")
		if idErr != nil {
			return nil, idErr
		}
		enabled := input.Enabled == nil || *input.Enabled
		result = append(result, model.ChannelModelPriceTier{
			CostPricing:                  input.CostPricing,
			ID:                           id,
			SelectorKey:                  key,
			SelectorJSON:                 key,
			Selector:                     selector,
			Resolution:                   resolution,
			VideoSeconds:                 videoSeconds,
			ProviderModelKey:             strings.TrimPrefix(strings.TrimSpace(firstNonEmpty(input.ProviderModelKey, fallbackProviderModelKey)), "models/"),
			BillingMode:                  billingMode,
			UnitPriceMicrocredits:        input.UnitPriceMicrocredits,
			InputTokenPriceMicrocredits:  input.InputTokenPriceMicrocredits,
			OutputTokenPriceMicrocredits: input.OutputTokenPriceMicrocredits,
			CachedTokenPriceMicrocredits: input.CachedTokenPriceMicrocredits,
			TimePricing:                  timePricing,
			PriceConfigured:              input.PriceConfigured,
			Enabled:                      enabled,
			PriceVersion:                 1,
		})
	}
	return result, nil
}

func normalizeChannelModelTierSelector(capability string, input ChannelModelPriceTierRequest) (map[string]string, string, int, error) {
	selector := make(map[string]string, len(input.Selector)+3)
	for rawKey, rawValue := range input.Selector {
		key := strings.TrimSpace(rawKey)
		value := strings.TrimSpace(rawValue)
		if key == "" || value == "" {
			continue
		}
		switch key {
		case "operation":
			value = strings.ToLower(value)
		case "quality", "size":
			value = strings.ToLower(value)
			if value == "auto" || value == "any" {
				value = "*"
			}
		case "vquality":
			value = normalizeChannelModelTierResolution(value)
		case "videoSeconds":
			seconds, err := strconv.Atoi(value)
			if err != nil || seconds < 0 {
				return nil, "", 0, BadAuthRequest("视频价格档时长必须是非负整数")
			}
			if seconds == 0 {
				continue
			}
			value = strconv.Itoa(seconds)
		case "imageCount":
			count, err := strconv.Atoi(value)
			if err != nil || count < 0 {
				return nil, "", 0, BadAuthRequest("参考图片数量必须是非负整数")
			}
			if count == 0 {
				continue
			}
			value = strconv.Itoa(count)
		case "videoGenerateAudio":
			if capability != "video" {
				return nil, "", 0, BadAuthRequest("只有视频模型可以按是否生成音频配置价格档")
			}
			value = strings.ToLower(value)
			if value == "*" {
				continue
			}
			if value != "true" && value != "false" {
				return nil, "", 0, BadAuthRequest("视频价格档音频条件必须为 true、false 或 *")
			}
		default:
			return nil, "", 0, BadAuthRequest("价格档不支持规格字段：" + key)
		}
		selector[key] = value
	}
	if capability == "video" {
		if _, exists := selector["vquality"]; !exists {
			if resolution := normalizeChannelModelTierResolution(input.Resolution); resolution != "*" {
				selector["vquality"] = resolution
			}
		}
		if _, exists := selector["videoSeconds"]; !exists && input.VideoSeconds > 0 {
			selector["videoSeconds"] = strconv.Itoa(input.VideoSeconds)
		}
	} else if input.Resolution != "" && normalizeChannelModelTierResolution(input.Resolution) != "*" {
		return nil, "", 0, BadAuthRequest("非视频模型不能使用视频分辨率价格档")
	} else if input.VideoSeconds != 0 {
		return nil, "", 0, BadAuthRequest("非视频模型不能使用视频时长价格档")
	}
	for _, key := range []string{"quality", "size"} {
		if _, exists := selector[key]; exists && capability != "image" {
			return nil, "", 0, BadAuthRequest("只有图片模型可以按 " + key + " 配置价格档")
		}
	}
	if _, exists := selector["vquality"]; exists && capability != "video" {
		return nil, "", 0, BadAuthRequest("只有视频模型可以按分辨率配置价格档")
	}
	if _, exists := selector["videoSeconds"]; exists && capability != "video" {
		return nil, "", 0, BadAuthRequest("只有视频模型可以按时长配置价格档")
	}
	if _, exists := selector["imageCount"]; exists && capability != "video" {
		return nil, "", 0, BadAuthRequest("只有视频模型可以按参考图片数量配置价格档")
	}
	resolution := "*"
	if value := selector["vquality"]; value != "" {
		resolution = value
	}
	videoSeconds := 0
	if value := selector["videoSeconds"]; value != "" {
		videoSeconds, _ = strconv.Atoi(value)
	}
	return selector, resolution, videoSeconds, nil
}

func validateChannelModelTierPricing(capability string, protocol model.ChannelInterfaceType, billingMode string, input ChannelModelPriceTierRequest) error {
	if err := validateCreditCostPricing(capability, billingMode, input.CostPricing); err != nil {
		return err
	}
	if billingMode != "fixed_request" && billingMode != "per_second" && billingMode != "token" {
		return BadAuthRequest("模型计费方式仅支持按次、按秒或 Token")
	}
	if billingMode == "per_second" && capability != "video" && capability != "audio" {
		return BadAuthRequest("只有视频或音频模型可以按秒计费")
	}
	if billingMode == "token" && !supportsTokenBilling(capability, protocol) {
		return BadAuthRequest("Token 计费仅支持文本和视频模型")
	}
	if input.UnitPriceMicrocredits < 0 || input.InputTokenPriceMicrocredits < 0 || input.OutputTokenPriceMicrocredits < 0 || input.CachedTokenPriceMicrocredits < 0 {
		return BadAuthRequest("模型积分价格不能小于 0")
	}
	if billingMode == "token" {
		return validateTokenPrices(capability, input.InputTokenPriceMicrocredits, input.OutputTokenPriceMicrocredits, input.CachedTokenPriceMicrocredits)
	}
	return validateTokenPrices("", input.InputTokenPriceMicrocredits, input.OutputTokenPriceMicrocredits, input.CachedTokenPriceMicrocredits)
}

func normalizeChannelModelTierResolution(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" || value == "*" || strings.EqualFold(value, "any") {
		return "*"
	}
	normalized := normalizeModelRequestOption("vquality", value)
	return strings.ToLower(strings.TrimSpace(fmt.Sprint(normalized)))
}

func (s *Service) applyChannelModelPriceTierSummary(item *model.ChannelModel, tiers []model.ChannelModelPriceTier) {
	item.PriceConfigured = false
	item.BillingMode = "fixed_request"
	item.UnitPriceMicrocredits = 0
	item.InputTokenPriceMicrocredits = 0
	item.OutputTokenPriceMicrocredits = 0
	item.CachedTokenPriceMicrocredits = 0
	var summary *model.ChannelModelPriceTier
	for index := range tiers {
		tier := &tiers[index]
		if tier.Enabled && tier.PriceConfigured {
			item.PriceConfigured = true
		}
		if summary == nil || (tier.Resolution == "*" && tier.VideoSeconds == 0) {
			summary = tier
		}
	}
	if summary == nil {
		return
	}
	item.BillingMode = summary.BillingMode
	item.UnitPriceMicrocredits = summary.UnitPriceMicrocredits
	item.InputTokenPriceMicrocredits = summary.InputTokenPriceMicrocredits
	item.OutputTokenPriceMicrocredits = summary.OutputTokenPriceMicrocredits
	item.CachedTokenPriceMicrocredits = summary.CachedTokenPriceMicrocredits
}
