package service

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type CapabilitySpec struct {
	Version    int                         `json:"version"`
	Capability string                      `json:"capability"`
	Operations []string                    `json:"operations,omitempty"`
	Inputs     map[string]InputConstraint  `json:"inputs,omitempty"`
	Options    map[string]OptionConstraint `json:"options,omitempty"`
}

type InputConstraint struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

type OptionConstraint struct {
	Values []any    `json:"values,omitempty"`
	Min    *float64 `json:"min,omitempty"`
	Max    *float64 `json:"max,omitempty"`
	Step   *float64 `json:"step,omitempty"`
}

type ModelRequestIntent struct {
	Capability string         `json:"capability"`
	Operation  string         `json:"operation,omitempty"`
	Inputs     map[string]int `json:"inputs,omitempty"`
	Options    map[string]any `json:"options,omitempty"`
}

// ModelRequestIntentFromTaskInput 从统一任务输入推导路由意图；它只统计实际输入和显式参数，不假设任何固定图片数或视频时长。
func ModelRequestIntentFromTaskInput(input map[string]any, taskType string, operation string) ModelRequestIntent {
	capability := normalizeCapability(fmt.Sprint(input["mode"]))
	if capability == "" {
		capability = capabilityFromTaskType(taskType)
	}
	intent := ModelRequestIntent{Capability: capability, Operation: strings.TrimSpace(operation), Inputs: map[string]int{}, Options: map[string]any{}}
	for inputType, key := range map[string]string{"image": "referenceImages", "video": "referenceVideos", "audio": "referenceAudios"} {
		if values, ok := input[key].([]any); ok {
			intent.Inputs[inputType] = len(values)
		}
	}
	if mask, exists := input["mask"]; exists && mask != nil {
		intent.Inputs["mask"] = 1
	}
	explicitOptions := false
	if options, ok := input["capabilityOptions"].(map[string]any); ok {
		explicitOptions = true
		for key, value := range options {
			intent.Options[canonicalCapabilityOptionName(key)] = value
		}
	}
	if config, ok := input["config"].(map[string]any); ok && !explicitOptions {
		for key, value := range config {
			switch key {
			case "channelId", "apiFormat", "interfaceType", "baseUrl", "allowLocalChannel", "apiKey", "secretKey", "headers", "model", "capabilityConfig":
				continue
			default:
				canonical := canonicalCapabilityOptionName(key)
				if isCapabilityOptionFor(capability, canonical) && value != nil && strings.TrimSpace(fmt.Sprint(value)) != "" {
					intent.Options[canonical] = value
				}
			}
		}
	}
	return intent
}

type CapabilityMatch struct {
	Matched bool     `json:"matched"`
	Reasons []string `json:"reasons,omitempty"`
}

type cachedLogicalModel struct {
	Model       model.LogicalModel
	Revision    model.LogicalModelRevision
	ProductSpec CapabilitySpec
	Defaults    map[string]any
	Routes      []cachedLogicalRoute
}

type cachedLogicalRoute struct {
	Route        model.LogicalModelRoute
	Variant      model.PhysicalCapabilityVariant
	VariantSpec  CapabilitySpec
	ChannelModel model.ChannelModel
}

type routeCatalogSnapshot struct {
	LoadedAt       time.Time
	CatalogVersion int64
	Models         map[string]cachedLogicalModel
	Ordered        []string
}

type RoutedModel struct {
	LogicalModel model.LogicalModel
	Revision     model.LogicalModelRevision
	Route        model.LogicalModelRoute
	Variant      model.PhysicalCapabilityVariant
	ChannelModel model.ChannelModel
	Defaults     map[string]any
}

func DecodeCapabilitySpec(raw string) (CapabilitySpec, error) {
	var spec CapabilitySpec
	if err := json.Unmarshal([]byte(raw), &spec); err != nil {
		return spec, BadAuthRequest("能力配置不是有效 JSON")
	}
	normalized, err := NormalizeCapabilitySpec(spec)
	if err != nil {
		return spec, err
	}
	return normalized, nil
}

func ValidateCapabilitySpec(spec CapabilitySpec) error {
	_, err := NormalizeCapabilitySpec(spec)
	return err
}

