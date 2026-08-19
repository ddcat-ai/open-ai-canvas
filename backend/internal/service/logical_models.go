package service

import (
	"encoding/json"
	"errors"
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
	Code                    string                `json:"code"`
	Name                    string                `json:"name"`
	Icon                    string                `json:"icon"`
	Description             string                `json:"description"`
	Capability              string                `json:"capability"`
	Enabled                 bool                  `json:"enabled"`
	SortOrder               int                   `json:"sortOrder"`
	PricePolicy             string                `json:"pricePolicy"`
	BillingMode             string                `json:"billingMode"`
	UnitPriceMicrocredits   int64                 `json:"unitPriceMicrocredits"`
	InputPriceMicrocredits  int64                 `json:"inputPriceMicrocredits"`
	OutputPriceMicrocredits int64                 `json:"outputPriceMicrocredits"`
	CachedPriceMicrocredits int64                 `json:"cachedPriceMicrocredits"`
	CapabilitySpec          CapabilitySpec        `json:"capabilitySpec"`
	DefaultOptions          map[string]any        `json:"defaultOptions"`
	Routes                  []LogicalRouteRequest `json:"routes"`
}

type LogicalRouteRequest struct {
	PhysicalVariantID string `json:"physicalVariantId"`
	Enabled           bool   `json:"enabled"`
	Priority          int    `json:"priority"`
	Weight            int    `json:"weight"`
}

type PhysicalVariantRequest struct {
	ChannelModelID string         `json:"channelModelId"`
	Name           string         `json:"name"`
	Enabled        bool           `json:"enabled"`
	CapabilitySpec CapabilitySpec `json:"capabilitySpec"`
}

type PublicLogicalModel struct {
	ID                      string         `json:"id"`
	Code                    string         `json:"code"`
	Name                    string         `json:"name"`
	Icon                    string         `json:"icon"`
	Description             string         `json:"description"`
	Capability              string         `json:"capability"`
	SortOrder               int            `json:"sortOrder"`
	PricePolicy             string         `json:"pricePolicy"`
	BillingMode             string         `json:"billingMode"`
	UnitPriceMicrocredits   int64          `json:"unitPriceMicrocredits"`
	InputPriceMicrocredits  int64          `json:"inputPriceMicrocredits"`
	OutputPriceMicrocredits int64          `json:"outputPriceMicrocredits"`
	CachedPriceMicrocredits int64          `json:"cachedPriceMicrocredits"`
	CapabilitySpec          CapabilitySpec `json:"capabilitySpec"`
	// CapabilityProfiles 是创作端可见的匿名能力组合，不暴露其背后的供应线路关系。
	CapabilityProfiles []CapabilitySpec `json:"capabilityProfiles"`
	DefaultOptions     map[string]any   `json:"defaultOptions"`
	Available          bool             `json:"available"`
}

