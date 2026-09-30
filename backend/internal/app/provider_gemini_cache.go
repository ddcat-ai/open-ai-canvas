package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"

	"gorm.io/gorm"
)

const officialGeminiAgentInterface = "gemini-generate-content"
const geminiAgentCacheTTL = "3600s"
const geminiAgentCacheFormatVersion = "v2"

const (
	// Cache creation is an optimization and must never consume the model request's
	// full timeout. If the cache service is slow, the Agent uses the uncached body.
	geminiCacheCreateTimeout = 3 * time.Second
	geminiCacheDeleteTimeout = 2 * time.Second
	geminiCacheLockTimeout   = 750 * time.Millisecond
	geminiCacheLeaseTTL      = 10 * time.Second
)

// geminiCacheKeyLock serializes cache creation for one stable prefix inside a
// process. The reference count lets idle entries leave the map instead of
// growing with every distinct model/prompt identity.
type geminiCacheKeyLock struct {
	token chan struct{}
	refs  int
}

// prepareOfficialGeminiAgentCache creates or reuses Google's explicit
// CachedContent for the stable system/tool prefix. It is deliberately gated by
// the official interface ID: custom manifests must never receive a provider-
// specific cachedContent field that their upstream may not understand.
//
// The bool reports whether the returned spec actually uses cachedContent. Any
// error is cache-path-only; callers must log it and continue with the returned
// uncached spec rather than turning an optional optimization into an Agent
// failure.
func prepareOfficialGeminiAgentCache(ctx context.Context, input canvasGenerationInput, spec protocol.RequestSpec) (protocol.RequestSpec, bool, error) {
	return prepareOfficialGeminiAgentCacheMode(ctx, input, spec, false)
}

