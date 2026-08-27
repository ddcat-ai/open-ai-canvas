package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

var logicalModelCodePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,79}$`)

type LogicalModelRequest struct {
	Code                    string `json:"code"`
	Name                    string `json:"name"`
	Icon                    string `json:"icon"`
	Description             string `json:"description"`
	Capability              string `json:"capability"`
	Enabled                 bool   `json:"enabled"`
	SortOrder               int    `json:"sortOrder"`
	PricePolicy             string `json:"pricePolicy"`
	BillingMode             string `json:"billingMode"`
	UnitPriceMicrocredits   int64  `json:"unitPriceMicrocredits"`
	InputPriceMicrocredits  int64  `json:"inputPriceMicrocredits"`
	OutputPriceMicrocredits int64  `json:"outputPriceMicrocredits"`
	CachedPriceMicrocredits int64  `json:"cachedPriceMicrocredits"`
	// LegacyModelIDs 只用于将用户本地保存的旧目录选择迁移到当前模型家族，
	// 不能用它重写任务、账单或路由尝试中的不可变快照。
	LegacyModelIDs []string              `json:"legacyModelIds"`
	CapabilitySpec CapabilitySpec        `json:"capabilitySpec"`
	DefaultOptions map[string]any        `json:"defaultOptions"`
	Routes         []LogicalRouteRequest `json:"routes"`
	// SourceChannelModelID 仅供系统渠道同步流程使用，前台模型不再拥有独立的能力和价格真相。
	SourceChannelModelID string `json:"-"`
}
type LogicalRouteRequest struct {
	ChannelModelID string `json:"channelModelId"`
	Enabled        bool   `json:"enabled"`
	Priority       int    `json:"priority"`
	Weight         int    `json:"weight"`
}

type PublicLogicalModel struct {
	ID                      string                        `json:"id"`
	Code                    string                        `json:"code"`
	Name                    string                        `json:"name"`
	Icon                    string                        `json:"icon"`
	Description             string                        `json:"description"`
	Capability              string                        `json:"capability"`
	SortOrder               int                           `json:"sortOrder"`
	PricePolicy             string                        `json:"pricePolicy"`
	PricingMode             string                        `json:"pricingMode"`
	DisplayPrice            *int64                        `json:"displayPrice,omitempty"`
	PriceLabel              string                        `json:"priceLabel"`
	BillingMode             string                        `json:"billingMode"`
	UnitPriceMicrocredits   int64                         `json:"unitPriceMicrocredits"`
	InputPriceMicrocredits  int64                         `json:"inputPriceMicrocredits"`
	OutputPriceMicrocredits int64                         `json:"outputPriceMicrocredits"`
	CachedPriceMicrocredits int64                         `json:"cachedPriceMicrocredits"`
	PriceTiers              []PublicLogicalModelPriceTier `json:"priceTiers"`
	LegacyModelIDs          []string                      `json:"legacyModelIds"`
	CapabilitySpec          CapabilitySpec                `json:"capabilitySpec"`
	// CapabilityProfiles 是创作端可见的匿名能力组合，不暴露其背后的供应线路关系。
	CapabilityProfiles []CapabilitySpec `json:"capabilityProfiles"`
	DefaultOptions     map[string]any   `json:"defaultOptions"`
	Available          bool             `json:"available"`
}

// PublicLogicalModelPriceTier 是创作端用于约束规格选择和展示当前报价的安全投影，
// 不暴露供应渠道、上游模型 ID 或内部路由信息。
type PublicLogicalModelPriceTier struct {
	Selector                     map[string]string `json:"selector"`
	Resolution                   string            `json:"resolution"`
	VideoSeconds                 int               `json:"videoSeconds"`
	BillingMode                  string            `json:"billingMode"`
	UnitPriceMicrocredits        int64             `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits  int64             `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits int64             `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits int64             `json:"cachedTokenPriceMicrocredits"`
}

type AdminLogicalRoute struct {
	ID                    string `json:"id"`
	ChannelModelID        string `json:"channelModelId"`
	ChannelID             string `json:"channelId"`
	ChannelModelKey       string `json:"channelModelKey"`
	ChannelModelName      string `json:"channelModelName"`
	Enabled               bool   `json:"enabled"`
	Priority              int    `json:"priority"`
	Weight                int    `json:"weight"`
	Available             bool   `json:"available"`
	structurallyAvailable bool
	CapabilitySpec        CapabilitySpec `json:"capabilitySpec"`
}

type AdminLogicalModel struct {
	PublicLogicalModel
	Enabled            bool                `json:"enabled"`
	ActiveRevisionID   string              `json:"activeRevisionId"`
	RevisionVersion    int                 `json:"revisionVersion"`
	ConfigurationError string              `json:"configurationError,omitempty"`
	AvailabilityError  string              `json:"availabilityError,omitempty"`
	Routes             []AdminLogicalRoute `json:"routes"`
}

type RouteSimulationCandidate struct {
	RouteID          string   `json:"routeId"`
	ChannelModelID   string   `json:"channelModelId"`
	ChannelModelKey  string   `json:"channelModelKey"`
	ChannelModelName string   `json:"channelModelName"`
	Priority         int      `json:"priority"`
	Weight           int      `json:"weight"`
	Enabled          bool     `json:"enabled"`
	Matched          bool     `json:"matched"`
	Blocked          bool     `json:"blocked"`
	InPool           bool     `json:"inPool"`
	Reasons          []string `json:"reasons,omitempty"`
}

