package service

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/provider"
	"infinite-canvas/backend/internal/provider/bailian"
	"infinite-canvas/backend/internal/provider/openai"
)

var (
	pluginsInitialized bool
	pluginsInitMutex   sync.Mutex
)

// initPlugins 初始化并注册所有插件（只执行一次）
func initPlugins() {
	pluginsInitMutex.Lock()
	defer pluginsInitMutex.Unlock()

	if pluginsInitialized {
		return
	}

	// 注册 OpenAI 标准插件（默认）
	provider.Register(openai.New())

	// 注册阿里云百炼插件
	provider.Register(bailian.New())

	// 未来可以添加更多插件：
	// provider.Register(gemini.New())
	// provider.Register(anthropic.New())

	pluginsInitialized = true
}

// FetchChannelModelCatalogWithPlugin 使用插件机制拉取模型（新实现）
func (s *Service) FetchChannelModelCatalogWithPlugin(ctx context.Context, actor *model.User, input ChannelModelsRequest) ([]ChannelModelCatalogItem, error) {
	// 确保插件已初始化
	initPlugins()

	// 验证基本参数
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, Unauthorized("请先登录")
	}
	baseURL := strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	apiKey := strings.TrimSpace(input.APIKey)
	if baseURL == "" {
		return nil, BadAuthRequest("请填写 Base URL")
	}
	if apiKey == "" {
		return nil, BadAuthRequest("请填写 API Key")
	}

	// 1. 匹配插件
	headers := s.headersToMap(input.Headers)
	discovery := provider.MatchProvider(baseURL, headers)
	if discovery == nil {
		return nil, fmt.Errorf("未找到匹配的服务商插件，请检查 Base URL")
	}

	// 2. 构建配置
	config := provider.DiscoveryConfig{
		BaseURL:           baseURL,
		APIKey:            apiKey,
		APIFormat:         strings.ToLower(strings.TrimSpace(input.APIFormat)),
		Headers:           headers,
		AllowLocalChannel: input.AllowLocalChannel,
		Region:            s.extractRegion(baseURL),
	}

	if config.APIFormat == "" {
		config.APIFormat = "openai"
	}

	// 3. 调用插件发现模型
	models, err := discovery.DiscoverModels(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("插件发现模型失败: %w", err)
	}

	// 4. 转换为内部格式
	catalog := make([]ChannelModelCatalogItem, 0, len(models))
	for _, m := range models {
		catalog = append(catalog, ChannelModelCatalogItem{
			ID:                     m.ID,
			SupportedEndpointTypes: m.SupportedEndpointTypes,
		})
	}

	// 5. 排序
	sort.Slice(catalog, func(i, j int) bool {
		return catalog[i].ID < catalog[j].ID
	})

	return catalog, nil
}

// headersToMap 将 OutboundHeader 数组转换为 map
func (s *Service) headersToMap(headers []OutboundHeader) map[string]string {
	result := make(map[string]string, len(headers))
	for _, h := range headers {
		if h.Name != "" && h.Value != "" {
			result[h.Name] = h.Value
		}
	}
	return result
}

// extractRegion 从 baseURL 提取地域信息
func (s *Service) extractRegion(baseURL string) string {
	// 美国地域
	if strings.Contains(baseURL, "dashscope-us") {
		return "us-east-1"
	}
	
	// 亚太地域（新加坡）
	if strings.Contains(baseURL, "ap-southeast-1") {
		return "ap-southeast-1"
	}
	
	// 默认：中国北京
	return "cn-beijing"
}

// isPluginEnabled 检查插件机制是否启用
func (s *Service) isPluginEnabled() bool {
	// 通过环境变量控制
	value := os.Getenv("ENABLE_PROVIDER_PLUGINS")
	return strings.ToLower(value) == "true" || value == "1"
}