func NormalizeCapabilitySpec(spec CapabilitySpec) (CapabilitySpec, error) {
	spec.Capability = normalizeCapability(spec.Capability)
	if spec.Version != 1 {
		return spec, BadAuthRequest("能力配置 version 必须为 1")
	}
	if spec.Capability == "" {
		return spec, BadAuthRequest("能力配置必须声明 capability")
	}
	operations := make([]string, 0, len(spec.Operations))
	seenOperations := make(map[string]bool, len(spec.Operations))
	for _, operation := range spec.Operations {
		normalized := normalizeCapabilityValue(operation)
		if normalized != "" && !seenOperations[normalized] {
			seenOperations[normalized] = true
			operations = append(operations, normalized)
		}
	}
	spec.Operations = operations
	normalizedInputs := make(map[string]InputConstraint, len(spec.Inputs))
	for rawName, constraint := range spec.Inputs {
		name := normalizeCapabilityValue(rawName)
		if name == "" || constraint.Min < 0 || constraint.Max < constraint.Min {
			return spec, BadAuthRequest("输入能力范围无效")
		}
		if _, exists := normalizedInputs[name]; exists {
			return spec, BadAuthRequest("输入能力存在重复名称：" + name)
		}
		normalizedInputs[name] = constraint
	}
	spec.Inputs = normalizedInputs
	normalizedOptions := make(map[string]OptionConstraint, len(spec.Options))
	for rawName, constraint := range spec.Options {
		name := canonicalCapabilityOptionName(rawName)
		if strings.TrimSpace(name) == "" {
			return spec, BadAuthRequest("能力参数名称不能为空")
		}
		if _, exists := normalizedOptions[name]; exists {
			return spec, BadAuthRequest("能力参数存在重复别名：" + name)
		}
		hasValues := len(constraint.Values) > 0
		hasRange := constraint.Min != nil || constraint.Max != nil || constraint.Step != nil
		if !hasValues && !hasRange {
			return spec, BadAuthRequest("能力参数必须声明 values 或数值范围")
		}
		if hasValues && hasRange {
			return spec, BadAuthRequest("能力参数不能同时声明 values 和数值范围")
		}
		if hasRange && (constraint.Min == nil || constraint.Max == nil) {
			return spec, BadAuthRequest("数值范围必须同时声明 min 和 max")
		}
		if constraint.Min != nil && constraint.Max != nil && *constraint.Max < *constraint.Min {
			return spec, BadAuthRequest("能力参数数值范围无效")
		}
		if constraint.Step != nil && *constraint.Step <= 0 {
			return spec, BadAuthRequest("能力参数 step 必须大于 0")
		}
		normalizedOptions[name] = constraint
	}
	spec.Options = normalizedOptions
	return spec, nil
}

func decodeLogicalDefaults(raw string, spec CapabilitySpec) (map[string]any, error) {
	defaults := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &defaults); err != nil {
		return nil, err
	}
	return normalizeLogicalDefaults(spec, defaults)
}

func MatchCapability(spec CapabilitySpec, intent ModelRequestIntent) CapabilityMatch {
	reasons := make([]string, 0)
	if normalizeCapability(intent.Capability) != normalizeCapability(spec.Capability) {
		reasons = append(reasons, "能力类型不匹配")
	}
	if operation := normalizeCapabilityValue(intent.Operation); operation != "" && len(spec.Operations) > 0 && !containsNormalized(spec.Operations, operation) {
		reasons = append(reasons, "不支持操作 "+intent.Operation)
	}
	for inputType, count := range intent.Inputs {
		if count < 0 {
			reasons = append(reasons, "输入数量不能小于 0")
			continue
		}
		constraint, declared := spec.Inputs[inputType]
		if !declared {
			if count > 0 {
				reasons = append(reasons, "不支持 "+capabilityInputLabel(inputType)+"输入")
			}
			continue
		}
		if count < constraint.Min || count > constraint.Max {
			reasons = append(reasons, fmt.Sprintf("%s数量需在 %d-%d 之间", capabilityInputLabel(inputType), constraint.Min, constraint.Max))
		}
	}
	for inputType, constraint := range spec.Inputs {
		if intent.Inputs[inputType] < constraint.Min {
			reasons = append(reasons, fmt.Sprintf("至少需要 %d 个%s", constraint.Min, capabilityInputLabel(inputType)))
		}
	}
	for name, value := range intent.Options {
		constraint, declared := spec.Options[canonicalCapabilityOptionName(name)]
		if !declared {
			reasons = append(reasons, "不支持参数 "+capabilityOptionLabel(name))
			continue
		}
		if !matchOptionConstraint(name, constraint, value) {
			reasons = append(reasons, "参数 "+capabilityOptionLabel(name)+"超出支持范围")
		}
	}
	return CapabilityMatch{Matched: len(reasons) == 0, Reasons: reasons}
}

func capabilityInputLabel(name string) string {
	switch normalizeCapabilityValue(name) {
	case "image":
		return "参考图片"
	case "video":
		return "参考视频"
	case "audio":
		return "参考音频"
	case "mask":
		return "蒙版"
	default:
		return name
	}
}

func capabilityOptionLabel(name string) string {
	switch canonicalCapabilityOptionName(name) {
	case "size":
		return "画面尺寸"
	case "quality":
		return "生成质量"
	case "transparentBackground":
		return "透明背景"
	case "count":
		return "输出数量"
	case "videoSeconds":
		return "视频时长"
	case "vquality":
		return "输出分辨率"
	case "videoGenerateAudio":
		return "同步音频"
	case "videoWatermark":
		return "水印设置"
	case "audioVoice":
		return "音色"
	case "audioFormat":
		return "音频格式"
	case "audioSpeed":
		return "语速"
	case "audioInstructions":
		return "朗读指令"
	default:
		return name
	}
}

