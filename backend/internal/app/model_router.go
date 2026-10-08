package app

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/binary"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

func (s *Service) invalidateRouteCatalog() {
	s.routeCatalogRefreshMu.Lock()
	s.routeCatalogMu.Lock()
	s.routeCatalog = nil
	s.routeCatalogVersion++
	s.routeCatalogRetryAt = time.Time{}
	s.routeCatalogRefreshError = nil
	s.routeCatalogMu.Unlock()
	s.routeCatalogRefreshMu.Unlock()
	if s.coordinator != nil {
		ctx, cancel := context.WithTimeout(context.Background(), runtimeCoordinationTimeout)
		defer cancel()
		if err := s.coordinator.BumpRouteCatalogVersion(ctx); err != nil {
			log.Printf("logical model route catalog distributed invalidation failed: %v", err)
		}
	}
	s.initReadCaches()
	s.routeVersionReadCache.Clear()
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

	// 刷新锁只能防止并行回源，失败后还需要冷却，否则等待者会逐个重打数据库。
	if s.routeCatalogRefreshError != nil && now.Before(s.routeCatalogRetryAt) {
		if snapshot != nil && snapshot.CatalogVersion == version && now.Sub(snapshot.LoadedAt) <= s.routeCatalogMaxStale {
			return snapshot, nil
		}
		return nil, s.routeCatalogRefreshError
	}
	loaded, err := s.loadRouteCatalog()
	if err != nil {
		s.routeCatalogRefreshError = err
		s.routeCatalogRetryAt = time.Now().Add(2 * time.Second)
		log.Printf("logical model route catalog refresh failed; retry cooled down: %v", err)
		// 已有快照过期时允许短暂继续服务，数据库首次加载失败则明确失败。
		if snapshot != nil && snapshot.CatalogVersion == version && now.Sub(snapshot.LoadedAt) <= s.routeCatalogMaxStale {
			return snapshot, nil
		}
		return nil, err
	}
	s.routeCatalogRefreshError = nil
	s.routeCatalogRetryAt = time.Time{}
	s.routeCatalogMu.Lock()
	s.routeCatalog = loaded
	s.routeCatalogMu.Unlock()
	return loaded, nil
}

func (s *Service) currentRouteCatalogVersion() int64 {
	s.routeCatalogMu.RLock()
	localVersion := s.routeCatalogVersion
	s.routeCatalogMu.RUnlock()
	if s.coordinator == nil || !s.coordinator.HasRedis() {
		return localVersion
	}
	s.initReadCaches()
	ctx, cancel := context.WithTimeout(context.Background(), runtimeCoordinationTimeout)
	defer cancel()
	version, err := s.routeVersionReadCache.Get(ctx, routeCatalogVersionKey, func(ctx context.Context) (int64, int, error) {
		value, err := s.coordinator.RouteCatalogVersion(ctx)
		if err != nil {
			log.Printf("logical model route catalog distributed version check failed: %v", err)
		}
		return value, 256, err
	})
	if err != nil {
		return localVersion
	}
	if version > localVersion {
		return version
	}
	return localVersion
}