type RouteSimulationResult struct {
	ProductMatch CapabilityMatch            `json:"productMatch"`
	Candidates   []RouteSimulationCandidate `json:"candidates"`
}

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
	routeSpecs := make([]CapabilitySpec, 0, len(cached.Routes))
	for _, route := range cached.Routes {
		routeSpecs = append(routeSpecs, route.CapabilitySpec)
	}
	productSpec := capabilitySpecWithRoutePresets(cached.ProductSpec, routeSpecs)
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

// capabilitySpecWithRoutePresets repairs old front-model snapshots that stored
// only `*` for a custom size. The wildcard remains for matching custom values,
// while route presets are restored for admin and creator-side selectors.
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

func (s *Service) AdminLogicalModels(actor *model.User) ([]AdminLogicalModel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	items, err := s.repo.LogicalModels(true)
	if err != nil {
		return nil, err
	}
	graphs, err := s.repo.LogicalModelGraphs(items, true)
	if err != nil {
		return nil, err
	}
	systemChannelIDs := make([]string, 0)
	for _, graph := range graphs {
		if graph == nil {
			continue
		}
		for _, channelModel := range graph.ChannelModels {
			systemChannelIDs = append(systemChannelIDs, channelModel.ChannelID)
		}
	}
	systemChannels, err := s.repo.SystemChannelsByIDs(systemChannelIDs, true)
	if err != nil {
		return nil, err
	}
	systemChannelByID := make(map[string]model.ModelChannel, len(systemChannels))
	for _, channel := range systemChannels {
		systemChannelByID[channel.ID] = channel
	}
	result := make([]AdminLogicalModel, 0, len(items))
	for _, item := range items {
		graph := graphs[item.ID]
		if graph == nil || graph.Revision == nil {
			continue
		}
		admin, buildErr := s.buildAdminLogicalModel(item, graph, systemChannelByID)
		if buildErr != nil {
			return nil, buildErr
		}
		result = append(result, *admin)
	}
	return result, nil
}

func (s *Service) buildAdminLogicalModel(item model.LogicalModel, graph *repository.LogicalModelGraph, systemChannelByID map[string]model.ModelChannel) (*AdminLogicalModel, error) {
	productSpec, err := DecodeCapabilitySpec(graph.Revision.CapabilitySpecJSON)
	if err != nil {
		return nil, err
	}
	channelModelByID := make(map[string]model.ChannelModel, len(graph.ChannelModels))
	for _, channelModel := range graph.ChannelModels {
		channelModelByID[channelModel.ID] = channelModel
	}
	admin := AdminLogicalModel{PublicLogicalModel: publicLogicalModel(cachedLogicalModel{Model: item, ProductSpec: productSpec, Defaults: map[string]any{}}, false), Enabled: item.Enabled, ActiveRevisionID: graph.Revision.ID, RevisionVersion: graph.Revision.Version, Routes: []AdminLogicalRoute{}}
	for _, route := range graph.Routes {
		channelModel, channelOK := channelModelByID[route.ChannelModelID]
		if !channelOK {
			return nil, errors.New("供应线路引用的渠道模型不存在")
		}
		capabilitySpec, specErr := channelModelCapabilitySpec(channelModel)
		if specErr != nil {
			return nil, specErr
		}
		_, channelOK = systemChannelByID[channelModel.ChannelID]
		structurallyAvailable := route.Enabled && route.Weight > 0 && channelModel.Enabled && channelOK
		billingAvailable := item.PricePolicy != "unified" || item.BillingMode != "token" || supportsTokenBilling(item.Capability, channelModel.Protocol)
		available := structurallyAvailable && billingAvailable && (item.PricePolicy != "channel" || channelModel.PriceConfigured)
		admin.Routes = append(admin.Routes, AdminLogicalRoute{ID: route.ID, ChannelModelID: channelModel.ID, ChannelID: channelModel.ChannelID, ChannelModelKey: channelModel.ModelKey, ChannelModelName: channelModel.DisplayName, Enabled: route.Enabled, Priority: route.Priority, Weight: route.Weight, Available: available, structurallyAvailable: structurallyAvailable, CapabilitySpec: capabilitySpec})
	}
	routeSpecs := make([]CapabilitySpec, 0, len(admin.Routes))
	for _, route := range admin.Routes {
		routeSpecs = append(routeSpecs, route.CapabilitySpec)
	}
	productSpec = capabilitySpecWithRoutePresets(productSpec, routeSpecs)
	defaults, err := decodeLogicalDefaults(graph.Revision.DefaultOptionsJSON, productSpec)
	if err != nil {
		return nil, err
	}
	admin.PublicLogicalModel = publicLogicalModel(cachedLogicalModel{Model: item, ProductSpec: productSpec, Defaults: defaults}, false)
	// publicLogicalModel above has no route list; admin routes are already attached
	// and the enriched product spec is the source used by the editor.
	admin.CapabilitySpec = productSpec
	admin.DefaultOptions = defaults
	structuralRouteSpecs := structuralAdminRouteSpecs(admin.Routes)
	settlementRouteSpecs := settlementReadyAdminRouteSpecs(admin.Routes)
	admin.ConfigurationError = logicalModelConfigurationError(productSpec, structuralRouteSpecs)
	admin.AvailabilityError = logicalModelAvailabilityError(item.PricePolicy, productSpec, structuralRouteSpecs, settlementRouteSpecs)
	admin.Available = len(settlementRouteSpecs) > 0 && admin.ConfigurationError == "" && admin.AvailabilityError == ""
	return &admin, nil
}

