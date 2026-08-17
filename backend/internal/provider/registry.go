package provider

import (
	"sync"
)

// Registry 插件注册中心
type Registry struct {
	mu        sync.RWMutex
	providers map[string]ModelDiscovery
}

var globalRegistry = &Registry{
	providers: make(map[string]ModelDiscovery),
}

// Register 注册插件
func Register(discovery ModelDiscovery) {
	globalRegistry.mu.Lock()
	defer globalRegistry.mu.Unlock()

	id := discovery.GetProviderID()
	globalRegistry.providers[id] = discovery
}

// GetProvider 根据 ID 获取插件
func GetProvider(id string) (ModelDiscovery, bool) {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	provider, ok := globalRegistry.providers[id]
	return provider, ok
}

// MatchProvider 根据配置匹配插件
func MatchProvider(baseURL string, headers map[string]string) ModelDiscovery {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	// 按优先级匹配
	// 1. 先匹配特定服务商（如百炼）
	for _, provider := range globalRegistry.providers {
		if provider.GetProviderID() == "openai" {
			continue // OpenAI 插件最后匹配
		}
		if provider.Match(baseURL, headers) {
			return provider
		}
	}

	// 2. 最后使用 OpenAI 默认实现
	if provider, ok := globalRegistry.providers["openai"]; ok {
		if provider.Match(baseURL, headers) {
			return provider
		}
	}

	return nil
}

// ListProviders 列出所有已注册插件
func ListProviders() []ProviderMetadata {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	result := make([]ProviderMetadata, 0, len(globalRegistry.providers))
	for _, provider := range globalRegistry.providers {
		result = append(result, provider.GetMetadata())
	}
	return result
}
