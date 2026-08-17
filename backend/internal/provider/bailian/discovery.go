package bailian

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/provider"
)

// Discovery 阿里云百炼插件
type Discovery struct{}

// New 创建百炼插件实例
func New() *Discovery {
	return &Discovery{}
}

// GetProviderID 返回服务商标识
func (d *Discovery) GetProviderID() string {
	return "bailian"
}

// Match 判断是否匹配阿里云百炼
func (d *Discovery) Match(baseURL string, headers map[string]string) bool {
	// 匹配阿里云百炼域名
	return strings.Contains(baseURL, "dashscope") ||
		strings.Contains(baseURL, "maas.aliyuncs.com")
}

// DiscoverModels 发现模型列表
func (d *Discovery) DiscoverModels(ctx context.Context, config provider.DiscoveryConfig) ([]provider.Model, error) {
	// 1. 调用标准 /v1/models 获取文本模型
	textModels, err := d.fetchStandardModels(ctx, config)
	if err != nil {
		return nil, err
	}

	// 2. 添加百炼特有的多模态模型
	extendedModels := d.getExtendedModels(config.Region)

	// 3. 合并并去重
	allModels := append(textModels, extendedModels...)
	return d.deduplicate(allModels), nil
}

// fetchStandardModels 调用标准 /v1/models 接口（自己实现，不依赖 openai 包）
func (d *Discovery) fetchStandardModels(ctx context.Context, config provider.DiscoveryConfig) ([]provider.Model, error) {
	// 构建 URL
	target := config.BaseURL
	if !strings.HasSuffix(target, "/models") {
		if strings.HasSuffix(target, "/") {
			target += "models"
		} else {
			target += "/models"
		}
	}

	// 创建请求
	req, err := http.NewRequestWithContext(ctx, "GET", target, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// 设置认证头
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
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
		Data []struct {
			ID                     string   `json:"id"`
			Name                   string   `json:"name"`
			SupportedEndpointTypes []string `json:"supported_generation_methods"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// 转换为统一格式
	models := make([]provider.Model, 0, len(payload.Data))
	seen := make(map[string]bool)

	for _, item := range payload.Data {
		name := strings.TrimSpace(item.ID)
		if name == "" {
			name = strings.TrimSpace(item.Name)
		}
		name = strings.TrimPrefix(name, "models/")

		if name == "" || seen[name] {
			continue
		}
		seen[name] = true

		models = append(models, provider.Model{
			ID:                     name,
			DisplayName:            name,
			Provider:               "bailian",
			Capability:             []string{"text"},
			SupportedEndpointTypes: item.SupportedEndpointTypes,
			Metadata: map[string]any{
				"source": "standard",
			},
		})
	}

	sort.Slice(models, func(i, j int) bool {
		return models[i].ID < models[j].ID
	})

	return models, nil
}

// GetMetadata 返回插件元数据
func (d *Discovery) GetMetadata() provider.ProviderMetadata {
	return provider.ProviderMetadata{
		Name:             "bailian",
		Version:          "1.0.0",
		Description:      "Alibaba Cloud Bailian (DashScope) extended model discovery",
		Author:           "infinite-canvas",
		SupportedRegions: []string{"cn-beijing", "ap-southeast-1", "us-east-1"},
	}
}

// getExtendedModels 获取百炼特有的扩展模型列表
func (d *Discovery) getExtendedModels(region string) []provider.Model {
	models := []provider.Model{
		// === 视频生成模型 ===
		{
			ID:                     "happyhorse-1.1-t2v",
			DisplayName:            "HappyHorse 1.1 文生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "text_to_video",
			},
		},
		{
			ID:                     "happyhorse-1.1-i2v",
			DisplayName:            "HappyHorse 1.1 图生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "image_to_video",
			},
		},
		{
			ID:                     "happyhorse-1.1-r2v",
			DisplayName:            "HappyHorse 1.1 参考视频生成",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "reference_to_video",
			},
		},
		{
			ID:                     "happyhorse-1.0-video-edit",
			DisplayName:            "HappyHorse 1.0 视频编辑",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "video_edit",
			},
		},
		
		// Wan 系列视频生成模型
		{
			ID:                     "wan2.7-t2v-2026-06-12",
			DisplayName:            "万相 2.7 文生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "text_to_video",
			},
		},
		{
			ID:                     "wan2.7-i2v-2026-04-25",
			DisplayName:            "万相 2.7 图生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "image_to_video",
			},
		},
		{
			ID:                     "wan2.7-r2v-2026-06-12",
			DisplayName:            "万相 2.7 参考视频生成",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "reference_to_video",
			},
		},
		
		// Kling（可灵）系列视频生成模型
		{
			ID:                     "kling/kling-v3-omni-video-generation",
			DisplayName:            "可灵 V3 Omni 视频生成",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"resolution":     "up to 4K",
				"duration":       "3-15s",
				"generation_modes": []string{"text_to_video", "image_to_video", "reference_to_video", "video_edit"},
			},
		},
		{
			ID:                     "kling/kling-v3-video-generation",
			DisplayName:            "可灵 V3 视频生成",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"resolution":     "720P-4K",
				"duration":       "3-15s",
				"generation_modes": []string{"text_to_video", "image_to_video"},
			},
		},
		
		// PixVerse（爱诗）系列 - 文生视频
		{
			ID:                     "pixverse/pixverse-c1-t2v",
			DisplayName:            "爱诗 C1 文生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "text_to_video",
				"recommended":    "action scenes, effects",
				"duration":       "1-15s",
			},
		},
		{
			ID:                     "pixverse/pixverse-v6-t2v",
			DisplayName:            "爱诗 V6 文生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "text_to_video",
				"recommended":    "general purpose",
				"duration":       "1-15s",
			},
		},
		{
			ID:                     "pixverse/pixverse-v5.6-t2v",
			DisplayName:            "爱诗 V5.6 文生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "text_to_video",
				"deprecated":     "recommend upgrade to v6",
			},
		},
		
		// PixVerse（爱诗）系列 - 图生视频
		{
			ID:                     "pixverse/pixverse-c1-it2v",
			DisplayName:            "爱诗 C1 图生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "image_to_video",
				"duration":       "1-15s",
			},
		},
		{
			ID:                     "pixverse/pixverse-v6-it2v",
			DisplayName:            "爱诗 V6 图生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "image_to_video",
				"duration":       "1-15s",
			},
		},
		{
			ID:                     "pixverse/pixverse-v5.6-it2v",
			DisplayName:            "爱诗 V5.6 图生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "image_to_video",
			},
		},
		
		// Vidu 系列视频生成模型
		{
			ID:                     "vidu/viduq3-pro_text2video",
			DisplayName:            "Vidu Q3 Pro 文生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "text_to_video",
				"resolution":     "540P-1080P",
				"duration":       "1-16s",
			},
		},
		{
			ID:                     "vidu/viduq3-turbo_text2video",
			DisplayName:            "Vidu Q3 Turbo 文生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "text_to_video",
				"resolution":     "540P-1080P",
				"duration":       "1-16s",
			},
		},
		{
			ID:                     "vidu/viduq2_text2video",
			DisplayName:            "Vidu Q2 文生视频",
			Provider:               "bailian",
			Capability:             []string{"video"},
			SupportedEndpointTypes: []string{"video"},
			APIPath:                "/api/v1/services/aigc/video-generation/video-synthesis",
			Metadata: map[string]any{
				"source":         "extended",
				"model_type":     "video_generation",
				"generation_mode": "text_to_video",
				"resolution":     "540P-1080P",
				"duration":       "1-10s",
			},
		},

		// === 3D 生成模型 ===
		{
			ID:                     "Tripo/Tripo-H3.1",
			DisplayName:            "Tripo H3.1 3D生成",
			Provider:               "bailian",
			Capability:             []string{"image"},  // 前端无 3d 分类，暂归 image
			SupportedEndpointTypes: []string{"image"},
			APIPath:                "/api/v1/services/aigc/3d-generation",
			RequiresPlan:           true,
			Metadata: map[string]any{
				"source":     "extended",
				"model_type": "3d_generation",
				"note":       "frontend lacks 3d category, classified as image",
			},
		},

		// === 图像生成模型（补充）===
		{
			ID:                     "qwen-image-3.0-pro",
			DisplayName:            "通义千问图像 3.0 Pro",
			Provider:               "bailian",
			Capability:             []string{"image"},
			SupportedEndpointTypes: []string{"image"},
			APIPath:                "/api/v1/services/aigc/multimodal-generation/generation",
			Metadata: map[string]any{
				"source":     "extended",
				"model_type": "image_generation",
			},
		},
		{
			ID:                     "wan2.7-image-pro",
			DisplayName:            "万相图像 2.7 Pro",
			Provider:               "bailian",
			Capability:             []string{"image"},
			SupportedEndpointTypes: []string{"image"},
			APIPath:                "/api/v1/services/aigc/multimodal-generation/generation",
			Metadata: map[string]any{
				"source":     "extended",
				"model_type": "image_generation",
			},
		},
	}

	// 根据地域过滤（如果指定了地域）
	if region != "" {
		models = d.filterByRegion(models, region)
	}

	return models
}

// filterByRegion 根据地域过滤模型
func (d *Discovery) filterByRegion(models []provider.Model, region string) []provider.Model {
	// 美国地域可能不支持某些国内模型
	if region == "us-east-1" {
		// 过滤逻辑：保留所有模型（示例）
		// 实际可以根据需要过滤
	}
	return models
}

// deduplicate 去重模型列表
func (d *Discovery) deduplicate(models []provider.Model) []provider.Model {
	seen := make(map[string]bool)
	result := make([]provider.Model, 0, len(models))

	for _, model := range models {
		if !seen[model.ID] {
			seen[model.ID] = true
			result = append(result, model)
		}
	}

	return result
}