func prepareOfficialGeminiAgentCacheMode(ctx context.Context, input canvasGenerationInput, spec protocol.RequestSpec, forceRebuild bool) (protocol.RequestSpec, bool, error) {
	baseSpec, err := cloneProtocolRequestSpec(spec)
	if err != nil {
		return spec, false, err
	}
	if strings.TrimSpace(input.Config.InterfaceType) != officialGeminiAgentInterface {
		return baseSpec, false, nil
	}
	body := protocolBodyObject(baseSpec.Body)
	if body == nil {
		return baseSpec, false, errors.New("Gemini Agent 请求体必须是 JSON 对象")
	}
	stable, stableBytes, ok, err := geminiStableAgentPrefix(body)
	if err != nil {
		return baseSpec, false, err
	}
	if !ok {
		return baseSpec, false, nil
	}
	// Explicit caching has a provider-defined minimum context size. Do not
	// manufacture a cache request for a small prefix that Gemini will reject.
	if estimateGeminiCacheTokens(stableBytes) < geminiAgentCacheMinimumTokens(input.Config.Model) {
		return baseSpec, false, nil
	}

	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Service == nil || metadata.Service.repo == nil || strings.TrimSpace(metadata.UserID) == "" {
		return baseSpec, false, nil
	}
	cacheKey, credentialHash, err := geminiAgentCacheKey(input, metadata.UserID, stable)
	if err != nil {
		return baseSpec, false, err
	}

	if !forceRebuild {
		cache, lookupErr := metadata.Service.repo.GeminiCacheByKey(metadata.UserID, cacheKey)
		if lookupErr == nil && geminiCacheUsable(cache) {
			return applyGeminiCachedContent(baseSpec, cache.ResourceName), true, nil
		}
		if lookupErr != nil && !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return baseSpec, false, fmt.Errorf("读取 Gemini 缓存失败：%w", lookupErr)
		}
	}

	lockCtx, cancel := context.WithTimeout(ctx, geminiCacheLockTimeout)
	defer cancel()
	release, acquired := metadata.Service.acquireGeminiCacheLock(lockCtx, cacheKey)
	if !acquired {
		// Another worker is creating the same cache. Waiting longer would add
		// latency to the first model response; that worker will persist the
		// cache for a later Agent step.
		log.Printf("gemini agent prompt cache skipped: model=%s cache_key=%s reason=lock_unavailable", safeProviderModel(input.Config.Model), cacheKey)
		return baseSpec, false, nil
	}
	defer release()

	// Recheck after taking both the process-local and optional Redis lock. This
	// check is intentionally unconditional: a forced rebuild must never delete
	// a fresh cache created by a concurrent request while it was waiting.
	cache, lookupErr := metadata.Service.repo.GeminiCacheByKey(metadata.UserID, cacheKey)
	if lookupErr == nil && geminiCacheUsable(cache) {
		return applyGeminiCachedContent(baseSpec, cache.ResourceName), true, nil
	}
	if lookupErr != nil && !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return baseSpec, false, fmt.Errorf("读取 Gemini 缓存失败：%w", lookupErr)
	}

	// Expired records must release their remote CachedContent before the local
	// row is replaced. Remote cleanup is best effort because it is not allowed
	// to block the model request.
	if cache, lookupErr := metadata.Service.repo.GeminiCacheByKey(metadata.UserID, cacheKey); lookupErr == nil {
		deleteGeminiCachedContentBestEffort(ctx, input.Config, cache.ResourceName, cacheKey)
		deleted, err := metadata.Service.repo.DeleteGeminiCacheIfResourceMatches(metadata.UserID, cacheKey, cache.ResourceName)
		if err != nil {
			return baseSpec, false, fmt.Errorf("清理过期 Gemini 缓存记录失败：%w", err)
		}
		if !deleted {
			if latest, latestErr := metadata.Service.repo.GeminiCacheByKey(metadata.UserID, cacheKey); latestErr == nil && geminiCacheUsable(latest) {
				return applyGeminiCachedContent(baseSpec, latest.ResourceName), true, nil
			}
		}
	} else if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return baseSpec, false, fmt.Errorf("读取 Gemini 缓存失败：%w", lookupErr)
	}

	cacheBody := map[string]any{
		"model": "models/" + canonicalGeminiModelName(input.Config.Model),
		"ttl":   geminiAgentCacheTTL,
	}
	for key, value := range stable {
		cacheBody[key] = value
	}
	var response struct {
		Name       string `json:"name"`
		ExpireTime string `json:"expireTime"`
	}
	createCtx, createCancel := context.WithTimeout(withProviderRequestKind(ctx, "cache-create"), geminiCacheCreateTimeout)
	defer createCancel()
	if err := postGeminiJSON(createCtx, input.Config, "/cachedContents", cacheBody, &response); err != nil {
		return baseSpec, false, fmt.Errorf("创建 Gemini 官方 Prompt Cache 失败：%w", err)
	}
	resourceName := strings.TrimSpace(response.Name)
	if err := validateGeminiCachedContentName(resourceName); err != nil {
		return baseSpec, false, err
	}
	expireTime, err := time.Parse(time.RFC3339, strings.TrimSpace(response.ExpireTime))
	if err != nil {
		deleteGeminiCachedContentBestEffort(ctx, input.Config, resourceName, cacheKey)
		return baseSpec, false, fmt.Errorf("Gemini 官方 Prompt Cache 过期时间无效：%w", err)
	}
	stored := &model.CloudAgentGeminiCache{
		ID:             "gcache_" + cacheKey,
		UserID:         metadata.UserID,
		CacheKey:       cacheKey,
		BaseURL:        strings.TrimRight(strings.TrimSpace(input.Config.BaseURL), "/"),
		Model:          canonicalGeminiModelName(input.Config.Model),
		CredentialHash: credentialHash,
		ResourceName:   resourceName,
		ExpireTime:     expireTime,
	}
	if err := metadata.Service.repo.UpsertGeminiCache(stored); err != nil {
		deleteGeminiCachedContentBestEffort(ctx, input.Config, resourceName, cacheKey)
		return baseSpec, false, fmt.Errorf("保存 Gemini 官方 Prompt Cache 失败：%w", err)
	}
	return applyGeminiCachedContent(baseSpec, resourceName), true, nil
}

func (s *Service) acquireGeminiCacheLock(ctx context.Context, cacheKey string) (func(), bool) {
	if s == nil || strings.TrimSpace(cacheKey) == "" {
		return nil, false
	}
	s.geminiCacheLockMu.Lock()
	if s.geminiCacheLocks == nil {
		s.geminiCacheLocks = make(map[string]*geminiCacheKeyLock)
	}
	lock := s.geminiCacheLocks[cacheKey]
	if lock == nil {
		lock = &geminiCacheKeyLock{token: make(chan struct{}, 1)}
		lock.token <- struct{}{}
		s.geminiCacheLocks[cacheKey] = lock
	}
	lock.refs++
	s.geminiCacheLockMu.Unlock()

	select {
	case <-lock.token:
		var once sync.Once
		localRelease := func() {
			once.Do(func() {
				lock.token <- struct{}{}
				s.releaseGeminiCacheLock(cacheKey, lock)
			})
		}
		if s.coordinator == nil {
			return localRelease, true
		}
		distributedRelease, err := s.coordinator.AcquireWithWait(ctx, "gemini-agent-cache:"+cacheKey, 1, geminiCacheLeaseTTL)
		if err != nil {
			localRelease()
			return nil, false
		}
		return func() {
			distributedRelease()
			localRelease()
		}, true
	case <-ctx.Done():
		s.releaseGeminiCacheLock(cacheKey, lock)
		return nil, false
	}
}