func (s *Service) loadRouteCatalog() (*routeCatalogSnapshot, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	repo := s.repo.WithContext(ctx)
	items, err := repo.LogicalModels(false)
	if err != nil {
		return nil, err
	}
	snapshot := &routeCatalogSnapshot{LoadedAt: time.Now(), CatalogVersion: s.currentRouteCatalogVersion(), Models: make(map[string]cachedLogicalModel), Ordered: make([]string, 0, len(items))}
	graphs, err := repo.LogicalModelGraphs(items, false)
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
	systemChannels, err := repo.SystemChannelsByIDs(systemChannelIDs, false)
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
		channelModelByID := make(map[string]model.ChannelModel, len(graph.ChannelModels))
		for _, channelModel := range graph.ChannelModels {
			channelModelByID[channelModel.ID] = channelModel
		}
		cached := cachedLogicalModel{Model: item, Revision: *graph.Revision, ProductSpec: productSpec, Defaults: map[string]any{}}
		for _, route := range graph.Routes {
			channelModel, ok := channelModelByID[route.ChannelModelID]
			if !ok || !channelModel.Enabled || !enabledSystemChannels[channelModel.ChannelID] {
				continue
			}
			if item.PricePolicy == "unified" && item.BillingMode == "token" && !supportsTokenBilling(item.Capability, channelModel.Protocol) {
				continue
			}
			if item.PricePolicy == "channel" && !channelModelHasActivePriceTier(channelModel) {
				continue
			}
			capabilitySpec, specErr := channelModelCapabilitySpec(channelModel)
			if specErr != nil {
				log.Printf("logical route omitted from catalog route_id=%s channel_model_id=%s: invalid capability: %v", route.ID, channelModel.ID, specErr)
				continue
			}
			cached.Routes = append(cached.Routes, cachedLogicalRoute{Route: route, CapabilitySpec: capabilitySpec, ChannelModel: channelModel})
		}
		productSpec = capabilitySpecWithRoutePresets(productSpec, enabledLogicalRouteSpecs(cached.Routes))
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

// ResolveLogicalModel 将创作意图解析为一次可执行的路由快照。
// 解析同时约束能力合同、启用状态、价格档和渠道协议；调用方不得在解析完成后自行替换其中任一供应链字段，
// 否则会出现“目录显示可用、任务实际走另一条线路”的配置漂移。
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
	eligible := s.eligibleLogicalRoutes(cached.Routes, intent, nil, cached.Model.PricePolicy == "channel")
	if len(eligible) == 0 {
		return nil, BadAuthRequest("当前模型暂时无法满足这组输入和参数")
	}
	selected := weightedRoute(eligible)
	var priceTier *model.ChannelModelPriceTier
	if cached.Model.PricePolicy == "channel" {
		priceTier = channelModelPriceTierForIntent(selected.ChannelModel, intent)
		if priceTier == nil {
			return nil, BadAuthRequest("当前模型尚未配置所选规格的价格")
		}
	}
	return &RoutedModel{LogicalModel: cached.Model, Revision: cached.Revision, Route: selected.Route, ChannelModel: selected.ChannelModel, PriceTier: priceTier, Defaults: cached.Defaults}, nil
}

