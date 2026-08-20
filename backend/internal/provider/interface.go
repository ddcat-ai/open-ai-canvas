package provider

// ModelCatalogPlugin 只补充标准 /models 没有暴露的厂商目录项。
// 标准目录请求、鉴权和出站安全边界仍由 service 统一负责。
type ModelCatalogPlugin interface {
	// GetProviderID 返回服务商唯一标识
	GetProviderID() string

	// Match 判断是否匹配该服务商
	// 基于 baseURL、headers 等信息判断
	Match(baseURL string, headers map[string]string) bool

	// AdditionalModels 返回标准目录之外的补充模型。
	AdditionalModels(config DiscoveryConfig) []Model

	// GetMetadata 返回插件元数据
	GetMetadata() ProviderMetadata
}

// DiscoveryConfig 模型发现配置
type DiscoveryConfig struct {
	BaseURL   string
	APIFormat string
	Headers   map[string]string
	Region    string
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
