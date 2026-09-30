// 逻辑模型的前台目录与价格展示：把后台配置的逻辑模型投影成用户可见的列表和价格档。

package app

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/model"
)

func (s *Service) PublicLogicalModels(intent *ModelRequestIntent) ([]PublicLogicalModel, error) {
	snapshot, err := s.routeCatalogSnapshot()
	if err != nil {
		return nil, err
	}
	result := make([]PublicLogicalModel, 0, len(snapshot.Ordered))
	for _, id := range snapshot.Ordered {
		cached := snapshot.Models[id]
		structuralSpecs := availableCachedRouteSpecs(cached.Routes)
		coverageValid := logicalModelCapabilityCovered(cached.ProductSpec, structuralSpecs)
		available := coverageValid && hasHealthyCachedRoute(s, cached.Routes)
		if intent != nil {
			resolvedIntent := *intent
			resolvedIntent.Options = mergeIntentDefaults(intent.Options, cached.Defaults)
			productMatch := MatchCapability(cached.ProductSpec, resolvedIntent)
			if !productMatch.Matched {
				continue
			}
			available = false
			if coverageValid {
				for _, route := range cached.Routes {
					if route.Route.Enabled && route.Route.Weight > 0 && !s.logicalRouteBlocked(route) && MatchCapability(route.CapabilitySpec, resolvedIntent).Matched && (cached.Model.PricePolicy != "channel" || channelModelPriceTierForIntent(route.ChannelModel, resolvedIntent) != nil) {
						available = true
						break
					}
				}
			}
		}
		result = append(result, publicLogicalModel(cached, available))
	}
	return result, nil
}

func publicLogicalModel(cached cachedLogicalModel, available bool) PublicLogicalModel {
	item := cached.Model
	productSpec := capabilitySpecWithRoutePresets(cached.ProductSpec, enabledLogicalRouteSpecs(cached.Routes))
	profiles := make([]CapabilitySpec, 0, len(cached.Routes))
	seen := make(map[string]bool, len(cached.Routes))
	for _, route := range cached.Routes {
		if !route.Route.Enabled || route.Route.Weight <= 0 {
			continue
		}
		key := capabilityFingerprint(route.CapabilitySpec)
		if !seen[key] {
			seen[key] = true
			profiles = append(profiles, route.CapabilitySpec)
		}
	}

	priceTiers := publicLogicalModelPriceTiers(cached)
	pricingMode, displayPrice, priceLabel := computeModelPriceDisplay(item, priceTiers)

	return PublicLogicalModel{
		ID: item.ID, Code: item.Code, Name: item.Name, Icon: item.Icon,
		Description: item.Description, Capability: item.Capability, SortOrder: item.SortOrder,
		PricePolicy: item.PricePolicy, PricingMode: pricingMode, DisplayPrice: displayPrice,
		PriceLabel: priceLabel, BillingMode: item.BillingMode,
		UnitPriceMicrocredits:   item.UnitPriceMicrocredits,
		InputPriceMicrocredits:  item.InputPriceMicrocredits,
		OutputPriceMicrocredits: item.OutputPriceMicrocredits,
		CachedPriceMicrocredits: item.CachedPriceMicrocredits,
		PriceTiers:              priceTiers, LegacyModelIDs: decodeLegacyModelIDs(item.LegacyModelIDsJSON),
		CapabilitySpec: productSpec, CapabilityProfiles: profiles,
		DefaultOptions: cached.Defaults, Available: available,
	}
}

func publicLogicalModelPriceTiers(cached cachedLogicalModel) []PublicLogicalModelPriceTier {
	if cached.Model.PricePolicy != "channel" {
		return []PublicLogicalModelPriceTier{}
	}
	result := make([]PublicLogicalModelPriceTier, 0)
	seen := make(map[string]bool)
	for _, route := range cached.Routes {
		if !route.Route.Enabled || route.Route.Weight <= 0 {
			continue
		}
		for _, tier := range route.ChannelModel.PriceTiers {
			if !tier.Enabled || !tier.PriceConfigured {
				continue
			}
			selector := skuSelectorForTier(tier)
			_, selectorKey, selectorErr := model.CanonicalSKUSelector(selector)
			if selectorErr != nil {
				continue
			}
			key := fmt.Sprintf("%s:%s:%d:%d:%d:%d", selectorKey, tier.BillingMode, tier.UnitPriceMicrocredits, tier.InputTokenPriceMicrocredits, tier.OutputTokenPriceMicrocredits, tier.CachedTokenPriceMicrocredits)
			if seen[key] {
				continue
			}
			seen[key] = true
			result = append(result, PublicLogicalModelPriceTier{Selector: selector, Resolution: normalizeChannelModelTierResolution(tier.Resolution), VideoSeconds: tier.VideoSeconds, BillingMode: tier.BillingMode, UnitPriceMicrocredits: tier.UnitPriceMicrocredits, InputTokenPriceMicrocredits: tier.InputTokenPriceMicrocredits, OutputTokenPriceMicrocredits: tier.OutputTokenPriceMicrocredits, CachedTokenPriceMicrocredits: tier.CachedTokenPriceMicrocredits})
		}
	}
	return result
}

