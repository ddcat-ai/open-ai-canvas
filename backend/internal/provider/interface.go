package provider

import (
	"context"
)

// ModelDiscovery 模型发现插件接口
type ModelDiscovery interface {
	// GetProviderID 返回服务商唯一标识
	GetProviderID() string

	// Match 判断是否匹配该服务商
	// 基于 baseURL、headers 等信息判断
	Match(baseURL string, headers map[string]string) bool

	// DiscoverModels 发现模型列表
	DiscoverModels(ctx context.Context, config DiscoveryConfig) ([]Model, error)

	// GetMetadata 返回插件元数据
	GetMetadata() ProviderMetadata
}

// DiscoveryConfig 模型发现配置
type DiscoveryConfig struct {
	BaseURL           string            // API 基础 URL
	APIKey            string            // API 密钥
	SecretKey         string            // 可选的密钥对
	APIFormat         string            // API 格式：openai, gemini, anthropic
	Headers           map[string]string // 自定义请求头
	AllowLocalChannel bool              // 是否允许本地渠道
	Region            string            // 地域（从 baseURL 解析或指定）
}

// Model 统一的模型定义
type Model struct {
	ID                     string         // 模型 ID
	DisplayName            string         // 显示名称
	Provider               string         // 提供商标识
	Capability             []string       // 能力列表：text, image, video, audio, 3d
	SupportedEndpointTypes []string       // 支持的端点类型
	APIPath                string         // API 路径（如果非标准）
	Metadata               map[string]any // 额外元数据
	Deprecated             bool           // 是否已废弃
	RequiresPlan           bool           // 是否需要特殊权限
}

// ProviderMetadata 插件元数据
type ProviderMetadata struct {
	Name             string   // 插件名称
	Version          string   // 插件版本
	Description      string   // 描述
	Author           string   // 作者
	SupportedRegions []string // 支持的地域
}