func countAvailableAdminRoutes(routes []AdminLogicalRoute) int {
	count := 0
	for _, route := range routes {
		if route.Available {
			count++
		}
	}
	return count
}

func structuralAdminRouteSpecs(routes []AdminLogicalRoute) []CapabilitySpec {
	result := make([]CapabilitySpec, 0, len(routes))
	for _, route := range routes {
		if route.structurallyAvailable {
			result = append(result, route.CapabilitySpec)
		}
	}
	return result
}

func settlementReadyAdminRouteSpecs(routes []AdminLogicalRoute) []CapabilitySpec {
	result := make([]CapabilitySpec, 0, countAvailableAdminRoutes(routes))
	for _, route := range routes {
		if route.Available {
			result = append(result, route.CapabilitySpec)
		}
	}
	return result
}

func availableCachedRouteSpecs(routes []cachedLogicalRoute) []CapabilitySpec {
	result := make([]CapabilitySpec, 0, len(routes))
	for _, route := range routes {
		if route.Route.Enabled && route.Route.Weight > 0 {
			result = append(result, route.CapabilitySpec)
		}
	}
	return result
}

func hasHealthyCachedRoute(s *Service, routes []cachedLogicalRoute) bool {
	for _, route := range routes {
		if route.Route.Enabled && route.Route.Weight > 0 && !s.logicalRouteBlocked(route) {
			return true
		}
	}
	return false
}

func logicalModelCapabilityCovered(product CapabilitySpec, routeSpecs []CapabilitySpec) bool {
	return len(routeSpecs) > 0 && validateProductSpecWithinRoutes(product, routeSpecs) == nil
}

func logicalModelConfigurationError(product CapabilitySpec, routeSpecs []CapabilitySpec) string {
	if len(routeSpecs) == 0 || logicalModelCapabilityCovered(product, routeSpecs) {
		return ""
	}
	return "供应线路已无法完整覆盖创作端能力，请调整线路或能力范围"
}

func logicalModelAvailabilityError(pricePolicy string, product CapabilitySpec, structuralRouteSpecs, settlementRouteSpecs []CapabilitySpec) string {
	if pricePolicy != "channel" || len(structuralRouteSpecs) == 0 {
		return ""
	}
	if len(settlementRouteSpecs) == 0 {
		return "供应线路尚未配置可结算价格，请先完善渠道模型价格"
	}
	if !logicalModelCapabilityCovered(product, settlementRouteSpecs) {
		return "部分创作端能力只能由未配置价格的渠道模型承接，请完善对应价格"
	}
	return ""
}

func (s *Service) SaveAdminLogicalModel(actor *model.User, id string, req LogicalModelRequest) (*AdminLogicalModel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	item, revision, routes, creating, err := s.logicalModelBundle(actor, id, req)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveLogicalModelBundle(item, revision, routes, creating); err != nil {
		return nil, err
	}
	s.invalidateRouteCatalog()
	_ = s.appendAdminAudit(actor, map[bool]string{true: "logical_model.create", false: "logical_model.update"}[creating], "logical_model", item.ID, "保存前台模型及供应线路", map[string]any{"revisionId": revision.ID, "routeCount": len(routes)})
	graph, err := s.repo.LogicalModelGraph(item.ID, true)
	if err != nil {
		return nil, err
	}
	channelIDs := make([]string, 0, len(graph.ChannelModels))
	for _, channelModel := range graph.ChannelModels {
		channelIDs = append(channelIDs, channelModel.ChannelID)
	}
	systemChannels, err := s.repo.SystemChannelsByIDs(channelIDs, true)
	if err != nil {
		return nil, err
	}
	systemChannelByID := make(map[string]model.ModelChannel, len(systemChannels))
	for _, channel := range systemChannels {
		systemChannelByID[channel.ID] = channel
	}
	return s.buildAdminLogicalModel(*item, graph, systemChannelByID)
}

func (s *Service) DeleteAdminLogicalModel(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	item, err := s.repo.LogicalModel(strings.TrimSpace(id))
	if logicalModelNotFound(err) {
		return BadAuthRequest("前台模型不存在或已删除")
	}
	if err != nil {
		return err
	}
	if item.ArchivedAt != nil {
		return BadAuthRequest("前台模型不存在或已删除")
	}
	if item.SourceChannelModelID != "" {
		return BadAuthRequest("该前台模型由系统渠道自动同步，请在系统渠道模型中停用")
	}
	audit, err := newAdminAuditEvent(actor, "logical_model.archive", "logical_model", item.ID, "归档前台模型", map[string]any{"code": item.Code, "name": item.Name})
	if err != nil {
		return err
	}
	if err := s.repo.ArchiveLogicalModel(item.ID, audit, time.Now()); err != nil {
		if errors.Is(err, repository.ErrLogicalModelInUse) {
			return BadAuthRequest("前台模型仍被排队中或进行中任务使用，请等待任务结束后再归档")
		}
		if logicalModelNotFound(err) {
			return BadAuthRequest("前台模型不存在或已删除")
		}
		return err
	}
	s.invalidateRouteCatalog()
	return nil
}

