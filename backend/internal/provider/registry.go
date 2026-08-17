package provider

import (
	"sync"
)

// Registry 插件注册中心
type Registry struct {
	mu        sync.RWMutex
	providers []ModelCatalogPlugin
}

var globalRegistry = &Registry{}

// Register 注册插件
func Register(discovery ModelCatalogPlugin) {
	globalRegistry.mu.Lock()
	defer globalRegistry.mu.Unlock()

	id := discovery.GetProviderID()
	for index, registered := range globalRegistry.providers {
		if registered.GetProviderID() == id {
			globalRegistry.providers[index] = discovery
			return
		}
	}
	globalRegistry.providers = append(globalRegistry.providers, discovery)
}

// GetProvider 根据 ID 获取插件
func GetProvider(id string) (ModelCatalogPlugin, bool) {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	for _, registered := range globalRegistry.providers {
		if registered.GetProviderID() == id {
			return registered, true
		}
	}
	return nil, false
}

// MatchProvider 根据配置匹配插件
func MatchProvider(baseURL string, headers map[string]string) ModelCatalogPlugin {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	// 按注册顺序匹配，避免 map 遍历导致多个厂商规则命中时结果不稳定。
	for _, registered := range globalRegistry.providers {
		if registered.Match(baseURL, headers) {
			return registered
		}
	}
	return nil
}

// ListProviders 列出所有已注册插件
func ListProviders() []ProviderMetadata {
	globalRegistry.mu.RLock()
	defer globalRegistry.mu.RUnlock()

	result := make([]ProviderMetadata, 0, len(globalRegistry.providers))
	for _, registered := range globalRegistry.providers {
		result = append(result, registered.GetMetadata())
	}
	return result
}
