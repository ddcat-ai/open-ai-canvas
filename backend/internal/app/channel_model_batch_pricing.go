package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"

	"yingce/backend/internal/model"
)

func batchRequiredAmounts(capability, billingMode string, referenceVideoBilling bool) []string {
	fields := []string{"unitPriceMicrocredits"}
	if billingMode == "token" {
		fields = []string{"inputTokenPriceMicrocredits", "outputTokenPriceMicrocredits", "cachedTokenPriceMicrocredits", "cacheWriteTokenPriceMicrocredits"}
		if capability == "video" {
			fields = []string{"outputTokenPriceMicrocredits"}
		}
	}
	if capability == "video" && referenceVideoBilling {
		if billingMode == "token" {
			fields = append(fields, "referenceVideoOutputTokenPriceMicrocredits")
		} else if billingMode == "per_second" {
			fields = append(fields, "referenceVideoUnitPriceMicrocredits")
		}
	}
	return fields
}

func batchTierAmountsComplete(item model.ChannelModel, tier model.ChannelModelPriceTier) bool {
	amounts := map[string]int64{
		"unitPriceMicrocredits": tier.UnitPriceMicrocredits, "inputTokenPriceMicrocredits": tier.InputTokenPriceMicrocredits,
		"outputTokenPriceMicrocredits": tier.OutputTokenPriceMicrocredits, "cachedTokenPriceMicrocredits": tier.CachedTokenPriceMicrocredits,
		"cacheWriteTokenPriceMicrocredits":    tier.CacheWriteTokenPriceMicrocredits,
		"referenceVideoUnitPriceMicrocredits": tier.ReferenceVideoUnitPriceMicrocredits, "referenceVideoOutputTokenPriceMicrocredits": tier.ReferenceVideoOutputTokenPriceMicrocredits,
	}
	for _, name := range batchRequiredAmounts(item.Capability, tier.BillingMode, item.ReferenceVideoBilling) {
		value := amounts[name]
		// Match priceTierToForm: inactive, unconfigured zero amounts display as
		// empty. A configured zero remains explicit when availability changes.
		if value < 0 || value > 1_000_000_000_000 || (!tier.PriceConfigured && !tier.Enabled && value == 0) {
			return false
		}
	}
	return true
}

func requireBatchAmounts(fields map[string]json.RawMessage, names []string) error {
	for _, name := range names {
		value, ok := fields[name]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return BadAuthRequest("金额字段 " + name + " 必须明确填写，空金额不等于免费")
		}
	}
	return nil
}

func validateBatchPricingTemplate(template *BatchModelPricingTemplate, item model.ChannelModel, upstream string) error {
	if len(template.PriceTiers) == 0 || len(template.PriceTiers) > 48 {
		return BadAuthRequest("积分模板需要 1 到 48 个价格档")
	}
	if template.PriceCurrency != "credits" && template.PriceCurrency != "USD" && template.PriceCurrency != "CNY" {
		return BadAuthRequest("请选择有效的计价货币")
	}
	if item.Capability != "video" && template.ReferenceVideoBilling {
		return BadAuthRequest("只有视频模型可以开启参考视频计费")
	}
	for i, tier := range template.PriceTiers {
		key := strings.TrimPrefix(strings.TrimSpace(tier.ProviderModelKey), "models/")
		if key != "" && key != upstream {
			return BadAuthRequest("积分模板不能包含独立上游型号")
		}
		if template.tierFields == nil {
			continue // Typed in-process requests have explicit numeric values.
		}
		fields := template.tierFields[i]
		if err := requireBatchAmounts(fields, batchRequiredAmounts(item.Capability, tier.BillingMode, template.ReferenceVideoBilling)); err != nil {
			return fmt.Errorf("价格档 %d：%w", i+1, err)
		}
		if tier.CostPricing.Configured {
			var cost map[string]json.RawMessage
			if err := json.Unmarshal(fields["costPricing"], &cost); err != nil {
				return BadAuthRequest("请完整填写积分成本")
			}
			if err := requireBatchAmounts(cost, batchRequiredAmounts(item.Capability, tier.BillingMode, template.ReferenceVideoBilling)); err != nil {
				return err
			}
		}
		var rules []map[string]json.RawMessage
		if raw, ok := fields["tokenPriceRules"]; ok {
			if err := json.Unmarshal(raw, &rules); err != nil {
				return err
			}
		}
		for _, rule := range rules {
			if err := requireBatchAmounts(rule, batchRequiredAmounts("text", "token", false)); err != nil {
				return err
			}
		}
	}
	return nil
}

// Mapping is intentionally complete and validation-only for existing rows.
// Sparse availability/metadata persistence keeps their original bytes/values.
func batchTierRequest(tier model.ChannelModelPriceTier) ChannelModelPriceTierRequest {
	enabled := tier.Enabled
	return ChannelModelPriceTierRequest{
		CostPricing: tier.CostPricing, Selector: tier.Selector, Resolution: tier.Resolution, VideoSeconds: tier.VideoSeconds,
		ProviderModelKey: tier.ProviderModelKey, BillingMode: tier.BillingMode,
		UnitPriceMicrocredits: tier.UnitPriceMicrocredits, InputTokenPriceMicrocredits: tier.InputTokenPriceMicrocredits,
		OutputTokenPriceMicrocredits: tier.OutputTokenPriceMicrocredits, CachedTokenPriceMicrocredits: tier.CachedTokenPriceMicrocredits,
		CacheWriteTokenPriceMicrocredits: tier.CacheWriteTokenPriceMicrocredits,
		TokenPriceRulesEnabled:           tier.TokenPriceRulesEnabled, TokenPriceRules: tier.TokenPriceRules,
		ReferenceVideoUnitPriceMicrocredits: tier.ReferenceVideoUnitPriceMicrocredits, ReferenceVideoOutputTokenPriceMicrocredits: tier.ReferenceVideoOutputTokenPriceMicrocredits,
		PriceConfigured: tier.PriceConfigured, Enabled: &enabled,
	}
}

