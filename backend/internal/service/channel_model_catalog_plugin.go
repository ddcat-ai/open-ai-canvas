package service

import (
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"

	"infinite-canvas/backend/internal/provider"
	"infinite-canvas/backend/internal/provider/bailian"
)

var pluginsInitOnce sync.Once

func initModelCatalogPlugins() {
	pluginsInitOnce.Do(func() {
		provider.Register(bailian.New())
	})
}

// extendChannelModelCatalog 在已通过统一安全出站链路获取的标准目录上补充厂商条目。
// 插件不持有密钥也不自行发 HTTP，避免绕过 SSRF、请求头和响应大小边界。
func extendChannelModelCatalog(baseURL string, apiFormat string, headers []OutboundHeader, catalog []ChannelModelCatalogItem) []ChannelModelCatalogItem {
	initModelCatalogPlugins()
	discovery := provider.MatchProvider(baseURL, outboundHeadersMap(headers))
	if discovery == nil {
		return catalog
	}
	extra := discovery.AdditionalModels(provider.DiscoveryConfig{
		BaseURL:   baseURL,
		APIFormat: apiFormat,
		Headers:   outboundHeadersMap(headers),
		Region:    modelCatalogRegion(baseURL),
	})
	if len(extra) == 0 {
		return catalog
	}

	indexByID := make(map[string]int, len(catalog)+len(extra))
	for index := range catalog {
		indexByID[catalog[index].ID] = index
	}
	for _, model := range extra {
		item := providerCatalogItem(model)
		if item.ID == "" {
			continue
		}
		if index, exists := indexByID[item.ID]; exists {
			catalog[index] = enrichCatalogItem(catalog[index], item)
			continue
		}
		indexByID[item.ID] = len(catalog)
		catalog = append(catalog, item)
	}
	sort.Slice(catalog, func(left int, right int) bool {
		return catalog[left].ID < catalog[right].ID
	})
	return catalog
}

func providerCatalogItem(item provider.Model) ChannelModelCatalogItem {
	modelType := ""
	for _, capability := range item.Capability {
		if normalized := normalizeCatalogModelType(capability); normalized != "" {
			modelType = normalized
			break
		}
	}
	return ChannelModelCatalogItem{
		ID:                     strings.TrimPrefix(strings.TrimSpace(item.ID), "models/"),
		DisplayName:            strings.TrimSpace(item.DisplayName),
		ModelType:              modelType,
		SupportedEndpointTypes: normalizeCatalogEndpointTypes(item.SupportedEndpointTypes),
	}
}

func enrichCatalogItem(current ChannelModelCatalogItem, fallback ChannelModelCatalogItem) ChannelModelCatalogItem {
	if current.DisplayName == "" {
		current.DisplayName = fallback.DisplayName
	}
	if current.ModelType == "" {
		current.ModelType = fallback.ModelType
	}
	if len(current.SupportedEndpointTypes) == 0 {
		current.SupportedEndpointTypes = fallback.SupportedEndpointTypes
	}
	return current
}

func outboundHeadersMap(headers []OutboundHeader) map[string]string {
	result := make(map[string]string, len(headers))
	for _, header := range headers {
		result[header.Name] = header.Value
	}
	return result
}

func modelCatalogRegion(baseURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return ""
	}
	host := strings.ToLower(parsed.Hostname())
	if strings.Contains(host, "dashscope-us") {
		return "us-east-1"
	}
	if strings.Contains(host, "ap-southeast-1") {
		return "ap-southeast-1"
	}
	return "cn-beijing"
}

func (s *Service) isPluginEnabled() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("ENABLE_PROVIDER_PLUGINS")))
	return value == "true" || value == "1"
}