func (s *Service) releaseGeminiCacheLock(cacheKey string, lock *geminiCacheKeyLock) {
	if s == nil || lock == nil {
		return
	}
	s.geminiCacheLockMu.Lock()
	defer s.geminiCacheLockMu.Unlock()
	lock.refs--
	if lock.refs <= 0 && s.geminiCacheLocks[cacheKey] == lock {
		delete(s.geminiCacheLocks, cacheKey)
	}
}

func geminiCacheUsable(cache *model.CloudAgentGeminiCache) bool {
	return cache != nil && validateGeminiCachedContentName(cache.ResourceName) == nil && cache.ExpireTime.After(time.Now().Add(30*time.Second))
}

func geminiStableAgentPrefix(body map[string]any) (map[string]any, []byte, bool, error) {
	stable := make(map[string]any, 3)
	for _, key := range []string{"systemInstruction", "tools", "toolConfig"} {
		value, exists := body[key]
		if !exists || value == nil {
			continue
		}
		stable[key] = value
	}
	if len(stable) == 0 {
		return nil, nil, false, nil
	}
	stableBytes, err := json.Marshal(stable)
	if err != nil {
		return nil, nil, false, fmt.Errorf("生成 Gemini 缓存身份失败：%w", err)
	}
	return stable, stableBytes, true, nil
}

func geminiAgentCacheKey(input canvasGenerationInput, userID string, stable map[string]any) (string, string, error) {
	credentialHash := geminiCacheHash([]byte(input.Config.APIKey))
	normalizedHeaders := make([]OutboundHeader, 0, len(input.Config.Headers))
	for _, header := range input.Config.Headers {
		normalizedHeaders = append(normalizedHeaders, OutboundHeader{Name: strings.ToLower(strings.TrimSpace(header.Name)), Value: strings.TrimSpace(header.Value)})
	}
	sort.Slice(normalizedHeaders, func(i, j int) bool {
		if normalizedHeaders[i].Name == normalizedHeaders[j].Name {
			return normalizedHeaders[i].Value < normalizedHeaders[j].Value
		}
		return normalizedHeaders[i].Name < normalizedHeaders[j].Name
	})
	identity := map[string]any{
		"formatVersion":  geminiAgentCacheFormatVersion,
		"userID":         userID,
		"credentialHash": credentialHash,
		"channelID":      strings.TrimSpace(input.Config.ChannelID),
		"model":          canonicalGeminiModelName(input.Config.Model),
		"baseURL":        strings.TrimRight(strings.TrimSpace(input.Config.BaseURL), "/"),
		"apiFormat":      strings.TrimSpace(input.Config.APIFormat),
		"headers":        normalizedHeaders,
		"stable":         stable,
	}
	identityBytes, err := json.Marshal(identity)
	if err != nil {
		return "", "", fmt.Errorf("生成 Gemini 缓存键失败：%w", err)
	}
	return geminiCacheHash(identityBytes), credentialHash, nil
}

func canonicalGeminiModelName(value string) string {
	return strings.TrimPrefix(strings.TrimSpace(value), "models/")
}

func applyGeminiCachedContent(spec protocol.RequestSpec, resourceName string) protocol.RequestSpec {
	body := cloneStringAnyMap(protocolBodyObject(spec.Body))
	delete(body, "systemInstruction")
	delete(body, "tools")
	delete(body, "toolConfig")
	body["cachedContent"] = resourceName
	spec.Body = body
	return spec
}

// cloneProtocolRequestSpec keeps the cache path from mutating the adapter's
// original request. The body is recursively cloned so removing the stable
// prefix or adding cachedContent cannot leak into a retry or another caller.
func cloneProtocolRequestSpec(spec protocol.RequestSpec) (protocol.RequestSpec, error) {
	cloned := spec
	if spec.Headers != nil {
		cloned.Headers = make(map[string]string, len(spec.Headers))
		for key, value := range spec.Headers {
			cloned.Headers[key] = value
		}
	}
	if spec.Query != nil {
		cloned.Query = make(map[string][]string, len(spec.Query))
		for key, values := range spec.Query {
			cloned.Query[key] = append([]string(nil), values...)
		}
	}
	if spec.Files != nil {
		cloned.Files = append([]protocol.RequestFilePart(nil), spec.Files...)
	}
	if spec.Body == nil {
		return cloned, nil
	}
	data, err := json.Marshal(spec.Body)
	if err != nil {
		return spec, fmt.Errorf("复制 Gemini Agent 请求体失败：%w", err)
	}
	var body any
	if err := json.Unmarshal(data, &body); err != nil {
		return spec, fmt.Errorf("复制 Gemini Agent 请求体失败：%w", err)
	}
	cloned.Body = body
	return cloned, nil
}