func batchLegacyPriceTier(item model.ChannelModel) model.ChannelModelPriceTier {
	return model.ChannelModelPriceTier{
		Resolution: "*", BillingMode: item.BillingMode,
		UnitPriceMicrocredits: item.UnitPriceMicrocredits, InputTokenPriceMicrocredits: item.InputTokenPriceMicrocredits,
		OutputTokenPriceMicrocredits: item.OutputTokenPriceMicrocredits, CachedTokenPriceMicrocredits: item.CachedTokenPriceMicrocredits,
		CacheWriteTokenPriceMicrocredits: item.CacheWriteTokenPriceMicrocredits,
		PriceConfigured:                  item.PriceConfigured, Enabled: item.PriceConfigured,
	}
}

func validateBatchFinalPrices(item model.ChannelModel, config *ModelCapabilityConfig) error {
	tiers := item.PriceTiers
	if len(tiers) == 0 {
		// Legacy scalar prices still participate in final validation. This is a
		// read-only projection, not a new persisted tier or a free-price default.
		tiers = []model.ChannelModelPriceTier{batchLegacyPriceTier(item)}
	}
	selectors := make([]map[string]string, 0, len(tiers))
	for _, tier := range tiers {
		input := batchTierRequest(tier)
		if (tier.Enabled || tier.PriceConfigured) && !batchTierAmountsComplete(item, tier) {
			return BadAuthRequest("价格档金额无效，请填写 0 到 1000000 之间的完整金额")
		}
		if err := validateChannelModelTierPricing(item.Capability, item.Protocol, tier.BillingMode, input); err != nil {
			return err
		}
		if _, err := normalizeTokenPriceRules(item.Capability, tier.BillingMode, tier.TokenPriceRulesEnabled, tier.TokenPriceRules); err != nil {
			return err
		}
		selector, _, _, err := normalizeChannelModelTierSelector(item.Capability, input)
		if config != nil && config.Image != nil && config.Image.Parameters != nil {
			selector, _, _, err = normalizeChannelModelTierSelector(item.Capability, input, config.Image.Parameters)
		}
		if err != nil {
			return err
		}
		if err := validateBatchSelectorCapability(selector, item.Capability, config); err != nil {
			return err
		}
		for i, other := range selectors {
			if batchSelectorsOverlapAtSamePriority(selector, other) {
				return BadAuthRequest(fmt.Sprintf("价格档 %d 与 %d 条件重复或同优先级重叠", i+1, len(selectors)+1))
			}
		}
		selectors = append(selectors, selector)
	}
	if err := validateReferenceVideoTierPrices(item.ReferenceVideoBilling, tiers); err != nil {
		return err
	}
	return validateChannelModelTierCapabilities(tiers, item.CapabilityConfigJSON, item.Capability, string(item.Protocol))
}

func batchSelectorsOverlapAtSamePriority(left, right map[string]string) bool {
	requested := make(map[string]string, len(left)+len(right))
	for _, selector := range []map[string]string{left, right} {
		for key, value := range selector {
			value = strings.TrimSpace(value)
			if value == "" || value == "*" {
				continue
			}
			if previous, exists := requested[key]; exists && previous != value {
				return false
			}
			requested[key] = value
		}
	}
	// Use the actual router's match and score. A wildcard is not an extra
	// constraint and must not give an otherwise ambiguous tier priority.
	leftMatches, leftScore := matchSKUSelector(left, requested)
	rightMatches, rightScore := matchSKUSelector(right, requested)
	return leftMatches && rightMatches && leftScore == rightScore
}

func validateBatchSelectorCapability(selector map[string]string, capability string, config *ModelCapabilityConfig) error {
	operation := selector["operation"]
	if operation != "" && operation != "*" {
		operations := []string{}
		switch {
		case capability == "text":
			operations = []string{"text_generation"}
		case capability == "image" && config != nil && config.Image != nil:
			operations = []string{"text_to_image"}
			if config.Image.References.MaxImages > 0 {
				operations = append(operations, "image_to_image")
			}
		case capability == "video" && config != nil && config.Video != nil:
			operations = config.Video.Operations
		}
		if len(operations) > 0 && !containsCapabilityString(operations, operation) {
			return BadAuthRequest("价格档生成方式不受模型能力支持：" + operation)
		}
	}
	if config != nil && config.Video != nil && selector["fpsBand"] != "" && selector["fpsBand"] != "*" && config.Video.Processing == nil {
		return BadAuthRequest("价格档使用了模型未启用的帧率条件")
	}
	if config != nil && config.Image != nil && config.Image.Parameters == nil {
		if size := selector["size"]; size != "" && size != "*" && (config.Image.Size.Parameter == "none" || !config.Image.Size.AllowCustom && !containsCapabilityString(config.Image.Size.Values, size)) {
			return BadAuthRequest("价格档尺寸不受模型能力支持：" + size)
		}
	}
	return nil
}