func decodeLegacyModelIDs(raw string) []string {
	var values []string
	if err := json.Unmarshal([]byte(raw), &values); err != nil {
		return []string{}
	}
	return normalizeLegacyModelIDs(values)
}

func normalizeLegacyModelIDs(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func enabledLogicalRouteSpecs(routes []cachedLogicalRoute) []CapabilitySpec {
	specs := make([]CapabilitySpec, 0, len(routes))
	for _, route := range routes {
		if !route.Route.Enabled || route.Route.Weight <= 0 {
			continue
		}
		specs = append(specs, route.CapabilitySpec)
	}
	return specs
}

// capabilitySpecWithRoutePresets repairs old front-model snapshots that stored
// only `*` for a custom size. The wildcard remains for matching custom values,
// while route presets are restored for admin and creator-side selectors.
// Callers must pass only currently enabled routes; disabled or zero-weight
// routes would otherwise advertise size tiers the public catalog cannot route.
func capabilitySpecWithRoutePresets(spec CapabilitySpec, routes []CapabilitySpec) CapabilitySpec {
	result := spec
	result.Options = make(map[string]OptionConstraint, len(spec.Options))
	for name, constraint := range spec.Options {
		if !isWildcardOptionConstraint(constraint) {
			result.Options[name] = constraint
			continue
		}
		values := append([]any(nil), constraint.Values...)
		seen := make(map[string]bool, len(values))
		for _, value := range values {
			seen[normalizedScalar(value)] = true
		}
		for _, route := range routes {
			for _, value := range route.Options[name].Values {
				key := normalizedScalar(value)
				if key != "" && !seen[key] {
					seen[key] = true
					values = append(values, value)
				}
			}
		}
		result.Options[name] = OptionConstraint{Values: values}
	}
	// 前台规格里的预设可能只来自单条线路的快照（后续新增的供应线路还没同步进来），
	// 因此不管自身是否已有预设都要与各线路取并集，否则多档会被压成单档。
	if merged := mergeCapabilityImageSize(append([]CapabilitySpec{spec}, routes...)); merged != nil {
		if result.ImageSize == nil {
			result.ImageSize = merged
		} else {
			restored := *result.ImageSize
			if restored.Parameter == "" {
				restored.Parameter = merged.Parameter
			}
			if !restored.AllowCustom {
				restored.AllowCustom = merged.AllowCustom
			}
			restored.Presets = merged.Presets
			result.ImageSize = &restored
		}
	}
	return result
}

func mergeCapabilityImageSize(specs []CapabilitySpec) *CapabilityImageSize {
	var result *CapabilityImageSize
	seen := map[string]bool{}
	for _, spec := range specs {
		part := spec.ImageSize
		if part == nil {
			continue
		}
		if result == nil {
			result = &CapabilityImageSize{Parameter: part.Parameter, AllowCustom: part.AllowCustom}
		} else {
			if result.Parameter != "aspect_ratio" && part.Parameter == "aspect_ratio" {
				result.Parameter = "aspect_ratio"
			} else if result.Parameter == "" {
				result.Parameter = part.Parameter
			}
			result.AllowCustom = result.AllowCustom || part.AllowCustom
		}
		for _, preset := range part.Presets {
			key := preset.Tier + ":" + preset.Ratio + ":" + preset.Size
			if key == "::" || seen[key] {
				continue
			}
			seen[key] = true
			result.Presets = append(result.Presets, preset)
		}
	}
	return result
}

// capabilityFingerprint 用规范化后的结构去重能力画像；不能直接依赖原始 JSON，
// 因为同一组枚举能力的数组顺序不应造成重复展示。
func capabilityFingerprint(spec CapabilitySpec) string {
	copySpec := spec
	copySpec.Operations = append([]string(nil), spec.Operations...)
	sort.Strings(copySpec.Operations)
	copySpec.Inputs = make(map[string]InputConstraint, len(spec.Inputs))
	for name, constraint := range spec.Inputs {
		copySpec.Inputs[name] = constraint
	}
	copySpec.Options = make(map[string]OptionConstraint, len(spec.Options))
	for name, constraint := range spec.Options {
		values := append([]any(nil), constraint.Values...)
		sort.SliceStable(values, func(i, j int) bool { return normalizedScalar(values[i]) < normalizedScalar(values[j]) })
		constraint.Values = values
		copySpec.Options[name] = constraint
	}
	encoded, _ := json.Marshal(copySpec)
	return string(encoded)
}
