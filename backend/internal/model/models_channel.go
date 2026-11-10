package model

import (
	"time"

	"gorm.io/gorm"
)

type ModelChannel struct {
	WebsiteID string       `json:"websiteId,omitempty" gorm:"size:36;index;not null;default:''"`
	ID        string       `json:"id" gorm:"primaryKey;size:36"`
	UserID    string       `json:"userId" gorm:"index;size:36"`
	Scope     ChannelScope `json:"scope" gorm:"index;size:24"`
	Enabled   bool         `json:"enabled" gorm:"index"`
	Name      string       `json:"name" gorm:"size:80"`
	// PublicAlias 仅保留历史列供旧迁移读取，运行时不再使用渠道级前台名称。
	PublicAlias      string `json:"-" gorm:"size:80;not null;default:''"`
	SortOrder        int    `json:"sortOrder" gorm:"not null;default:0"`
	BaseURL          string `json:"baseUrl"`
	APIKey           string `json:"-"`
	SecretKey        string `json:"-"`
	APIFormat        string `json:"apiFormat" gorm:"size:24"`
	ConcurrencyLimit int    `json:"concurrencyLimit"`
	// ProxyURL 是渠道级出站代理地址，支持 socks5://、socks5h://、http://、https://。
	// 留空时使用全局环境变量代理。
	ProxyURL   string `json:"proxyUrl" gorm:"size:512"`
	ModelsJSON string `json:"modelsJson" gorm:"type:text"`
	// RetiredModelsJSON 记录已被一个模型家族吸收的上游 SKU，防止目录拉取时重新创建重复记录。
	RetiredModelsJSON string `json:"-" gorm:"type:text"`
	HeadersJSON       string `json:"-" gorm:"type:text"`
	// CatalogProviderID 记录渠道由哪个目录服务商一键接入；空表示自定义渠道。只用于来源展示。
	CatalogProviderID string         `json:"catalogProviderId" gorm:"size:64;not null;default:'';index"`
	CreatedAt         time.Time      `json:"createdAt"`
	UpdatedAt         time.Time      `json:"updatedAt"`
	DeletedAt         gorm.DeletedAt `json:"-" gorm:"index"`
}

type ChannelModelTag struct {
	Text  string `json:"text"`
	Color string `json:"color"`
}

