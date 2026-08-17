package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/provider"
)

// Discovery OpenAI 标准插件
type Discovery struct{}

// New 创建 OpenAI 插件实例
func New() *Discovery {
	return &Discovery{}
}

// GetProviderID 返回服务商标识
func (d *Discovery) GetProviderID() string {
	return "openai"
}

// Match 判断是否匹配 OpenAI 兼容端点
func (d *Discovery) Match(baseURL string, headers map[string]string) bool {
	// 排除已知的其他服务商
	if strings.Contains(baseURL, "dashscope") ||
		strings.Contains(baseURL, "maas.aliyuncs.com") {
		return false // 百炼有自己的插件
	}

	// 匹配标准的 OpenAI 兼容端点
	return strings.Contains(baseURL, "/v1") ||
		strings.Contains(baseURL, "openai.com") ||
		strings.Contains(baseURL, "compatible-mode")
}

// DiscoverModels 发现模型列表
func (d *Discovery) DiscoverModels(ctx context.Context, config provider.DiscoveryConfig) ([]provider.Model, error) {
	// 构建 /v1/models 请求
	target := config.BaseURL
	if !strings.HasSuffix(target, "/models") {
		if strings.HasSuffix(target, "/") {
			target += "models"
		} else {
			target += "/models"
		}
	}

	req, err := http.NewRequestWithContext(ctx, "GET", target, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// 设置认证头
	if config.APIFormat == "gemini" {
		req.Header.Set("x-goog-api-key", config.APIKey)
	} else {
		req.Header.Set("Authorization", "Bearer "+config.APIKey)
	}

	// 添加自定义请求头
	for k, v := range config.Headers {
		req.Header.Set(k, v)
	}

	// 执行请求
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch models: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	// 解析响应
	var payload struct {
		Data   []modelItem `json:"data"`
		Models []modelItem `json:"models"` // Gemini 使用这个字段
	}

	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// 提取模型列表
	items := payload.Data
	if config.APIFormat == "gemini" && len(payload.Models) > 0 {
		items = payload.Models
	}

	// 转换为统一格式
	models := make([]provider.Model, 0, len(items))
	seen := make(map[string]bool)

	for _, item := range items {
		// 提取模型 ID
		name := strings.TrimSpace(item.ID)
		if name == "" {
			name = strings.TrimSpace(item.Name)
		}
		name = strings.TrimPrefix(name, "models/") // 移除 Gemini 的前缀

		if name == "" || seen[name] {
			continue
		}
		seen[name] = true

		models = append(models, provider.Model{
			ID:                     name,
			DisplayName:            d.getDisplayName(item),
			Provider:               "openai",
			Capability:             d.inferCapability(name),
			SupportedEndpointTypes: d.normalizeSupportedTypes(item.SupportedEndpointTypes),
			Metadata: map[string]any{
				"source": "standard",
			},
		})
	}

	// 排序
	sort.Slice(models, func(i, j int) bool {
		return models[i].ID < models[j].ID
	})

	return models, nil
}

// GetMetadata 返回插件元数据
func (d *Discovery) GetMetadata() provider.ProviderMetadata {
	return provider.ProviderMetadata{
		Name:        "openai",
		Version:     "1.0.0",
		Description: "Standard OpenAI-compatible model discovery",
		Author:      "infinite-canvas",
	}
}

// modelItem 内部使用的模型数据结构
type modelItem struct {
	ID                     string   `json:"id"`
	Name                   string   `json:"name"`
	SupportedEndpointTypes []string `json:"supported_generation_methods"`
}

// getDisplayName 获取显示名称
func (d *Discovery) getDisplayName(item modelItem) string {
	if item.Name != "" {
		return item.Name
	}
	return item.ID
}

// inferCapability 根据模型 ID 推断能力
func (d *Discovery) inferCapability(modelID string) []string {
	lower := strings.ToLower(modelID)

	// 图像模型
	if strings.Contains(lower, "dall-e") ||
		strings.Contains(lower, "image") {
		return []string{"image"}
	}

	// 音频模型
	if strings.Contains(lower, "whisper") ||
		strings.Contains(lower, "tts") ||
		strings.Contains(lower, "audio") {
		return []string{"audio"}
	}

	// 嵌入模型
	if strings.Contains(lower, "embedding") {
		return []string{"embedding"}
	}

	// 默认为文本模型
	return []string{"text"}
}

// normalizeSupportedTypes 标准化支持的端点类型
func (d *Discovery) normalizeSupportedTypes(types []string) []string {
	if len(types) == 0 {
		return nil
	}

	seen := make(map[string]bool)
	result := make([]string, 0, len(types))

	for _, t := range types {
		normalized := strings.TrimSpace(t)
		if normalized == "" || seen[normalized] {
			continue
		}
		seen[normalized] = true
		result = append(result, normalized)
	}

	return result
}