func geminiAgentCacheMinimumTokens(modelName string) int {
	// Keep the gate conservative for unknown model revisions. Skipping an
	// explicit cache is safe; creating one below Google's model-specific
	// minimum makes the whole upstream request fail before generation starts.
	lower := strings.ToLower(strings.TrimSpace(modelName))
	if strings.Contains(lower, "gemini-2.5") {
		return 2048
	}
	return 4096
}

func estimateGeminiCacheTokens(data []byte) int {
	return (len(data) + 3) / 4
}

func geminiCacheHash(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func geminiRequestUsesCachedContent(spec protocol.RequestSpec) bool {
	body := protocolBodyObject(spec.Body)
	value, _ := body["cachedContent"].(string)
	return strings.TrimSpace(value) != ""
}

func isGeminiCachedContentNotFound(err error, resourceName string) bool {
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != 404 {
		return false
	}
	resourceName = strings.ToLower(strings.TrimSpace(resourceName))
	body := strings.ToLower(httpErr.Body)
	if resourceName == "" || !strings.Contains(body, resourceName) {
		return false
	}
	var payload struct {
		Error struct {
			Status string `json:"status"`
			Code   int    `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal([]byte(httpErr.Body), &payload) == nil && payload.Error.Code != 0 && payload.Error.Code != 404 {
		return false
	}
	return payload.Error.Status == "" || strings.EqualFold(payload.Error.Status, "NOT_FOUND")
}

// invalidateOfficialGeminiAgentCache deletes both the local record and the
// remote CachedContent. Remote cleanup is deliberately best effort; deleting
// the local identity is what prevents an immediate retry from reusing a 404.
func invalidateOfficialGeminiAgentCache(ctx context.Context, input canvasGenerationInput, spec protocol.RequestSpec, expectedResourceName string) error {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Service == nil || metadata.Service.repo == nil || strings.TrimSpace(metadata.UserID) == "" {
		return nil
	}
	baseSpec, err := cloneProtocolRequestSpec(spec)
	if err != nil {
		return err
	}
	body := protocolBodyObject(baseSpec.Body)
	if body == nil {
		return nil
	}
	stable, _, ok, err := geminiStableAgentPrefix(body)
	if err != nil || !ok {
		return err
	}
	cacheKey, _, err := geminiAgentCacheKey(input, metadata.UserID, stable)
	if err != nil {
		return err
	}
	lockCtx, cancel := context.WithTimeout(ctx, geminiCacheLockTimeout)
	defer cancel()
	release, acquired := metadata.Service.acquireGeminiCacheLock(lockCtx, cacheKey)
	if !acquired {
		return nil
	}
	defer release()
	cache, lookupErr := metadata.Service.repo.GeminiCacheByKey(metadata.UserID, cacheKey)
	if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return nil
	}
	if lookupErr != nil {
		return lookupErr
	}
	if strings.TrimSpace(expectedResourceName) != "" && cache.ResourceName != expectedResourceName {
		return nil
	}
	deleteGeminiCachedContentBestEffort(ctx, input.Config, cache.ResourceName, cacheKey)
	_, err = metadata.Service.repo.DeleteGeminiCacheIfResourceMatches(metadata.UserID, cacheKey, cache.ResourceName)
	return err
}

func deleteGeminiCachedContentBestEffort(ctx context.Context, config providerConfig, resourceName, cacheKey string) {
	if strings.TrimSpace(resourceName) == "" {
		return
	}
	deleteCtx, cancel := context.WithTimeout(withProviderRequestKind(ctx, "cache-delete"), geminiCacheDeleteTimeout)
	defer cancel()
	if err := deleteGeminiCachedContent(deleteCtx, config, resourceName); err != nil {
		log.Printf("gemini agent prompt cache remote cleanup failed: model=%s cache_key=%s reason=%s", safeProviderModel(config.Model), cacheKey, safeProviderLogError(err))
	}
}

func validateGeminiCachedContentName(resourceName string) error {
	resourceName = strings.TrimSpace(resourceName)
	if !strings.HasPrefix(resourceName, "cachedContents/") {
		return errors.New("Gemini 官方 Prompt Cache 返回了无效资源名")
	}
	suffix := strings.TrimPrefix(resourceName, "cachedContents/")
	if suffix == "" || suffix == "." || suffix == ".." {
		return errors.New("Gemini 官方 Prompt Cache 返回了无效资源名")
	}
	for _, char := range suffix {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' || char == '.' {
			continue
		}
		return errors.New("Gemini 官方 Prompt Cache 返回了无效资源名")
	}
	return nil
}

func safeProviderModel(modelName string) string {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return "unknown"
	}
	return truncateRunes(modelName, 120)
}