type ChannelModel struct {
	ID                           string               `json:"id" gorm:"primaryKey;size:36"`
	ChannelID                    string               `json:"channelId" gorm:"size:36;index;uniqueIndex:idx_channel_model_key_active,priority:1,where:deleted_at IS NULL"`
	ModelKey                     string               `json:"modelKey" gorm:"size:120;uniqueIndex:idx_channel_model_key_active,priority:2,where:deleted_at IS NULL"`
	ProviderModelKey             string               `json:"providerModelKey" gorm:"size:120"`
	DisplayName                  string               `json:"displayName" gorm:"size:160"`
	ChannelLabel                 string               `json:"channelLabel" gorm:"size:80;not null;default:''"`
	Tags                         []ChannelModelTag    `json:"tags" gorm:"serializer:json;type:text;not null;default:'[]'"`
	Description                  string               `json:"description" gorm:"size:500;not null;default:''"`
	SortOrder                    int                  `json:"sortOrder" gorm:"not null;default:0"`
	Icon                         string               `json:"icon" gorm:"size:80"`
	Capability                   string               `json:"capability" gorm:"size:32;index"`
	Protocol                     ChannelInterfaceType `json:"protocol" gorm:"size:64;index"`
	BillingMode                  string               `json:"billingMode" gorm:"size:32"`
	UnitPriceMicrocredits        int64                `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits  int64                `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits int64                `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits int64                `json:"cachedTokenPriceMicrocredits"`
	// CacheWriteTokenPriceMicrocredits 是写入提示词缓存（Anthropic cache_creation 等）的每百万 Token 价格，0 表示不单独收费。
	CacheWriteTokenPriceMicrocredits int64 `json:"cacheWriteTokenPriceMicrocredits" gorm:"not null;default:0"`
	PriceConfigured                  bool  `json:"priceConfigured" gorm:"index"`
	Enabled                          bool  `json:"enabled" gorm:"index"`
	PriceVersion                     int64 `json:"priceVersion"`
	// PriceCurrency 决定价格档售价的单位：credits 直接是微积分；USD/CNY 是百万分之一货币单位，
	// 下单时按用户分组兑换比例换算为积分。
	PriceCurrency        string         `json:"priceCurrency" gorm:"size:16;not null;default:credits"`
	CapabilityConfigJSON string         `json:"-" gorm:"type:text"`
	CapabilityVersion    int64          `json:"capabilityVersion"`
	CapabilityConfig     map[string]any `json:"capabilityConfig,omitempty" gorm:"-"`
	// CatalogModelKey 记录来自服务商目录的推荐模型 key，便于排查来源。
	CatalogModelKey string `json:"catalogModelKey" gorm:"size:120;not null;default:''"`
	// ReferenceVideoBilling 仅对视频模型生效：开启后挂参考视频的请求按价格档的“带参考视频”价格计费，
	// 按秒模式把后端实测的参考视频秒数计入数量，Token 模式把参考视频计入公式用量；关闭时参考视频不计费。
	ReferenceVideoBilling bool `json:"referenceVideoBilling" gorm:"not null;default:false"`
	// PriceTiers 是系统渠道模型的价格真相。标量价格仅为旧调用与历史数据兼容，
	// 新的创作端报价必须按所选规格命中一个价格档。
	PriceTiers []ChannelModelPriceTier `json:"priceTiers" gorm:"-"`
	CreatedAt  time.Time               `json:"createdAt"`
	UpdatedAt  time.Time               `json:"updatedAt"`
	DeletedAt  gorm.DeletedAt          `json:"-" gorm:"index"`
}

// ChannelModelPriceTier 表示渠道模型在一个规格组合下的可执行上游 SKU 和用户价格。
// SelectorJSON 是规格选择器真相，例如 {"operation":"image_to_video","vquality":"720p",
// "videoSeconds":"10"} 或 {"operation":"text_to_image","quality":"2k"}。
// SelectorKey 是规范化 JSON，用于 PostgreSQL 的活动规格唯一约束。旧的 Resolution / VideoSeconds
// 仅保留给历史 API 与升级回填，不能再作为 SKU 唯一性依据。
type ChannelModelPriceTier struct {
	CostPricing                      CreditCostPricing `json:"-" gorm:"embedded;embeddedPrefix:cost_"`
	ID                               string            `json:"id" gorm:"primaryKey;size:36"`
	ChannelModelID                   string            `json:"channelModelId" gorm:"size:36;index;uniqueIndex:idx_channel_model_price_tier_active,priority:1,where:deleted_at IS NULL"`
	SelectorKey                      string            `json:"selectorKey" gorm:"size:500;not null;default:{};uniqueIndex:idx_channel_model_price_tier_active,priority:2,where:deleted_at IS NULL"`
	SelectorJSON                     string            `json:"-" gorm:"type:text;not null;default:{}"`
	Selector                         map[string]string `json:"selector,omitempty" gorm:"-"`
	Resolution                       string            `json:"resolution" gorm:"size:24;not null;default:*"`
	VideoSeconds                     int               `json:"videoSeconds" gorm:"not null;default:0"`
	ProviderModelKey                 string            `json:"providerModelKey" gorm:"size:120"`
	BillingMode                      string            `json:"billingMode" gorm:"size:32"`
	UnitPriceMicrocredits            int64             `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits      int64             `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits     int64             `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits     int64             `json:"cachedTokenPriceMicrocredits"`
	CacheWriteTokenPriceMicrocredits int64             `json:"cacheWriteTokenPriceMicrocredits" gorm:"not null;default:0"`
	// TokenPriceRulesEnabled 打开后，文本 Token 档按 TokenPriceRules 的分时与上下文单价计费；
	// 关闭时规则保留但不参与报价和结算。
	TokenPriceRulesEnabled bool             `json:"tokenPriceRulesEnabled" gorm:"not null;default:false"`
	TokenPriceRules        []TokenPriceRule `json:"tokenPriceRules" gorm:"serializer:json;type:text;not null;default:'[]'"`
	// 带参考视频的价格：模型开启 ReferenceVideoBilling 且请求挂了参考视频时替代 UnitPrice（按秒）
	// 或 OutputTokenPrice（Token）；未开启时不使用。
	ReferenceVideoUnitPriceMicrocredits        int64          `json:"referenceVideoUnitPriceMicrocredits" gorm:"not null;default:0"`
	ReferenceVideoOutputTokenPriceMicrocredits int64          `json:"referenceVideoOutputTokenPriceMicrocredits" gorm:"not null;default:0"`
	PriceConfigured                            bool           `json:"priceConfigured" gorm:"index"`
	Enabled                                    bool           `json:"enabled" gorm:"index"`
	PriceVersion                               int64          `json:"priceVersion"`
	CreatedAt                                  time.Time      `json:"createdAt"`
	UpdatedAt                                  time.Time      `json:"updatedAt"`
	DeletedAt                                  gorm.DeletedAt `json:"-" gorm:"index"`
}