func (s *Service) logicalModelBundle(actor *model.User, id string, req LogicalModelRequest) (*model.LogicalModel, *model.LogicalModelRevision, []model.LogicalModelRoute, bool, error) {
	code := strings.ToLower(strings.TrimSpace(req.Code))
	name := strings.TrimSpace(req.Name)
	capability := normalizeCapability(req.Capability)
	if !logicalModelCodePattern.MatchString(code) {
		return nil, nil, nil, false, BadAuthRequest("模型 code 需为 2-80 位小写字母、数字、点、下划线或连字符")
	}
	if name == "" || len([]rune(name)) > 120 {
		return nil, nil, nil, false, BadAuthRequest("请填写 1-120 个字符的模型名称")
	}
	sourceChannelModelID := strings.TrimSpace(req.SourceChannelModelID)
	if sourceChannelModelID != "" {
		source, sourceErr := s.repo.ChannelModel(sourceChannelModelID)
		if sourceErr != nil {
			return nil, nil, nil, false, BadAuthRequest("系统渠道模型不存在")
		}
		if _, channelErr := s.repo.AdminSystemChannel(source.ChannelID); channelErr != nil {
			return nil, nil, nil, false, BadAuthRequest("前台模型只能同步系统渠道模型")
		}
		capability = normalizeCapability(source.Capability)
		derivedSpec, specErr := channelModelCapabilitySpec(*source)
		if specErr != nil {
			return nil, nil, nil, false, specErr
		}
		derivedDefaults, defaultsErr := channelModelDefaultOptions(*source, derivedSpec)
		if defaultsErr != nil {
			return nil, nil, nil, false, defaultsErr
		}
		if len(req.Routes) == 0 {
			req.CapabilitySpec = derivedSpec
			req.DefaultOptions = derivedDefaults
			req.Routes = []LogicalRouteRequest{{ChannelModelID: source.ID, Enabled: true, Priority: 100, Weight: 100}}
		}
		req.PricePolicy = "channel"
		req.BillingMode = "fixed_request"
		req.UnitPriceMicrocredits, req.InputPriceMicrocredits, req.OutputPriceMicrocredits, req.CachedPriceMicrocredits = 0, 0, 0, 0
		// 未完成定价的系统模型仅在后台目录保留同步记录，不能暴露到创作端。
		if strings.TrimSpace(id) == "" {
			req.Enabled = source.Enabled && channelModelHasActivePriceTier(*source)
		}
	}
	normalizedSpec, err := NormalizeCapabilitySpec(req.CapabilitySpec)
	if err != nil {
		return nil, nil, nil, false, err
	}
	req.CapabilitySpec = normalizedSpec
	if normalizeCapability(req.CapabilitySpec.Capability) != capability {
		return nil, nil, nil, false, BadAuthRequest("前台模型类型与能力配置不一致")
	}
	normalizedDefaults, err := normalizeLogicalDefaults(req.CapabilitySpec, req.DefaultOptions)
	if err != nil {
		return nil, nil, nil, false, err
	}
	req.DefaultOptions = normalizedDefaults
	if req.UnitPriceMicrocredits < 0 || req.InputPriceMicrocredits < 0 || req.OutputPriceMicrocredits < 0 || req.CachedPriceMicrocredits < 0 {
		return nil, nil, nil, false, BadAuthRequest("用户价格不能为负数")
	}
	pricePolicy := strings.TrimSpace(req.PricePolicy)
	if pricePolicy != "channel" && pricePolicy != "unified" {
		return nil, nil, nil, false, BadAuthRequest("请选择跟随供应价格或统一定价")
	}
	billingMode := strings.TrimSpace(req.BillingMode)
	if pricePolicy == "channel" {
		billingMode = "fixed_request"
		req.UnitPriceMicrocredits, req.InputPriceMicrocredits, req.OutputPriceMicrocredits, req.CachedPriceMicrocredits = 0, 0, 0, 0
	} else if billingMode != "fixed_request" && billingMode != "per_second" && billingMode != "token" {
		return nil, nil, nil, false, BadAuthRequest("前台模型计费方式仅支持按次、按秒或 Token")
	}
	if pricePolicy == "unified" && billingMode == "per_second" && capability != "video" {
		return nil, nil, nil, false, BadAuthRequest("只有视频前台模型可以按秒计费")
	}
	creating := strings.TrimSpace(id) == ""
	var item *model.LogicalModel
	if creating {
		id, err = s.repo.NextPrefixedID("LMODEL")
		if err != nil {
			return nil, nil, nil, false, err
		}
		item = &model.LogicalModel{ID: id, CreatedAt: time.Now()}
	} else {
		item, err = s.repo.LogicalModel(id)
		if err != nil {
			return nil, nil, nil, false, err
		}
		if item.ArchivedAt != nil {
			return nil, nil, nil, false, BadAuthRequest("前台模型不存在或已删除")
		}
	}
	item.Code, item.Name, item.Icon, item.Description, item.Capability = code, name, strings.TrimSpace(req.Icon), strings.TrimSpace(req.Description), capability
	if sourceChannelModelID != "" {
		item.SourceChannelModelID = sourceChannelModelID
	}
	item.Enabled, item.SortOrder, item.PricePolicy, item.BillingMode = req.Enabled, req.SortOrder, pricePolicy, billingMode
	item.UnitPriceMicrocredits, item.InputPriceMicrocredits, item.OutputPriceMicrocredits, item.CachedPriceMicrocredits = req.UnitPriceMicrocredits, req.InputPriceMicrocredits, req.OutputPriceMicrocredits, req.CachedPriceMicrocredits
	if req.LegacyModelIDs != nil {
		legacyJSON, marshalErr := json.Marshal(normalizeLegacyModelIDs(req.LegacyModelIDs))
		if marshalErr != nil {
			return nil, nil, nil, false, marshalErr
		}
		item.LegacyModelIDsJSON = string(legacyJSON)
	}
	item.UpdatedAt = time.Now()
	revisionID, err := s.repo.NextPrefixedID("REVISION")
	if err != nil {
		return nil, nil, nil, false, err
	}
	specJSON, _ := json.Marshal(req.CapabilitySpec)
	defaultsJSON, _ := json.Marshal(defaultMap(req.DefaultOptions))
	revision := &model.LogicalModelRevision{ID: revisionID, LogicalModelID: item.ID, CapabilitySpecJSON: string(specJSON), DefaultOptionsJSON: string(defaultsJSON), CreatedBy: actor.ID, CreatedAt: time.Now()}
	routes := make([]model.LogicalModelRoute, 0, len(req.Routes))
	seenChannelModels := make(map[string]bool, len(req.Routes))
	structuralRouteSpecs := make([]CapabilitySpec, 0, len(req.Routes))
	settlementRouteSpecs := make([]CapabilitySpec, 0, len(req.Routes))
	enabledRouteProtocols := make([]model.ChannelInterfaceType, 0, len(req.Routes))
	for _, input := range req.Routes {
		channelModelID := strings.TrimSpace(input.ChannelModelID)
		if channelModelID == "" || seenChannelModels[channelModelID] {
			return nil, nil, nil, false, BadAuthRequest("供应线路必须选择不重复的渠道模型")
		}
		seenChannelModels[channelModelID] = true
		channelModel, modelErr := s.repo.ChannelModel(channelModelID)
		if modelErr != nil {
			return nil, nil, nil, false, BadAuthRequest("供应线路引用的渠道模型不存在")
		}
		capabilitySpec, specErr := channelModelCapabilitySpec(*channelModel)
		if specErr != nil {
			return nil, nil, nil, false, specErr
		}
		if normalizeCapability(capabilitySpec.Capability) != capability {
			return nil, nil, nil, false, BadAuthRequest("供应线路能力类型与前台模型不一致")
		}
		if input.Enabled {
			enabledRouteProtocols = append(enabledRouteProtocols, channelModel.Protocol)
		}
		if req.Enabled && input.Enabled && input.Weight <= 0 {
			return nil, nil, nil, false, BadAuthRequest("启用供应线路的同级权重必须大于 0")
		}
		if input.Weight < 0 {
			return nil, nil, nil, false, BadAuthRequest("供应线路的同级权重不能为负数")
		}
		if _, channelErr := s.repo.SystemChannel(channelModel.ChannelID); channelErr != nil {
			return nil, nil, nil, false, BadAuthRequest("供应线路只能选择系统渠道模型")
		}
		if req.Enabled && input.Enabled && channelModel.Enabled {
			structuralRouteSpecs = append(structuralRouteSpecs, capabilitySpec)
			if pricePolicy != "channel" || channelModel.PriceConfigured {
				settlementRouteSpecs = append(settlementRouteSpecs, capabilitySpec)
			}
		}
		routeID, idErr := s.repo.NextPrefixedID("ROUTE")
		if idErr != nil {
			return nil, nil, nil, false, idErr
		}
		routes = append(routes, model.LogicalModelRoute{ID: routeID, ChannelModelID: channelModel.ID, Enabled: input.Enabled, Priority: input.Priority, Weight: input.Weight, CreatedAt: time.Now(), UpdatedAt: time.Now()})
	}
	if pricePolicy == "unified" && billingMode == "token" {
		if !supportsLogicalModelTokenBilling(capability, enabledRouteProtocols) {
			return nil, nil, nil, false, BadAuthRequest("Token 计费仅支持文本前台模型，或全部启用供应线路均为火山方舟视频协议的视频前台模型")
		}
	}
	// 停用必须始终可执行，便于管理员立即阻止失效线路继续对外服务；重新启用时再强校验结构能力和计费可用性。
	if req.Enabled {
		if len(structuralRouteSpecs) == 0 {
			return nil, nil, nil, false, BadAuthRequest("启用前台模型前至少需要一条已启用的供应线路")
		}
		if err := validateProductSpecWithinRoutes(req.CapabilitySpec, structuralRouteSpecs); err != nil {
			return nil, nil, nil, false, err
		}
		if availabilityError := logicalModelAvailabilityError(pricePolicy, req.CapabilitySpec, structuralRouteSpecs, settlementRouteSpecs); availabilityError != "" {
			return nil, nil, nil, false, BadAuthRequest(availabilityError)
		}
	}
	return item, revision, routes, creating, nil
}