func (s *Service) eligibleLogicalRoutes(routes []cachedLogicalRoute, intent ModelRequestIntent, tried map[string]bool, requirePriceTier bool) []cachedLogicalRoute {
	eligible := make([]cachedLogicalRoute, 0, len(routes))
	maxPriority := math.MinInt
	for _, route := range routes {
		if !route.Route.Enabled || route.Route.Weight <= 0 || tried[route.Route.ID] || s.logicalRouteBlocked(route) {
			continue
		}
		if match := MatchCapability(route.CapabilitySpec, intent); !match.Matched {
			continue
		}
		if requirePriceTier && channelModelPriceTierForIntent(route.ChannelModel, intent) == nil {
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

func channelModelHasActivePriceTier(channelModel model.ChannelModel) bool {
	for _, tier := range channelModel.PriceTiers {
		if tier.Enabled && tier.PriceConfigured {
			return true
		}
	}
	return false
}

// channelModelPriceTierForIntent 使用“精确规格优先、通配规格兜底”的规则。SKU 选择器与
// 运行意图使用同一组规范键，因而图片质量/画幅、视频分辨率/时长和生成操作都能独立定价。
func channelModelPriceTierForIntent(channelModel model.ChannelModel, intent ModelRequestIntent) *model.ChannelModelPriceTier {
	selector := skuSelectorForIntent(intent)
	bestScore := -1
	var best *model.ChannelModelPriceTier
	for index := range channelModel.PriceTiers {
		tier := &channelModel.PriceTiers[index]
		if !tier.Enabled || !tier.PriceConfigured {
			continue
		}
		matched, score := matchSKUSelector(skuSelectorForTier(*tier), selector)
		if !matched {
			continue
		}
		if score > bestScore {
			best, bestScore = tier, score
		}
	}
	return best
}

func skuSelectorForIntent(intent ModelRequestIntent) map[string]string {
	selector := map[string]string{}
	if operation := strings.ToLower(strings.TrimSpace(intent.Operation)); operation != "" {
		selector["operation"] = operation
	}
	switch normalizeCapability(intent.Capability) {
	case "video":
		// 价格档按实际参考素材归类。供应商执行仍可使用 reference_to_video、extend
		// 等细分操作；计价时视频参考优先归为视频生视频，其余图片参考无论数量
		// 都归为图生视频。
		if intent.Inputs["video"] > 0 {
			selector["operation"] = "video_to_video"
		} else if intent.Inputs["image"] > 0 {
			selector["operation"] = "image_to_video"
		}
		if count := intent.Inputs["image"]; count > 0 {
			selector["imageCount"] = strconv.Itoa(count)
		}
		if value := normalizeChannelModelTierResolution(fmt.Sprint(intent.Options["vquality"])); value != "*" {
			selector["vquality"] = value
		}
		if seconds, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(intent.Options["videoSeconds"]))); err == nil && seconds > 0 {
			selector["videoSeconds"] = strconv.Itoa(seconds)
		}
		if audio := normalizedScalar(intent.Options["videoGenerateAudio"]); audio == "true" || audio == "false" {
			selector["videoGenerateAudio"] = audio
		}
	case "image":
		if intent.Inputs["image"] > 0 {
			selector["operation"] = "image_to_image"
		} else {
			selector["operation"] = "text_to_image"
		}
		rawQuality, _ := intent.Options["quality"].(string)
		rawSize, _ := intent.Options["size"].(string)
		if quality := normalizeImagePriceQuality(rawQuality, rawSize); quality != "" {
			selector["quality"] = quality
		}
		for _, key := range []string{"quality", "size"} {
			if key == "quality" && selector["quality"] != "" {
				continue
			}
			text, _ := intent.Options[key].(string)
			if value := strings.ToLower(strings.TrimSpace(text)); value != "" && value != "auto" && value != "any" {
				selector[key] = value
			}
		}
	}
	return selector
}

func normalizeImagePriceQuality(rawQuality string, rawSize string) string {
	quality := strings.ToLower(strings.TrimSpace(rawQuality))
	if quality != "" && quality != "auto" && quality != "any" {
		return quality
	}
	parts := strings.Split(strings.ToLower(strings.TrimSpace(rawSize)), "x")
	if len(parts) != 2 {
		return ""
	}
	width, widthErr := strconv.ParseInt(strings.TrimSpace(parts[0]), 10, 64)
	height, heightErr := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 || width > (1<<32)/height {
		return ""
	}
	pixels := width * height
	switch {
	case pixels <= 2_000_000:
		return "1k"
	case pixels <= 4_300_000:
		return "2k"
	case pixels <= 8_294_400:
		return "4k"
	default:
		return ""
	}
}

func skuSelectorForTier(tier model.ChannelModelPriceTier) map[string]string {
	selector := model.DecodeSKUSelector(tier.SelectorJSON)
	if len(selector) == 0 {
		if resolution := normalizeChannelModelTierResolution(tier.Resolution); resolution != "*" {
			selector["vquality"] = resolution
		}
		if tier.VideoSeconds > 0 {
			selector["videoSeconds"] = strconv.Itoa(tier.VideoSeconds)
		}
	}
	return selector
}

func matchSKUSelector(tier map[string]string, requested map[string]string) (bool, int) {
	score := 0
	for key, expected := range tier {
		expected = strings.TrimSpace(expected)
		if expected == "" || expected == "*" {
			continue
		}
		if requested[key] != expected {
			return false, 0
		}
		score++
	}
	return true, score
}

func (s *Service) logicalRouteBlocked(route cachedLogicalRoute) bool {
	now := time.Now()
	keys := []string{"channel:" + route.ChannelModel.ChannelID, "channel-model:" + route.ChannelModel.ID, "route:" + route.Route.ID}
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

	if s.coordinator == nil || !s.coordinator.HasRedis() {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	for _, key := range keys {
		until, err := s.coordinator.RouteBlockedUntil(ctx, key)
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
		match := MatchCapability(route.CapabilitySpec, intent)
		blocked := s.logicalRouteBlocked(route)
		if route.Route.Enabled && route.Route.Weight > 0 && match.Matched && !blocked && route.Route.Priority > poolPriority {
			poolPriority = route.Route.Priority
		}
		result = append(result, RouteSimulationCandidate{RouteID: route.Route.ID, ChannelModelID: route.ChannelModel.ID, ChannelModelKey: route.ChannelModel.ModelKey, ChannelModelName: route.ChannelModel.DisplayName, Priority: route.Route.Priority, Weight: route.Route.Weight, Enabled: route.Route.Enabled, Matched: match.Matched, Blocked: blocked, Reasons: match.Reasons})
	}
	for index := range result {
		result[index].InPool = result[index].Enabled && result[index].Weight > 0 && result[index].Matched && !result[index].Blocked && result[index].Priority == poolPriority
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].Priority > result[j].Priority })
	return result
}