func matchOptionConstraint(name string, constraint OptionConstraint, value any) bool {
	if len(constraint.Values) > 0 {
		for _, candidate := range constraint.Values {
			if normalizedScalar(candidate) == "*" {
				return true
			}
			if capabilityOptionValuesEqual(name, candidate, value) {
				return true
			}
		}
		return false
	}
	number, ok := numericScalar(value)
	if !ok {
		return false
	}
	if constraint.Min != nil && number < *constraint.Min {
		return false
	}
	if constraint.Max != nil && number > *constraint.Max {
		return false
	}
	if constraint.Step != nil && constraint.Min != nil {
		steps := (number - *constraint.Min) / *constraint.Step
		return math.Abs(steps-math.Round(steps)) < 1e-9
	}
	return true
}

func capabilityOptionValuesEqual(name string, candidate any, value any) bool {
	left := normalizedScalar(candidate)
	right := normalizedScalar(value)
	if canonicalCapabilityOptionName(name) == "vquality" {
		left = strings.TrimSuffix(left, "p")
		right = strings.TrimSuffix(right, "p")
	}
	return left == right
}

func normalizedScalar(value any) string {
	switch typed := value.(type) {
	case string:
		return normalizeCapabilityValue(typed)
	case bool:
		return strconv.FormatBool(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	default:
		encoded, _ := json.Marshal(value)
		return string(encoded)
	}
}

func numericScalar(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func containsNormalized(values []string, expected string) bool {
	for _, value := range values {
		if normalizeCapabilityValue(value) == expected {
			return true
		}
	}
	return false
}

func normalizeCapabilityValue(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func canonicalCapabilityOptionName(value string) string {
	name := strings.TrimSpace(value)
	switch name {
	case "duration":
		return "videoSeconds"
	case "aspectRatio":
		return "size"
	case "resolution":
		return "vquality"
	default:
		return name
	}
}

func isCapabilityOptionFor(capability string, name string) bool {
	switch normalizeCapability(capability) {
	case "image":
		return name == "size" || name == "quality" || name == "transparentBackground" || name == "count"
	case "video":
		return name == "size" || name == "videoSeconds" || name == "vquality" || name == "videoGenerateAudio" || name == "videoWatermark"
	case "audio":
		return name == "audioVoice" || name == "audioFormat" || name == "audioSpeed" || name == "audioInstructions"
	case "text":
		// systemPrompt 是请求内容，不是供应线路能力维度，不能参与路由匹配。
		return false
	default:
		return false
	}
}

func isProviderCapabilityOption(name string) bool {
	return isCapabilityOptionFor("image", name) || isCapabilityOptionFor("video", name) || isCapabilityOptionFor("audio", name) || isCapabilityOptionFor("text", name)
}

func (s *Service) invalidateRouteCatalog() {
	s.routeCatalogMu.Lock()
	s.routeCatalog = nil
	s.routeCatalogVersion++
	s.routeCatalogMu.Unlock()
	if s.coordinator != nil {
		if err := s.coordinator.bumpRouteCatalogVersion(context.Background()); err != nil {
			log.Printf("logical model route catalog distributed invalidation failed: %v", err)
		}
	}
}

func (s *Service) routeCatalogSnapshot() (*routeCatalogSnapshot, error) {
	now := time.Now()
	version := s.currentRouteCatalogVersion()
	s.routeCatalogMu.RLock()
	snapshot := s.routeCatalog
	if snapshot != nil && now.Sub(snapshot.LoadedAt) < s.routeCatalogTTL && snapshot.CatalogVersion == version {
		s.routeCatalogMu.RUnlock()
		return snapshot, nil
	}
	s.routeCatalogMu.RUnlock()

	s.routeCatalogRefreshMu.Lock()
	defer s.routeCatalogRefreshMu.Unlock()
	now = time.Now()
	version = s.currentRouteCatalogVersion()
	s.routeCatalogMu.RLock()
	snapshot = s.routeCatalog
	if snapshot != nil && now.Sub(snapshot.LoadedAt) < s.routeCatalogTTL && snapshot.CatalogVersion == version {
		s.routeCatalogMu.RUnlock()
		return snapshot, nil
	}
	s.routeCatalogMu.RUnlock()

	loaded, err := s.loadRouteCatalog()
	if err != nil {
		// 已有快照过期时允许短暂继续服务，数据库首次加载失败则明确失败。
		if snapshot != nil && now.Sub(snapshot.LoadedAt) <= s.routeCatalogMaxStale {
			log.Printf("logical model route catalog refresh failed, serving stale snapshot age=%s: %v", now.Sub(snapshot.LoadedAt).Round(time.Second), err)
			return snapshot, nil
		}
		return nil, err
	}
	s.routeCatalogMu.Lock()
	s.routeCatalog = loaded
	s.routeCatalogMu.Unlock()
	return loaded, nil
}

func (s *Service) currentRouteCatalogVersion() int64 {
	s.routeCatalogMu.RLock()
	localVersion := s.routeCatalogVersion
	s.routeCatalogMu.RUnlock()
	if s.coordinator == nil || s.coordinator.redis == nil {
		return localVersion
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	version, err := s.coordinator.routeCatalogVersion(ctx)
	if err != nil {
		log.Printf("logical model route catalog distributed version check failed: %v", err)
		return localVersion
	}
	if version > localVersion {
		return version
	}
	return localVersion
}

func (s *Service) loadRouteCatalog() (*routeCatalogSnapshot, error) {
	items, err := s.repo.LogicalModels(false)
	if err != nil {
		return nil, err
	}
	snapshot := &routeCatalogSnapshot{LoadedAt: time.Now(), CatalogVersion: s.currentRouteCatalogVersion(), Models: make(map[string]cachedLogicalModel), Ordered: make([]string, 0, len(items))}
	graphs, err := s.repo.LogicalModelGraphs(items, false)
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
	systemChannels, err := s.repo.SystemChannelsByIDs(systemChannelIDs, false)
	if err != nil {
		return nil, err
	}
	enabledSystemChannels := make(map[string]bool, len(systemChannels))
	for _, channel := range systemChannels {
		enabledSystemChannels[channel.ID] = true
	}
	for _, item := range items {
		graph := graphs[item.ID]
		if graph == nil || graph.Revision == nil {
			log.Printf("logical model omitted from route catalog id=%s: graph unavailable", item.ID)
			continue
		}
		productSpec, decodeErr := DecodeCapabilitySpec(graph.Revision.CapabilitySpecJSON)
		if decodeErr != nil {
			log.Printf("logical model omitted from route catalog id=%s: invalid product capability: %v", item.ID, decodeErr)
			continue
		}
		variantByID := make(map[string]model.PhysicalCapabilityVariant, len(graph.Variants))
		for _, variant := range graph.Variants {
			variantByID[variant.ID] = variant
		}
		channelModelByID := make(map[string]model.ChannelModel, len(graph.ChannelModels))
		for _, channelModel := range graph.ChannelModels {
			channelModelByID[channelModel.ID] = channelModel
		}
		cached := cachedLogicalModel{Model: item, Revision: *graph.Revision, ProductSpec: productSpec, Defaults: map[string]any{}}
		for _, route := range graph.Routes {
			variant, ok := variantByID[route.PhysicalVariantID]
			if !ok || !variant.Enabled {
				continue
			}
			channelModel, ok := channelModelByID[variant.ChannelModelID]
			if !ok || !channelModel.Enabled || !enabledSystemChannels[channelModel.ChannelID] {
				continue
			}
			if item.PricePolicy == "channel" && !channelModel.PriceConfigured {
				continue
			}
			variantSpec, specErr := effectivePhysicalVariantSpec(variant, channelModel)
			if specErr != nil {
				log.Printf("logical route omitted from catalog route_id=%s variant_id=%s: invalid capability: %v", route.ID, variant.ID, specErr)
				continue
			}
			cached.Routes = append(cached.Routes, cachedLogicalRoute{Route: route, Variant: variant, VariantSpec: variantSpec, ChannelModel: channelModel})
		}
		routeSpecs := make([]CapabilitySpec, 0, len(cached.Routes))
		for _, route := range cached.Routes {
			routeSpecs = append(routeSpecs, route.VariantSpec)
		}
		productSpec = capabilitySpecWithRoutePresets(productSpec, routeSpecs)
		defaults, defaultsErr := decodeLogicalDefaults(graph.Revision.DefaultOptionsJSON, productSpec)
		if defaultsErr != nil {
			log.Printf("logical model omitted from route catalog id=%s: invalid defaults: %v", item.ID, defaultsErr)
			continue
		}
		cached.ProductSpec = productSpec
		cached.Defaults = defaults
		snapshot.Models[item.ID] = cached
		snapshot.Ordered = append(snapshot.Ordered, item.ID)
	}
	return snapshot, nil
}

func (s *Service) ResolveLogicalModel(logicalModelID string, intent ModelRequestIntent) (*RoutedModel, error) {
	snapshot, err := s.routeCatalogSnapshot()
	if err != nil {
		return nil, err
	}
	cached, ok := snapshot.Models[strings.TrimSpace(logicalModelID)]
	if !ok {
		return nil, BadAuthRequest("所选模型不可用")
	}
	intent.Options = mergeIntentDefaults(intent.Options, cached.Defaults)
	if match := MatchCapability(cached.ProductSpec, intent); !match.Matched {
		return nil, BadAuthRequest("所选模型不支持当前请求：" + strings.Join(match.Reasons, "；"))
	}
	eligible := s.eligibleLogicalRoutes(cached.Routes, intent, nil)
	if len(eligible) == 0 {
		return nil, BadAuthRequest("当前模型暂时无法满足这组输入和参数")
	}
	selected := weightedRoute(eligible)
	return &RoutedModel{LogicalModel: cached.Model, Revision: cached.Revision, Route: selected.Route, Variant: selected.Variant, ChannelModel: selected.ChannelModel, Defaults: cached.Defaults}, nil
}

func (s *Service) eligibleLogicalRoutes(routes []cachedLogicalRoute, intent ModelRequestIntent, tried map[string]bool) []cachedLogicalRoute {
	eligible := make([]cachedLogicalRoute, 0, len(routes))
	maxPriority := math.MinInt
	for _, route := range routes {
		if !route.Route.Enabled || route.Route.Weight <= 0 || tried[route.Route.ID] || s.logicalRouteBlocked(route) {
			continue
		}
		if match := MatchCapability(route.VariantSpec, intent); !match.Matched {
			continue
		}
		if route.Route.Priority > maxPriority {
			eligible = eligible[:0]
			maxPriority = route.Route.Priority
		}
		if route.Route.Priority == maxPriority {
			eligible = append(eligible, route)
		}
	}
	return eligible
}

func (s *Service) logicalRouteBlocked(route cachedLogicalRoute) bool {
	now := time.Now()
	keys := []string{"channel:" + route.ChannelModel.ChannelID, "variant:" + route.Variant.ID, "route:" + route.Route.ID}
	// 这里会删除过期项，必须使用写锁；不要改成 RLock。
	s.routeHealthMu.Lock()
	for _, key := range keys {
		until, exists := s.routeHealthBlocked[key]
		if !exists {
			continue
		}
		if !until.After(now) {
			delete(s.routeHealthBlocked, key)
			continue
		}
		s.routeHealthMu.Unlock()
		return true
	}
	s.routeHealthMu.Unlock()

	if s.coordinator == nil || s.coordinator.redis == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	for _, key := range keys {
		until, err := s.coordinator.routeBlockedUntil(ctx, key)
		if err != nil {
			log.Printf("logical route distributed health check failed key=%s: %v", key, err)
			return false
		}
		if until.After(now) {
			return true
		}
	}
	return false
}

func mergeIntentDefaults(options map[string]any, defaults map[string]any) map[string]any {
	result := make(map[string]any, len(defaults)+len(options))
	for key, value := range defaults {
		result[key] = value
	}
	for key, value := range options {
		result[key] = value
	}
	return result
}

func weightedRoute(routes []cachedLogicalRoute) cachedLogicalRoute {
	if len(routes) == 1 {
		return routes[0]
	}
	var total int64
	for _, route := range routes {
		total += int64(route.Route.Weight)
	}
	if total <= 0 {
		return routes[0]
	}
	var raw [8]byte
	if _, err := cryptorand.Read(raw[:]); err != nil {
		return routes[0]
	}
	totalUnsigned := uint64(total)
	// 丢弃不能整除 total 的低概率尾部，避免取模造成轻微权重偏差。
	threshold := -totalUnsigned % totalUnsigned
	randomValue := binary.LittleEndian.Uint64(raw[:])
	for randomValue < threshold {
		if _, err := cryptorand.Read(raw[:]); err != nil {
			return routes[0]
		}
		randomValue = binary.LittleEndian.Uint64(raw[:])
	}
	pick := int64(randomValue % totalUnsigned)
	for _, route := range routes {
		if pick < int64(route.Route.Weight) {
			return route
		}
		pick -= int64(route.Route.Weight)
	}
	return routes[len(routes)-1]
}

func (s *Service) sortedRouteDiagnostics(routes []cachedLogicalRoute, intent ModelRequestIntent) []RouteSimulationCandidate {
	result := make([]RouteSimulationCandidate, 0, len(routes))
	poolPriority := math.MinInt
	for _, route := range routes {
		match := MatchCapability(route.VariantSpec, intent)
		blocked := s.logicalRouteBlocked(route)
		if route.Route.Enabled && route.Route.Weight > 0 && match.Matched && !blocked && route.Route.Priority > poolPriority {
			poolPriority = route.Route.Priority
		}
		result = append(result, RouteSimulationCandidate{RouteID: route.Route.ID, VariantID: route.Variant.ID, ChannelModelID: route.ChannelModel.ID, Priority: route.Route.Priority, Weight: route.Route.Weight, Enabled: route.Route.Enabled, Matched: match.Matched, Blocked: blocked, Reasons: match.Reasons})
	}
	for index := range result {
		result[index].InPool = result[index].Enabled && result[index].Weight > 0 && result[index].Matched && !result[index].Blocked && result[index].Priority == poolPriority
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].Priority > result[j].Priority })
	return result
}

func (s *Service) createRouteAttempt(task *model.Task, routed *RoutedModel, attemptNumber int) (*model.RouteAttempt, error) {
	id, err := s.repo.NextPrefixedID("ATTEMPT")
	if err != nil {
		return nil, err
	}
	channelModel, err := s.repo.ChannelModelByID(routed.ChannelModel.ChannelID, routed.ChannelModel.ID)
	if err != nil {
		return nil, err
	}
	attempt := &model.RouteAttempt{ID: id, TaskID: task.ID, RouteRun: task.RouteRun, AttemptNumber: attemptNumber, LogicalModelID: routed.LogicalModel.ID, LogicalModelRevisionID: routed.Revision.ID, RouteID: routed.Route.ID, PhysicalVariantID: routed.Variant.ID, ChannelModelID: channelModel.ID, ChannelID: channelModel.ChannelID, Status: "selected", DispatchState: "not_sent", StartedAt: time.Now()}
	if err := s.repo.CreateRouteAttempt(attempt); err != nil {
		return nil, err
	}
	return attempt, nil
}

func (s *Service) beginTaskRouteAttempt(task *model.Task) (*model.RouteAttempt, error) {
	if task == nil || task.LogicalModelID == "" {
		return nil, nil
	}
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		return nil, err
	}
	if len(attempts) > 0 {
		existing := &attempts[len(attempts)-1]
		switch existing.DispatchState {
		case "not_sent":
			return existing, nil
		case "accepted":
			if existing.ProviderRequestID != "" || task.ProviderRequestID != "" {
				if task.ProviderRequestID == "" {
					task.ProviderRequestID = existing.ProviderRequestID
					if err := s.repo.UpdateTaskProviderState(task.ID, task.ProviderRequestID, task.PollStage, task.NextPollAt); err != nil {
						return nil, err
					}
				}
				return existing, nil
			}
			return nil, routeDispatchUncertainError{"上游已接受请求，但没有可恢复的任务 ID"}
		case "submission_unknown":
			if existing.ProviderRequestID != "" || task.ProviderRequestID != "" {
				if task.ProviderRequestID == "" {
					task.ProviderRequestID = existing.ProviderRequestID
					if err := s.repo.UpdateTaskProviderState(task.ID, task.ProviderRequestID, task.PollStage, task.NextPollAt); err != nil {
						return nil, err
					}
				}
				existing.DispatchState = "accepted"
				if err := s.repo.SaveRouteAttempt(existing); err != nil {
					return nil, err
				}
				return existing, nil
			}
			return nil, routeDispatchUncertainError{"上一次提交结果不明确，为避免重复扣费已停止自动重发"}
		case "rejected_no_job":
			return s.switchTaskToNextRoute(task, attempts)
		}
	}
	routed, routeErr := s.routedModelForTaskSelection(task)
	if routeErr != nil {
		return s.switchTaskToNextRoute(task, attempts)
	}
	return s.createRouteAttempt(task, routed, len(attempts)+1)
}

func (s *Service) markRouteAttemptDispatching(attempt *model.RouteAttempt) error {
	if attempt == nil || attempt.DispatchState != "not_sent" {
		return nil
	}
	attempt.Status = "dispatching"
	// 在网络调用前先进入不确定态；只有明确未创建上游任务时才允许后续自动换路由。
	attempt.DispatchState = "submission_unknown"
	return s.repo.SaveRouteAttempt(attempt)
}

type routeDispatchUncertainError struct{ message string }

func (e routeDispatchUncertainError) Error() string { return e.message }

func isRouteDispatchUncertain(err error) bool {
	var target routeDispatchUncertainError
	return errors.As(err, &target)
}

func (s *Service) routedModelForTaskSelection(task *model.Task) (*RoutedModel, error) {
	route, err := s.repo.LogicalModelRoute(task.RouteID)
	if err != nil {
		return nil, err
	}
	if !route.Enabled || route.Weight <= 0 || route.LogicalModelRevisionID != task.LogicalModelRevisionID {
		return nil, errors.New("任务使用的模型服务配置已失效")
	}
	variant, err := s.repo.PhysicalVariant(task.PhysicalVariantID)
	if err != nil {
		return nil, err
	}
	if !variant.Enabled || route.PhysicalVariantID != variant.ID {
		return nil, errors.New("任务使用的模型服务配置已失效")
	}
	channelModel, err := s.repo.ChannelModel(variant.ChannelModelID)
	if err != nil {
		return nil, err
	}
	if !channelModel.Enabled {
		return nil, errors.New("任务使用的模型服务配置已失效")
	}
	if _, err := s.repo.SystemChannel(channelModel.ChannelID); err != nil {
		return nil, err
	}
	logicalModel, err := s.repo.LogicalModel(task.LogicalModelID)
	if err != nil {
		return nil, err
	}
	revision, err := s.repo.LogicalModelRevision(task.LogicalModelRevisionID)
	if err != nil {
		return nil, err
	}
	if revision.LogicalModelID != logicalModel.ID {
		return nil, errors.New("任务前台模型版本不一致")
	}
	productSpec, err := DecodeCapabilitySpec(revision.CapabilitySpecJSON)
	if err != nil {
		return nil, err
	}
	defaults, err := decodeLogicalDefaults(revision.DefaultOptionsJSON, productSpec)
	if err != nil {
		return nil, err
	}
	routed := &RoutedModel{LogicalModel: *logicalModel, Revision: *revision, Route: *route, Variant: *variant, ChannelModel: *channelModel, Defaults: defaults}
	spec, err := effectivePhysicalVariantSpec(*variant, *channelModel)
	if err != nil || s.logicalRouteBlocked(cachedLogicalRoute{Route: *route, Variant: *variant, VariantSpec: spec, ChannelModel: *channelModel}) {
		return nil, errors.New("当前模型服务暂不可用")
	}
	return routed, nil
}

func (s *Service) switchTaskToNextRoute(task *model.Task, attempts []model.RouteAttempt) (*model.RouteAttempt, error) {
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, err
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
		return nil, BadAuthRequest("任务输入格式无效，无法恢复模型服务")
	}
	logicalModel, err := s.repo.LogicalModel(task.LogicalModelID)
	if err != nil {
		return nil, err
	}
	revision, err := s.repo.LogicalModelRevision(task.LogicalModelRevisionID)
	if err != nil || revision.LogicalModelID != logicalModel.ID {
		return nil, errors.New("任务前台模型版本不存在或归属不一致")
	}
	productSpec, err := DecodeCapabilitySpec(revision.CapabilitySpecJSON)
	if err != nil {
		return nil, err
	}
	defaults, err := decodeLogicalDefaults(revision.DefaultOptionsJSON, productSpec)
	if err != nil {
		return nil, err
	}
	intent := ModelRequestIntentFromTaskInput(input, task.Type, task.Operation)
	intent.Options = mergeIntentDefaults(intent.Options, defaults)
	if match := MatchCapability(productSpec, intent); !match.Matched {
		return nil, BadAuthRequest("任务参数不再符合前台模型能力：" + strings.Join(match.Reasons, "；"))
	}
	routes, err := s.repo.LogicalModelRoutes(revision.ID, false)
	if err != nil {
		return nil, err
	}
	variants, err := s.repo.PhysicalVariantsForRoutes(routes, false)
	if err != nil {
		return nil, err
	}
	variantByID := make(map[string]model.PhysicalCapabilityVariant, len(variants))
	channelModelIDs := make([]string, 0, len(variants))
	for _, variant := range variants {
		variantByID[variant.ID] = variant
		channelModelIDs = append(channelModelIDs, variant.ChannelModelID)
	}
	channelModels, err := s.repo.ChannelModelsByIDs(channelModelIDs)
	if err != nil {
		return nil, err
	}
	channelModelByID := make(map[string]model.ChannelModel, len(channelModels))
	for _, channelModel := range channelModels {
		if !channelModel.Enabled {
			continue
		}
		if _, channelErr := s.repo.SystemChannel(channelModel.ChannelID); channelErr == nil {
			channelModelByID[channelModel.ID] = channelModel
		}
	}
	candidates := make([]cachedLogicalRoute, 0, len(routes))
	for _, route := range routes {
		variant, variantOK := variantByID[route.PhysicalVariantID]
		channelModel, channelOK := channelModelByID[variant.ChannelModelID]
		if !variantOK || !channelOK {
			continue
		}
		variantSpec, specErr := effectivePhysicalVariantSpec(variant, channelModel)
		if specErr != nil {
			continue
		}
		candidates = append(candidates, cachedLogicalRoute{Route: route, Variant: variant, VariantSpec: variantSpec, ChannelModel: channelModel})
	}
	tried := make(map[string]bool, len(attempts))
	for _, attempt := range attempts {
		tried[attempt.RouteID] = true
	}
	eligible := s.eligibleLogicalRoutes(candidates, intent, tried)
	if len(eligible) == 0 {
		return nil, BadAuthRequest("当前模型暂时无法满足这组输入和参数")
	}
	selected := weightedRoute(eligible)
	routed := &RoutedModel{LogicalModel: *logicalModel, Revision: *revision, Route: selected.Route, Variant: selected.Variant, ChannelModel: selected.ChannelModel, Defaults: defaults}
	nextInput := applyRoutedProviderSelection(input, routed)
	if err := s.ValidateTaskCapability(nextInput); err != nil {
		return nil, err
	}
	if err := s.protectTaskSecrets(nextInput); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(nextInput)
	if err != nil {
		return nil, err
	}
	var replacement *model.BillingOrder
	if logicalModel.PricePolicy == "channel" && task.BillingOrderID != "" {
		config, _ := input["config"].(map[string]any)
		capability := normalizeCapability(fmt.Sprint(input["mode"]))
		if capability == "" {
			capability = capabilityFromTaskType(task.Type)
		}
		replacement, err = s.newBillingOrder(task.UserID, task.ID, "route-switch:"+task.ID+":"+selected.Route.ID, selected.ChannelModel.ChannelID, selected.ChannelModel.ModelKey, capability, firstNonEmpty(strings.TrimSpace(task.Operation), task.Type), billingQuantity(capability, config["videoSeconds"]), estimateTaskBillingTokens(input, capability))
		if err != nil {
			return nil, err
		}
		replacement.Model = logicalModel.Code
	}
	previousRouteID := task.RouteID
	if err := s.repo.SwitchTaskLogicalRoute(task.ID, previousRouteID, selected.Route.ID, selected.Variant.ID, string(encoded), task.BillingOrderID, selected.ChannelModel.ChannelID, selected.ChannelModel.ID, replacement); err != nil {
		if errors.Is(err, repository.ErrInsufficientCredits) {
			return nil, BadAuthRequest("模型服务价格发生变化，当前积分余额不足")
		}
		return nil, err
	}
	task.RouteID = selected.Route.ID
	task.PhysicalVariantID = selected.Variant.ID
	task.InputJSON = string(encoded)
	task.ProviderRequestID = ""
	return s.createRouteAttempt(task, routed, len(attempts)+1)
}