type ApiCallLog struct {
	ID                     string        `json:"id" gorm:"primaryKey;size:36"`
	UserID                 string        `json:"userId" gorm:"index;size:36;index:idx_api_logs_user_created,priority:1"`
	TraceID                string        `json:"traceId,omitempty" gorm:"index;size:96"`
	RequestID              string        `json:"requestId,omitempty" gorm:"index;size:96"`
	UserDisplayName        string        `json:"userDisplayName,omitempty" gorm:"-"`
	UserAccount            string        `json:"userAccount,omitempty" gorm:"-"`
	ChannelID              string        `json:"channelId" gorm:"index;size:36;index:idx_api_logs_channel_created,priority:1"`
	ChannelName            string        `json:"channelName" gorm:"-"`
	TaskID                 string        `json:"taskId,omitempty" gorm:"index;size:36"`
	TaskStatus             TaskStatus    `json:"taskStatus,omitempty" gorm:"-"`
	MediaStage             string        `json:"mediaStage,omitempty" gorm:"-"`
	BillingOrderID         string        `json:"billingOrderId,omitempty" gorm:"index;size:36"`
	BillingStatus          BillingStatus `json:"billingStatus,omitempty" gorm:"-"`
	BillingReservedAmount  int64         `json:"billingReservedMicrocredits" gorm:"-"`
	BillingSettledAmount   *int64        `json:"billingSettledMicrocredits,omitempty" gorm:"-"`
	BillingAvailable       bool          `json:"billingAvailable" gorm:"-"`
	CreditCostConfigured   bool          `json:"creditCostConfigured" gorm:"-"`
	CreditCostMicrocredits *int64        `json:"creditCostMicrocredits,omitempty" gorm:"-"`
	Source                 string        `json:"source" gorm:"index;size:64"`
	Capability             string        `json:"capability" gorm:"index;size:32"`
	Operation              string        `json:"operation" gorm:"size:64"`
	RequestKind            string        `json:"requestKind" gorm:"index;size:24;index:idx_api_logs_kind_status_created,priority:1"`
	Billable               bool          `json:"billable" gorm:"index"`
	APIFormat              string        `json:"apiFormat" gorm:"size:24"`
	Method                 string        `json:"method" gorm:"size:16"`
	Path                   string        `json:"path"`
	Model                  string        `json:"model" gorm:"size:120;index:idx_api_logs_model_created,priority:1"`
	Status                 ApiCallStatus `json:"status" gorm:"index;size:24;index:idx_api_logs_status_created,priority:1;index:idx_api_logs_kind_status_created,priority:2"`
	StatusCode             int           `json:"statusCode"`
	DurationMs             int64         `json:"durationMs"`
	PollCount              int           `json:"pollCount"`
	ProviderStatus         string        `json:"providerStatus,omitempty" gorm:"size:32"`
	InputTokens            int64         `json:"inputTokens"`
	OutputTokens           int64         `json:"outputTokens"`
	CachedTokens           int64         `json:"cachedTokens"`
	// CacheWriteTokens 是本次写入提示词缓存的输入 Token，已计入 InputTokens。
	CacheWriteTokens      int64                     `json:"cacheWriteTokens" gorm:"not null;default:0"`
	UsageAvailable        bool                      `json:"usageAvailable"`
	MediaCount            int                       `json:"mediaCount"`
	MediaPreviewURL       string                    `json:"mediaPreviewUrl,omitempty" gorm:"-"`
	MediaPreviewKind      string                    `json:"mediaPreviewKind,omitempty" gorm:"-"`
	VideoSeconds          int                       `json:"videoSeconds"`
	ProviderRequestID     string                    `json:"providerRequestId" gorm:"size:160"`
	EstimatedCostMicros   int64                     `json:"estimatedCostMicros"`
	CostAvailable         bool                      `json:"costAvailable"`
	Currency              string                    `json:"currency" gorm:"size:12"`
	ErrorCode             string                    `json:"errorCode,omitempty" gorm:"index;size:80"`
	Error                 string                    `json:"error"`
	ConcurrencyLimit      int                       `json:"concurrencyLimit"`
	UpstreamURL           string                    `json:"upstreamUrl"`
	RequestContentType    string                    `json:"requestContentType,omitempty" gorm:"size:160"`
	RequestBody           string                    `json:"requestBody,omitempty" gorm:"type:text"`
	ResponseBody          string                    `json:"responseBody,omitempty" gorm:"type:text"`
	GenerationContentJSON string                    `json:"-" gorm:"type:text"`
	GenerationContent     *APICallGenerationContent `json:"generationContent,omitempty" gorm:"-"`
	StartedAt             time.Time                 `json:"startedAt"`
	CreatedAt             time.Time                 `json:"createdAt" gorm:"index;index:idx_api_logs_user_created,priority:2;index:idx_api_logs_channel_created,priority:2;index:idx_api_logs_model_created,priority:2;index:idx_api_logs_status_created,priority:2;index:idx_api_logs_kind_status_created,priority:3"`
	CreatedAtEpoch        int64                     `json:"-" gorm:"index:idx_api_logs_created_epoch"`
}

func (a *ApiCallLog) BeforeCreate(tx *gorm.DB) error {
	if a.CreatedAtEpoch == 0 {
		if a.CreatedAt.IsZero() {
			a.CreatedAtEpoch = time.Now().Unix()
		} else {
			a.CreatedAtEpoch = a.CreatedAt.Unix()
		}
	}
	return nil
}