func supportsLogicalModelTokenBilling(capability string, enabledRouteProtocols []model.ChannelInterfaceType) bool {
	if capability == "text" {
		return true
	}
	if capability != "video" || len(enabledRouteProtocols) == 0 {
		return false
	}
	for _, protocol := range enabledRouteProtocols {
		if !supportsTokenBilling(capability, protocol) {
			return false
		}
	}
	return true
}

func normalizeLogicalDefaults(spec CapabilitySpec, defaults map[string]any) (map[string]any, error) {
	result := make(map[string]any, len(defaults))
	for rawName, value := range defaults {
		name := canonicalCapabilityOptionName(rawName)
		if _, exists := result[name]; exists {
			return nil, BadAuthRequest("默认参数存在重复别名：" + name)
		}
		constraint, ok := spec.Options[name]
		if !ok || !matchOptionConstraint(name, constraint, value) {
			return nil, BadAuthRequest("默认参数 " + name + " 不在前台模型能力范围内")
		}
		// `*` 只表示允许任意自定义值，不能作为创作端默认参数发送。
		if normalizedScalar(value) == "*" {
			for _, candidate := range constraint.Values {
				if normalizedScalar(candidate) != "*" {
					value = candidate
					break
				}
			}
		}
		result[name] = value
	}
	return result, nil
}

func defaultMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func channelModelCapabilitySpec(channelModel model.ChannelModel) (CapabilitySpec, error) {
	config, err := DecodeModelCapabilityConfig(channelModel.CapabilityConfigJSON)
	if err != nil {
		return CapabilitySpec{}, BadAuthRequest("渠道模型能力配置无效，请先修复渠道模型")
	}
	if config != nil {
		config, err = NormalizeModelCapabilityConfigForModel(normalizeCapability(channelModel.Capability), string(channelModel.Protocol), firstNonEmpty(channelModel.ProviderModelKey, channelModel.ModelKey), config)
		if err != nil {
			return CapabilitySpec{}, err
		}
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(config, normalizeCapability(channelModel.Capability))
	if err != nil {
		return CapabilitySpec{}, err
	}
	return capabilitySpecWithPriceTiers(spec, channelModel), nil
}

// capabilitySpecWithPriceTiers 只让创作端选择已经启用且可结算的规格。规格组合最终仍由
// 路由时的精确价格档匹配保证，避免独立枚举无法表达“分辨率 × 时长”非笛卡尔组合的问题。
func capabilitySpecWithPriceTiers(spec CapabilitySpec, channelModel model.ChannelModel) CapabilitySpec {
	if normalizeCapability(spec.Capability) != "video" || len(channelModel.PriceTiers) == 0 {
		return spec
	}
	tiers := make([]model.ChannelModelPriceTier, 0, len(channelModel.PriceTiers))
	for _, tier := range channelModel.PriceTiers {
		if tier.Enabled && tier.PriceConfigured {
			tiers = append(tiers, tier)
		}
	}
	if len(tiers) == 0 {
		return spec
	}
	result := spec
	result.Options = make(map[string]OptionConstraint, len(spec.Options))
	for name, option := range spec.Options {
		result.Options[name] = option
	}
	hasResolutionWildcard, hasDurationWildcard := false, false
	resolutions := make([]any, 0, len(tiers))
	durations := make([]any, 0, len(tiers))
	seenResolutions := make(map[string]bool, len(tiers))
	seenDurations := make(map[int]bool, len(tiers))
	for _, tier := range tiers {
		if normalizeChannelModelTierResolution(tier.Resolution) == "*" {
			hasResolutionWildcard = true
		} else if value := normalizeChannelModelTierResolution(tier.Resolution); !seenResolutions[value] {
			seenResolutions[value] = true
			resolutions = append(resolutions, value)
		}
		if tier.VideoSeconds == 0 {
			hasDurationWildcard = true
		} else if !seenDurations[tier.VideoSeconds] {
			seenDurations[tier.VideoSeconds] = true
			durations = append(durations, tier.VideoSeconds)
		}
	}
	if !hasResolutionWildcard && len(resolutions) > 0 {
		result.Options["vquality"] = OptionConstraint{Values: resolutions}
	}
	if !hasDurationWildcard && len(durations) > 0 {
		result.Options["videoSeconds"] = OptionConstraint{Values: durations}
	}
	return result
}

func channelModelDefaultOptions(channelModel model.ChannelModel, spec CapabilitySpec) (map[string]any, error) {
	config, err := DecodeModelCapabilityConfig(channelModel.CapabilityConfigJSON)
	if err != nil {
		return nil, BadAuthRequest("渠道模型能力配置无效，请先修复渠道模型")
	}
	if config != nil {
		config, err = NormalizeModelCapabilityConfigForModel(normalizeCapability(channelModel.Capability), string(channelModel.Protocol), firstNonEmpty(channelModel.ProviderModelKey, channelModel.ModelKey), config)
		if err != nil {
			return nil, err
		}
	}
	defaults := make(map[string]any)
	if config != nil {
		switch normalizeCapability(channelModel.Capability) {
		case "image":
			if config.Image != nil {
				defaults["size"] = config.Image.Size.Default
				if config.Image.Quality.Supported {
					defaults["quality"] = config.Image.Quality.Default
				}
				if config.Image.TransparentBackground.Supported {
					defaults["transparentBackground"] = config.Image.TransparentBackground.Default
				}
			}
		case "video":
			if config.Video != nil {
				defaults["videoSeconds"] = config.Video.Duration.Default
				defaults["vquality"] = normalizeChannelModelTierResolution(config.Video.DefaultResolution)
				defaults["size"] = config.Video.DefaultRatio
				if config.Video.GenerateAudio.Supported {
					defaults["videoGenerateAudio"] = config.Video.GenerateAudio.Default
				}
				if config.Video.Watermark.Supported {
					defaults["videoWatermark"] = config.Video.Watermark.Default
				}
			}
		}
	}
	// 当渠道默认规格没有价格档时，优先选择第一个可结算档，确保初始选择可直接生成。
	if normalizeCapability(channelModel.Capability) == "video" && channelModelPriceTierForIntent(channelModel, ModelRequestIntent{Capability: "video", Options: defaults}) == nil {
		for _, tier := range channelModel.PriceTiers {
			if !tier.Enabled || !tier.PriceConfigured {
				continue
			}
			if tier.Resolution != "*" {
				defaults["vquality"] = normalizeChannelModelTierResolution(tier.Resolution)
			}
			if tier.VideoSeconds > 0 {
				defaults["videoSeconds"] = tier.VideoSeconds
			}
			break
		}
	}
	return normalizeLogicalDefaults(spec, defaults)
}

func (s *Service) SimulateLogicalModelRoute(actor *model.User, id string, intent ModelRequestIntent) (*RouteSimulationResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	snapshot, err := s.routeCatalogSnapshot()
	if err != nil {
		return nil, err
	}
	cached, ok := snapshot.Models[id]
	if !ok {
		return nil, BadAuthRequest("前台模型未启用或尚未发布")
	}
	intent.Options = mergeIntentDefaults(intent.Options, cached.Defaults)
	return &RouteSimulationResult{ProductMatch: MatchCapability(cached.ProductSpec, intent), Candidates: s.sortedRouteDiagnostics(cached.Routes, intent)}, nil
}

func logicalModelNotFound(err error) bool { return errors.Is(err, gorm.ErrRecordNotFound) }

// 前台模型只声明供应线路真实提供的总目录；组合是否可承接仍由匿名 capabilityProfiles 按 OR 语义判断。
func validateProductSpecWithinRoutes(product CapabilitySpec, routeSpecs []CapabilitySpec) error {
	for _, routeSpec := range routeSpecs {
		if normalizeCapability(routeSpec.Capability) != normalizeCapability(product.Capability) {
			return BadAuthRequest("供应线路能力类型与前台模型不一致")
		}
	}
	if len(product.Operations) == 0 {
		unrestricted := false
		for _, routeSpec := range routeSpecs {
			if len(routeSpec.Operations) == 0 {
				unrestricted = true
				break
			}
		}
		if !unrestricted {
			return BadAuthRequest("创作端生成方式必须从供应线路支持的选项中选择")
		}
	} else {
		for _, operation := range product.Operations {
			supported := false
			for _, routeSpec := range routeSpecs {
				if len(routeSpec.Operations) == 0 || containsCapabilityString(routeSpec.Operations, operation) {
					supported = true
					break
				}
			}
			if !supported {
				return BadAuthRequest("创作端生成方式不受任何供应线路支持：" + operation)
			}
		}
	}
	for name, constraint := range product.Inputs {
		if !inputConstraintCovered(constraint, name, routeSpecs) {
			return BadAuthRequest("创作端输入范围超出供应线路能力：" + name)
		}
	}
	for name, constraint := range product.Options {
		if !optionConstraintCovered(constraint, name, routeSpecs) {
			return BadAuthRequest("创作端参数超出供应线路能力：" + name)
		}
	}
	return nil
}

func inputConstraintCovered(candidate InputConstraint, name string, routeSpecs []CapabilitySpec) bool {
	next := candidate.Min
	for next <= candidate.Max {
		coveredUntil := next - 1
		for _, routeSpec := range routeSpecs {
			constraint, exists := routeSpec.Inputs[name]
			if !exists {
				constraint = InputConstraint{Min: 0, Max: 0}
			}
			if constraint.Min <= next && constraint.Max >= next && constraint.Max > coveredUntil {
				coveredUntil = constraint.Max
			}
		}
		if coveredUntil < next {
			return false
		}
		next = coveredUntil + 1
	}
	return true
}

func optionConstraintCovered(candidate OptionConstraint, name string, routeSpecs []CapabilitySpec) bool {
	routeConstraints := make([]OptionConstraint, 0, len(routeSpecs))
	for _, routeSpec := range routeSpecs {
		if constraint, exists := routeSpec.Options[name]; exists {
			routeConstraints = append(routeConstraints, constraint)
		}
	}
	if len(routeConstraints) == 0 {
		return false
	}
	for _, routeConstraint := range routeConstraints {
		if isWildcardOptionConstraint(routeConstraint) {
			return true
		}
	}
	if len(candidate.Values) > 0 {
		for _, value := range candidate.Values {
			if !optionValueSupported(name, value, routeConstraints) {
				return false
			}
		}
		return true
	}
	if candidate.Min == nil || candidate.Max == nil {
		return false
	}
	if math.Abs(*candidate.Max-*candidate.Min) < 1e-9 {
		return optionValueSupported(name, *candidate.Min, routeConstraints)
	}
	if candidate.Step == nil {
		return continuousOptionRangeCovered(*candidate.Min, *candidate.Max, routeConstraints)
	}
	step := *candidate.Step
	count := int(math.Floor((*candidate.Max-*candidate.Min)/step+1e-9)) + 1
	if count <= 10000 {
		for index := 0; index < count; index++ {
			value := *candidate.Min + float64(index)*step
			if !optionValueSupported(name, value, routeConstraints) {
				return false
			}
		}
		return true
	}
	// 超大离散范围不逐点展开；只有单条连续范围或步长完全兼容的线路才能作为可靠来源。
	for _, routeConstraint := range routeConstraints {
		if routeConstraint.Min == nil || routeConstraint.Max == nil || *routeConstraint.Min > *candidate.Min || *routeConstraint.Max < *candidate.Max {
			continue
		}
		if routeConstraint.Step == nil {
			return true
		}
		startSteps := (*candidate.Min - *routeConstraint.Min) / *routeConstraint.Step
		stepRatio := step / *routeConstraint.Step
		if math.Abs(startSteps-math.Round(startSteps)) < 1e-9 && math.Abs(stepRatio-math.Round(stepRatio)) < 1e-9 {
			return true
		}
	}
	return false
}

func optionValueSupported(name string, value any, constraints []OptionConstraint) bool {
	for _, constraint := range constraints {
		if isWildcardOptionConstraint(constraint) {
			return true
		}
		if matchOptionConstraint(name, constraint, value) {
			return true
		}
	}
	return false
}

func isWildcardOptionConstraint(constraint OptionConstraint) bool {
	for _, value := range constraint.Values {
		if normalizedScalar(value) == "*" {
			return true
		}
	}
	return false
}

func continuousOptionRangeCovered(minimum float64, maximum float64, constraints []OptionConstraint) bool {
	next := minimum
	for next <= maximum+1e-9 {
		coveredUntil := next
		advanced := false
		for _, constraint := range constraints {
			if constraint.Min == nil || constraint.Max == nil || constraint.Step != nil {
				continue
			}
			if *constraint.Min <= next+1e-9 && *constraint.Max >= next-1e-9 && *constraint.Max > coveredUntil {
				coveredUntil = *constraint.Max
				advanced = true
			}
		}
		if coveredUntil >= maximum-1e-9 {
			return true
		}
		if !advanced {
			return false
		}
		next = coveredUntil
	}
	return true
}

func anyValues(values []string) OptionConstraint {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return OptionConstraint{Values: result}
}

func boolValues(supportsTrue bool) OptionConstraint {
	values := []any{false}
	if supportsTrue {
		values = append(values, true)
	}
	return OptionConstraint{Values: values}
}

func numericRange(minimum float64, maximum float64, step float64) OptionConstraint {
	return OptionConstraint{Min: &minimum, Max: &maximum, Step: &step}
}

// computeModelPriceDisplay 计算模型的价格展示信息
// 返回：pricingMode, displayPrice, priceLabel
func computeModelPriceDisplay(model model.LogicalModel, priceTiers []PublicLogicalModelPriceTier) (string, *int64, string) {
	if model.PricePolicy == "channel" {
		// 跟随渠道价格
		if len(priceTiers) == 0 {
			return "provider", nil, "未配置"
		}
		// 检查是否所有价格档都相同
		if len(priceTiers) == 1 {
			tier := priceTiers[0]
			price := getTierDisplayPrice(tier)
			if price > 0 {
				return "provider", &price, ""
			}
		}
		// 多个价格档或价格为0，显示"按渠道规格计费"
		return "provider", nil, "按渠道规格计费"
	}

	// 统一定价模式
	if model.BillingMode == "fixed_request" && model.UnitPriceMicrocredits > 0 {
		price := model.UnitPriceMicrocredits
		return "unified", &price, ""
	}
	if model.BillingMode == "per_second" && model.UnitPriceMicrocredits > 0 {
		price := model.UnitPriceMicrocredits
		return "unified", &price, "按秒"
	}
	if model.BillingMode == "token" {
		// Token 计费显示输入/输出价格
		if model.InputPriceMicrocredits > 0 || model.OutputPriceMicrocredits > 0 {
			return "unified", nil, "按 Token"
		}
	}

	return "unified", nil, "未配置"
}

// getTierDisplayPrice 获取价格档的展示价格
func getTierDisplayPrice(tier PublicLogicalModelPriceTier) int64 {
	if tier.BillingMode == "fixed_request" || tier.BillingMode == "per_second" {
		return tier.UnitPriceMicrocredits
	}
	// Token 计费返回输出价格（如果有）
	if tier.OutputTokenPriceMicrocredits > 0 {
		return tier.OutputTokenPriceMicrocredits
	}
	if tier.InputTokenPriceMicrocredits > 0 {
		return tier.InputTokenPriceMicrocredits
	}
	return 0
}