func (s *Service) nextRouteAttemptAfterFailure(task *model.Task, attempt *model.RouteAttempt, taskErr error) (*model.RouteAttempt, error) {
	if task == nil || attempt == nil || attempt.DispatchState != "rejected_no_job" {
		return nil, nil
	}
	if errors.Is(taskErr, context.Canceled) || errors.Is(taskErr, context.DeadlineExceeded) {
		return nil, nil
	}
	s.blockLogicalRouteForFailure(attempt, taskErr)
	attempts, err := s.repo.RouteAttempts(task.ID, task.RouteRun)
	if err != nil {
		return nil, err
	}
	return s.switchTaskToNextRoute(task, attempts)
}

func (s *Service) blockLogicalRouteForFailure(attempt *model.RouteAttempt, taskErr error) {
	if attempt == nil {
		return
	}
	key := ""
	duration := time.Duration(0)
	if attempt.FailureCode == "upstream_401" || attempt.FailureCode == "upstream_403" {
		key, duration = "channel:"+attempt.ChannelID, 10*time.Minute
	} else if attempt.FailureCode == "upstream_404" {
		key, duration = "variant:"+attempt.PhysicalVariantID, 10*time.Minute
	} else if attempt.FailureCode == "upstream_429" {
		key, duration = "channel:"+attempt.ChannelID, 30*time.Second
		var upstream providerHTTPError
		if errors.As(taskErr, &upstream) && upstream.RetryAfter > 0 {
			duration = upstream.RetryAfter
		}
	}
	if key == "" || duration <= 0 {
		return
	}
	until := time.Now().Add(duration)
	s.routeHealthMu.Lock()
	// 本地状态是 Redis 不可用时的降级，也能覆盖 Redis 写入瞬间的网络抖动。
	s.routeHealthBlocked[key] = until
	s.routeHealthMu.Unlock()
	if s.coordinator != nil && s.coordinator.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		if err := s.coordinator.blockRoute(ctx, key, until); err != nil {
			log.Printf("logical route distributed health update failed key=%s: %v", key, err)
		}
	}
}