type AdminLogicalRoute struct {
	ID                    string `json:"id"`
	PhysicalVariantID     string `json:"physicalVariantId"`
	PhysicalVariantName   string `json:"physicalVariantName"`
	ChannelModelID        string `json:"channelModelId"`
	ChannelID             string `json:"channelId"`
	PhysicalModelKey      string `json:"physicalModelKey"`
	PhysicalModelName     string `json:"physicalModelName"`
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

type AdminPhysicalVariant struct {
	ID             string         `json:"id"`
	ChannelModelID string         `json:"channelModelId"`
	ChannelID      string         `json:"channelId"`
	ModelKey       string         `json:"modelKey"`
	ModelName      string         `json:"modelName"`
	Name           string         `json:"name"`
	Capability     string         `json:"capability"`
	Protocol       string         `json:"protocol"`
	Enabled        bool           `json:"enabled"`
	ModelEnabled   bool           `json:"modelEnabled"`
	UsageCount     int64          `json:"usageCount"`
	CapabilitySpec CapabilitySpec `json:"capabilitySpec"`
}

type RouteSimulationCandidate struct {
	RouteID        string   `json:"routeId"`
	VariantID      string   `json:"variantId"`
	ChannelModelID string   `json:"channelModelId"`
	Priority       int      `json:"priority"`
	Weight         int      `json:"weight"`
	Enabled        bool     `json:"enabled"`
	Matched        bool     `json:"matched"`
	Blocked        bool     `json:"blocked"`
	InPool         bool     `json:"inPool"`
	Reasons        []string `json:"reasons,omitempty"`
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
					if route.Route.Enabled && route.Route.Weight > 0 && !s.logicalRouteBlocked(route) && MatchCapability(route.VariantSpec, resolvedIntent).Matched {
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
		routeSpecs = append(routeSpecs, route.VariantSpec)
	}
	productSpec := capabilitySpecWithRoutePresets(cached.ProductSpec, routeSpecs)
	variants := make([]CapabilitySpec, 0, len(cached.Routes))
	seen := make(map[string]bool, len(cached.Routes))
	for _, route := range cached.Routes {
		if !route.Route.Enabled || route.Route.Weight <= 0 {
			continue
		}
		key := capabilityFingerprint(route.VariantSpec)
		if !seen[key] {
			seen[key] = true
			variants = append(variants, route.VariantSpec)
		}
	}
	return PublicLogicalModel{ID: item.ID, Code: item.Code, Name: item.Name, Icon: item.Icon, Description: item.Description, Capability: item.Capability, SortOrder: item.SortOrder, PricePolicy: item.PricePolicy, BillingMode: item.BillingMode, UnitPriceMicrocredits: item.UnitPriceMicrocredits, InputPriceMicrocredits: item.InputPriceMicrocredits, OutputPriceMicrocredits: item.OutputPriceMicrocredits, CachedPriceMicrocredits: item.CachedPriceMicrocredits, CapabilitySpec: productSpec, CapabilityProfiles: variants, DefaultOptions: cached.Defaults, Available: available}
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
			continue
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
	variantByID := make(map[string]model.PhysicalCapabilityVariant, len(graph.Variants))
	for _, variant := range graph.Variants {
		variantByID[variant.ID] = variant
	}
	channelModelByID := make(map[string]model.ChannelModel, len(graph.ChannelModels))
	for _, channelModel := range graph.ChannelModels {
		channelModelByID[channelModel.ID] = channelModel
	}
	admin := AdminLogicalModel{PublicLogicalModel: publicLogicalModel(cachedLogicalModel{Model: item, ProductSpec: productSpec, Defaults: map[string]any{}}, false), Enabled: item.Enabled, ActiveRevisionID: graph.Revision.ID, RevisionVersion: graph.Revision.Version, Routes: []AdminLogicalRoute{}}
	for _, route := range graph.Routes {
		variant, variantOK := variantByID[route.PhysicalVariantID]
		if !variantOK {
			continue
		}
		channelModel, channelOK := channelModelByID[variant.ChannelModelID]
		if !channelOK {
			continue
		}
		variantSpec, specErr := effectivePhysicalVariantSpec(variant, channelModel)
		if specErr != nil {
			continue
		}
		_, channelOK = systemChannelByID[channelModel.ChannelID]
		structurallyAvailable := route.Enabled && route.Weight > 0 && variant.Enabled && channelModel.Enabled && channelOK
		available := structurallyAvailable && (item.PricePolicy != "channel" || channelModel.PriceConfigured)
		admin.Routes = append(admin.Routes, AdminLogicalRoute{ID: route.ID, PhysicalVariantID: variant.ID, PhysicalVariantName: variant.Name, ChannelModelID: channelModel.ID, ChannelID: channelModel.ChannelID, PhysicalModelKey: channelModel.ModelKey, PhysicalModelName: channelModel.DisplayName, Enabled: route.Enabled, Priority: route.Priority, Weight: route.Weight, Available: available, structurallyAvailable: structurallyAvailable, CapabilitySpec: variantSpec})
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
			result = append(result, route.VariantSpec)
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
	if pricePolicy == "unified" && billingMode == "token" && capability != "text" {
		return nil, nil, nil, false, BadAuthRequest("当前仅文本前台模型支持 Token 计费")
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
	}
	item.Code, item.Name, item.Icon, item.Description, item.Capability = code, name, strings.TrimSpace(req.Icon), strings.TrimSpace(req.Description), capability
	item.Enabled, item.SortOrder, item.PricePolicy, item.BillingMode = req.Enabled, req.SortOrder, pricePolicy, billingMode
	item.UnitPriceMicrocredits, item.InputPriceMicrocredits, item.OutputPriceMicrocredits, item.CachedPriceMicrocredits = req.UnitPriceMicrocredits, req.InputPriceMicrocredits, req.OutputPriceMicrocredits, req.CachedPriceMicrocredits
	item.UpdatedAt = time.Now()
	revisionID, err := s.repo.NextPrefixedID("REVISION")
	if err != nil {
		return nil, nil, nil, false, err
	}
	specJSON, _ := json.Marshal(req.CapabilitySpec)
	defaultsJSON, _ := json.Marshal(defaultMap(req.DefaultOptions))
	revision := &model.LogicalModelRevision{ID: revisionID, LogicalModelID: item.ID, CapabilitySpecJSON: string(specJSON), DefaultOptionsJSON: string(defaultsJSON), CreatedBy: actor.ID, CreatedAt: time.Now()}
	routes := make([]model.LogicalModelRoute, 0, len(req.Routes))
	seenVariants := make(map[string]bool, len(req.Routes))
	structuralRouteSpecs := make([]CapabilitySpec, 0, len(req.Routes))
	settlementRouteSpecs := make([]CapabilitySpec, 0, len(req.Routes))
	for _, input := range req.Routes {
		variantID := strings.TrimSpace(input.PhysicalVariantID)
		if variantID == "" || seenVariants[variantID] {
			return nil, nil, nil, false, BadAuthRequest("供应线路必须选择不重复的可用配置")
		}
		seenVariants[variantID] = true
		variant, variantErr := s.repo.PhysicalVariant(variantID)
		if variantErr != nil {
			return nil, nil, nil, false, BadAuthRequest("供应线路引用的可用配置不存在")
		}
		channelModel, modelErr := s.repo.ChannelModel(variant.ChannelModelID)
		if modelErr != nil {
			return nil, nil, nil, false, BadAuthRequest("可用配置引用的渠道模型不存在")
		}
		variantSpec, specErr := effectivePhysicalVariantSpec(*variant, *channelModel)
		if specErr != nil || normalizeCapability(variantSpec.Capability) != capability {
			return nil, nil, nil, false, BadAuthRequest("供应线路能力类型与前台模型不一致")
		}
		if req.Enabled && input.Enabled && input.Weight <= 0 {
			return nil, nil, nil, false, BadAuthRequest("启用供应线路的同级权重必须大于 0")
		}
		if input.Weight < 0 {
			return nil, nil, nil, false, BadAuthRequest("供应线路的同级权重不能为负数")
		}
		if req.Enabled && input.Enabled && variant.Enabled {
			if err := validateVariantWithinChannelModel(*channelModel, variantSpec); err != nil {
				return nil, nil, nil, false, err
			}
			if channelModel.Enabled {
				if _, channelErr := s.repo.SystemChannel(channelModel.ChannelID); channelErr == nil {
					structuralRouteSpecs = append(structuralRouteSpecs, variantSpec)
					if pricePolicy != "channel" || channelModel.PriceConfigured {
						settlementRouteSpecs = append(settlementRouteSpecs, variantSpec)
					}
				}
			}
		}
		routeID, idErr := s.repo.NextPrefixedID("ROUTE")
		if idErr != nil {
			return nil, nil, nil, false, idErr
		}
		routes = append(routes, model.LogicalModelRoute{ID: routeID, PhysicalVariantID: variant.ID, Enabled: input.Enabled, Priority: input.Priority, Weight: input.Weight, CreatedAt: time.Now(), UpdatedAt: time.Now()})
	}
	// 停用必须始终可执行，便于管理员立即阻止失效配置继续对外服务；重新启用时再强校验结构能力和计费可用性。
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

func (s *Service) AdminPhysicalVariants(actor *model.User) ([]AdminPhysicalVariant, error) {
	return s.adminPhysicalVariants(actor, "")
}

func (s *Service) AdminPhysicalVariantsForChannelModel(actor *model.User, channelModelID string) ([]AdminPhysicalVariant, error) {
	return s.adminPhysicalVariants(actor, strings.TrimSpace(channelModelID))
}

func (s *Service) adminPhysicalVariants(actor *model.User, channelModelID string) ([]AdminPhysicalVariant, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	var variants []model.PhysicalCapabilityVariant
	var err error
	if channelModelID != "" {
		if _, err := s.repo.ChannelModel(channelModelID); err != nil {
			return nil, BadAuthRequest("渠道模型不存在")
		}
		variants, err = s.repo.PhysicalVariants([]string{channelModelID}, true)
	} else {
		variants, err = s.repo.AllPhysicalVariants(true)
	}
	if err != nil {
		return nil, err
	}
	variantIDs := make([]string, 0, len(variants))
	for _, variant := range variants {
		variantIDs = append(variantIDs, variant.ID)
	}
	usageCounts, err := s.repo.PhysicalVariantRouteCounts(variantIDs)
	if err != nil {
		return nil, err
	}
	result := make([]AdminPhysicalVariant, 0, len(variants))
	for _, variant := range variants {
		channelModel, modelErr := s.repo.ChannelModel(variant.ChannelModelID)
		if modelErr != nil {
			continue
		}
		spec, specErr := effectivePhysicalVariantSpec(variant, *channelModel)
		if specErr != nil {
			continue
		}
		result = append(result, AdminPhysicalVariant{ID: variant.ID, ChannelModelID: channelModel.ID, ChannelID: channelModel.ChannelID, ModelKey: channelModel.ModelKey, ModelName: channelModel.DisplayName, Name: variant.Name, Capability: channelModel.Capability, Protocol: string(channelModel.Protocol), Enabled: variant.Enabled, ModelEnabled: channelModel.Enabled, UsageCount: usageCounts[variant.ID], CapabilitySpec: spec})
	}
	return result, nil
}

func effectivePhysicalVariantSpec(variant model.PhysicalCapabilityVariant, channelModel model.ChannelModel) (CapabilitySpec, error) {
	config, configErr := DecodeModelCapabilityConfig(channelModel.CapabilityConfigJSON)
	if configErr == nil && config != nil {
		if spec, err := CapabilitySpecFromModelCapabilityConfig(config, normalizeCapability(channelModel.Capability)); err == nil {
			return spec, nil
		}
	}
	// 音频模型以及历史数据可能没有新的能力配置，保留旧快照作为只读降级，避免读路径直接丢失线路。
	return DecodeCapabilitySpec(variant.CapabilitySpecJSON)
}

func (s *Service) SaveAdminPhysicalVariant(actor *model.User, id string, req PhysicalVariantRequest) (*AdminPhysicalVariant, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channelModel, err := s.repo.ChannelModel(strings.TrimSpace(req.ChannelModelID))
	if err != nil {
		return nil, BadAuthRequest("请选择有效的渠道模型")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len([]rune(name)) > 120 {
		return nil, BadAuthRequest("请填写 1-120 个字符的可用配置名称")
	}
	creating := strings.TrimSpace(id) == ""
	var item *model.PhysicalCapabilityVariant
	if creating {
		existing, existingErr := s.repo.PhysicalVariants([]string{channelModel.ID}, true)
		if existingErr != nil {
			return nil, existingErr
		}
		if len(existing) > 0 {
			return nil, BadAuthRequest("一个渠道模型只能配置一个可用配置，请编辑现有配置")
		}
		id, err = s.repo.NextPrefixedID("VARIANT")
		if err != nil {
			return nil, err
		}
		item = &model.PhysicalCapabilityVariant{ID: id, CreatedAt: time.Now()}
	} else {
		item, err = s.repo.PhysicalVariant(id)
		if err != nil {
			return nil, err
		}
		if item.ChannelModelID != channelModel.ID {
			return nil, BadAuthRequest("已创建的可用配置不能换绑渠道模型，请新建可用配置")
		}
	}
	// variant 不再承载第二份可编辑能力配置，能力快照始终从渠道模型生成。
	// 读取旧请求中的 capabilitySpec 仅为兼容旧客户端，不再作为事实来源。
	// 停用是强制止损操作：即使渠道模型能力 JSON 已损坏，也必须允许管理员先停用；
	// 只有启用路径才要求重新生成并校验能力快照。
	capabilityConfig, configErr := DecodeModelCapabilityConfig(channelModel.CapabilityConfigJSON)
	derivedSpec, deriveErr := CapabilitySpecFromModelCapabilityConfig(capabilityConfig, normalizeCapability(channelModel.Capability))
	if req.Enabled {
		if configErr != nil {
			return nil, BadAuthRequest("渠道模型能力配置无效，请先修复渠道模型")
		}
		if deriveErr != nil {
			return nil, deriveErr
		}
		if err := validateVariantWithinChannelModel(*channelModel, derivedSpec); err != nil {
			return nil, err
		}
	}
	spec := derivedSpec
	if deriveErr != nil {
		// 禁用时保留已有快照，避免坏配置导致管理列表丢失；新建记录使用最小可读快照。
		if existingSpec, existingErr := DecodeCapabilitySpec(item.CapabilitySpecJSON); existingErr == nil {
			spec = existingSpec
		} else {
			spec = CapabilitySpec{Version: 1, Capability: normalizeCapability(channelModel.Capability)}
		}
	}
	specJSON, _ := json.Marshal(spec)
	item.ChannelModelID, item.Name, item.Enabled, item.CapabilitySpecJSON, item.UpdatedAt = channelModel.ID, name, req.Enabled, string(specJSON), time.Now()
	if creating {
		err = s.repo.CreatePhysicalVariant(item)
	} else {
		err = s.repo.SavePhysicalVariant(item)
	}
	if err != nil {
		return nil, err
	}
	s.invalidateRouteCatalog()
	_ = s.appendAdminAudit(actor, map[bool]string{true: "physical_variant.create", false: "physical_variant.update"}[creating], "physical_variant", item.ID, "保存可用配置", map[string]any{"channelModelId": channelModel.ID})
	variants, err := s.AdminPhysicalVariants(actor)
	if err != nil {
		return nil, err
	}
	for index := range variants {
		if variants[index].ID == item.ID {
			return &variants[index], nil
		}
	}
	return nil, gorm.ErrRecordNotFound
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

// 可用配置只能收窄渠道模型能力，不能声明协议适配器实际无法发送的范围。
func validateVariantWithinChannelModel(channelModel model.ChannelModel, spec CapabilitySpec) error {
	profile, err := DecodeModelCapabilityConfig(channelModel.CapabilityConfigJSON)
	if err != nil {
		return BadAuthRequest("渠道模型能力配置无效，请先修复渠道模型")
	}
	switch normalizeCapability(spec.Capability) {
	case "text":
		if profile == nil || profile.Text == nil {
			return BadAuthRequest("渠道文本模型尚未配置能力参数")
		}
		limits := map[string]int{"image": profile.Text.References.MaxImages, "video": profile.Text.References.MaxVideos}
		for kind, constraint := range spec.Inputs {
			limit, known := limits[kind]
			if !known && constraint.Max > 0 || known && constraint.Max > limit {
				return BadAuthRequest("可用配置的 " + kind + " 输入上限超过渠道模型配置")
			}
		}
		return validateKnownVariantOptions(spec.Options, map[string]OptionConstraint{})
	case "image":
		if profile == nil || profile.Image == nil {
			return BadAuthRequest("渠道图片模型尚未配置能力参数")
		}
		image := profile.Image
		for kind, constraint := range spec.Inputs {
			switch kind {
			case "image":
				if constraint.Max > image.References.MaxImages {
					return BadAuthRequest("可用配置的图片输入上限超过渠道模型配置")
				}
			case "mask":
				if constraint.Max > 1 || constraint.Max > 0 && !image.References.MaskSupported {
					return BadAuthRequest("可用配置声明了渠道模型不支持的蒙版输入")
				}
			default:
				if constraint.Max > 0 {
					return BadAuthRequest("图片协议尚未接入 " + kind + " 输入")
				}
			}
		}
		physical := map[string]OptionConstraint{
			"size":                  imageSizeOptionConstraint(image.Size),
			"quality":               anyValues(image.Quality.Values),
			"transparentBackground": boolValues(image.TransparentBackground.Supported),
			"count":                 numericRange(1, float64(image.MaxOutputs), 1),
		}
		return validateKnownVariantOptions(spec.Options, physical)
	case "video":
		if profile == nil || profile.Video == nil {
			return BadAuthRequest("渠道视频模型尚未配置能力参数")
		}
		video := profile.Video
		limits := map[string]int{"image": video.References.MaxImages, "video": video.References.MaxVideos, "audio": video.References.MaxAudios}
		for kind, constraint := range spec.Inputs {
			limit, known := limits[kind]
			if !known && constraint.Max > 0 || known && constraint.Max > limit {
				return BadAuthRequest("可用配置的 " + kind + " 输入上限超过渠道模型配置")
			}
		}
		for _, operation := range spec.Operations {
			if !containsCapabilityString(video.Operations, operation) {
				return BadAuthRequest("可用配置包含渠道模型不支持的操作：" + operation)
			}
		}
		duration := OptionConstraint{}
		if video.Duration.Selection == "enum" {
			values := make([]any, 0, len(video.Duration.Values))
			for _, value := range video.Duration.Values {
				values = append(values, value)
			}
			duration.Values = values
		} else {
			duration = numericRange(float64(video.Duration.Min), float64(video.Duration.Max), float64(video.Duration.Step))
		}
		physical := map[string]OptionConstraint{
			"videoSeconds":       duration,
			"size":               anyValues(video.Ratios),
			"vquality":           anyValues(video.Resolutions),
			"videoGenerateAudio": boolValues(video.GenerateAudio.Supported),
			"videoWatermark":     boolValues(video.Watermark.Supported),
		}
		return validateKnownVariantOptions(spec.Options, physical)
	case "audio":
		for kind, constraint := range spec.Inputs {
			if constraint.Max > 0 {
				return BadAuthRequest("音频协议尚未接入 " + kind + " 输入")
			}
		}
		wildcard := OptionConstraint{Values: []any{"*"}}
		return validateKnownVariantOptions(spec.Options, map[string]OptionConstraint{"audioVoice": wildcard, "audioFormat": wildcard, "audioSpeed": wildcard, "audioInstructions": wildcard})
	}
	return BadAuthRequest("可用配置类型暂不支持")
}

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

func validateKnownVariantOptions(options map[string]OptionConstraint, physical map[string]OptionConstraint) error {
	for name, constraint := range options {
		limit, known := physical[name]
		if !known {
			return BadAuthRequest("参数 " + name + " 尚未接入该类型的供应商协议映射")
		}
		if !optionConstraintWithin(constraint, limit) {
			return BadAuthRequest("参数 " + name + " 超过渠道模型能力范围")
		}
	}
	return nil
}

func optionConstraintWithin(candidate OptionConstraint, limit OptionConstraint) bool {
	return optionConstraintCovered(candidate, "value", []CapabilitySpec{{Options: map[string]OptionConstraint{"value": limit}}})
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
