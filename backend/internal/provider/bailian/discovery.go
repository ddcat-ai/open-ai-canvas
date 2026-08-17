package bailian

import (
	"net/url"
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
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	dashscopeHost := host == "dashscope.aliyuncs.com" || strings.HasSuffix(host, ".dashscope.aliyuncs.com") || (strings.HasPrefix(host, "dashscope-") && strings.HasSuffix(host, ".aliyuncs.com"))
	return dashscopeHost || host == "maas.aliyuncs.com" || strings.HasSuffix(host, ".maas.aliyuncs.com")
}

// AdditionalModels 只返回百炼标准 /models 未暴露的补充目录。
func (d *Discovery) AdditionalModels(_ provider.DiscoveryConfig) []provider.Model {
	return d.deduplicate(d.getExtendedModels())
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
func (d *Discovery) getExtendedModels() []provider.Model {
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
				"source":          "extended",
				"model_type":      "video_generation",
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
				"source":          "extended",
				"model_type":      "video_generation",
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
				"source":          "extended",
				"model_type":      "video_generation",
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
				"source":          "extended",
				"model_type":      "video_generation",
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
				"source":          "extended",
				"model_type":      "video_generation",
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
				"source":          "extended",
				"model_type":      "video_generation",
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
				"source":          "extended",
				"model_type":      "video_generation",
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
				"source":           "extended",
				"model_type":       "video_generation",
				"resolution":       "up to 4K",
				"duration":         "3-15s",
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
				"source":           "extended",
				"model_type":       "video_generation",
				"resolution":       "720P-4K",
				"duration":         "3-15s",
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
				"source":          "extended",
				"model_type":      "video_generation",
				"generation_mode": "text_to_video",
				"recommended":     "action scenes, effects",
				"duration":        "1-15s",
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
				"source":          "extended",
				"model_type":      "video_generation",
				"generation_mode": "text_to_video",
				"recommended":     "general purpose",
				"duration":        "1-15s",
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
				"source":          "extended",
				"model_type":      "video_generation",
				"generation_mode": "text_to_video",
				"deprecated":      "recommend upgrade to v6",
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
				"source":          "extended",
				"model_type":      "video_generation",
				"generation_mode": "image_to_video",
				"duration":        "1-15s",
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
				"source":          "extended",
				"model_type":      "video_generation",
				"generation_mode": "image_to_video",
				"duration":        "1-15s",
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
				"source":          "extended",
				"model_type":      "video_generation",
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
				"source":          "extended",
				"model_type":      "video_generation",
				"generation_mode": "text_to_video",
				"resolution":      "540P-1080P",
				"duration":        "1-16s",
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
				"source":          "extended",
				"model_type":      "video_generation",
				"generation_mode": "text_to_video",
				"resolution":      "540P-1080P",
				"duration":        "1-16s",
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
				"source":          "extended",
				"model_type":      "video_generation",
				"generation_mode": "text_to_video",
				"resolution":      "540P-1080P",
				"duration":        "1-10s",
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