func (s *Service) prepareLogicalTaskRetry(task *model.Task, input map[string]any) error {
	if task == nil || task.LogicalModelID == "" {
		return nil
	}
	intent := ModelRequestIntentFromTaskInput(input, task.Type, task.Operation)
	routed, err := s.ResolveLogicalModel(task.LogicalModelID, intent)
	if err != nil {
		return err
	}
	input = applyRoutedProviderSelection(input, routed)
	if err := s.ValidateTaskCapability(input); err != nil {
		return err
	}
	if err := s.protectTaskSecrets(input); err != nil {
		return err
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return err
	}
	task.LogicalModelRevisionID = routed.Revision.ID
	task.RouteID = routed.Route.ID
	task.PhysicalVariantID = routed.Variant.ID
	task.Model = routed.LogicalModel.Code
	task.Provider = "managed"
	task.InputJSON = string(encoded)
	return nil
}

func (s *Service) finishTaskRouteAttempt(attempt *model.RouteAttempt, task *model.Task, taskErr error) {
	if attempt == nil {
		return
	}
	now := time.Now()
	attempt.CompletedAt = &now
	if task != nil {
		attempt.ProviderRequestID = task.ProviderRequestID
	}
	if taskErr == nil {
		attempt.Status = "succeeded"
		attempt.DispatchState = "accepted"
	} else {
		attempt.Status = "failed"
		attempt.FailureMessage = truncateRunes(taskFailureMessage(taskErr), 1000)
		attempt.FailureCode = routeFailureCode(taskErr)
		if attempt.ProviderRequestID != "" {
			attempt.DispatchState = "accepted"
		} else if safeRouteRejection(taskErr) {
			attempt.DispatchState = "rejected_no_job"
		} else {
			attempt.DispatchState = "submission_unknown"
		}
	}
	if err := s.repo.SaveRouteAttempt(attempt); err != nil {
		log.Printf("route attempt terminal state save failed attempt_id=%s task_id=%s: %v", attempt.ID, attempt.TaskID, err)
	}
}

func routeFailureCode(err error) string {
	if code, _ := ChannelSlotFailureDetails(err); code != "" {
		return code
	}
	var upstream providerHTTPError
	if errors.As(err, &upstream) {
		return fmt.Sprintf("upstream_%d", upstream.StatusCode)
	}
	return "submission_unknown"
}

func safeRouteRejection(err error) bool {
	if err == nil {
		return false
	}
	if code, _ := ChannelSlotFailureDetails(err); code != "" {
		return true
	}
	var upstream providerHTTPError
	if errors.As(err, &upstream) {
		switch upstream.StatusCode {
		case 401, 403, 404, 429:
			return true
		}
	}
	return false
}
