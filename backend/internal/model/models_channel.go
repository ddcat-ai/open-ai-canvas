package model

import (
	"gorm.io/gorm"
	"time"
)

type ModelChannel struct {
	ID                string       `json:"id" gorm:"primaryKey;size:36"`
	UserID            string       `json:"userId" gorm:"index;size:36"`
	Scope             ChannelScope `json:"scope" gorm:"index;size:24"`
	Enabled           bool         `json:"enabled" gorm:"index"`
	Name              string       `json:"name" gorm:"size:80"`
	BaseURL           string       `json:"baseUrl"`
	AllowLocalChannel bool         `json:"allowLocalChannel" gorm:"default:false"`
	APIKey            string       `json:"-"`
	SecretKey         string       `json:"-"`
	APIFormat         string       `json:"apiFormat" gorm:"size:24"`
	ConcurrencyLimit  int          `json:"concurrencyLimit"`
	ModelsJSON        string       `json:"modelsJson" gorm:"type:text"`
	// RetiredModelsJSON 记录已被一个模型家族吸收的上游 SKU，防止目录拉取时重新创建重复记录。
	RetiredModelsJSON string         `json:"-" gorm:"type:text"`
	HeadersJSON       string         `json:"-" gorm:"type:text"`
	CreatedAt         time.Time      `json:"createdAt"`
	UpdatedAt         time.Time      `json:"updatedAt"`
	DeletedAt         gorm.DeletedAt `json:"-" gorm:"index"`
}

type ChannelModel struct {
	ID                           string               `json:"id" gorm:"primaryKey;size:36"`
	ChannelID                    string               `json:"channelId" gorm:"size:36;index;uniqueIndex:idx_channel_model_key_active,priority:1,where:deleted_at IS NULL"`
	ModelKey                     string               `json:"modelKey" gorm:"size:120;uniqueIndex:idx_channel_model_key_active,priority:2,where:deleted_at IS NULL"`
	ProviderModelKey             string               `json:"providerModelKey" gorm:"size:120"`
	DisplayName                  string               `json:"displayName" gorm:"size:160"`
	Icon                         string               `json:"icon" gorm:"size:80"`
	Capability                   string               `json:"capability" gorm:"size:32;index"`
	Protocol                     ChannelInterfaceType `json:"protocol" gorm:"size:32;index"`
	BillingMode                  string               `json:"billingMode" gorm:"size:32"`
	UnitPriceMicrocredits        int64                `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits  int64                `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits int64                `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits int64                `json:"cachedTokenPriceMicrocredits"`
	PriceConfigured              bool                 `json:"priceConfigured" gorm:"index"`
	Enabled                      bool                 `json:"enabled" gorm:"index"`
	PriceVersion                 int64                `json:"priceVersion"`
	CapabilityConfigJSON         string               `json:"-" gorm:"type:text"`
	CapabilityVersion            int64                `json:"capabilityVersion"`
	CapabilityConfig             map[string]any       `json:"capabilityConfig,omitempty" gorm:"-"`
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
	ID                           string            `json:"id" gorm:"primaryKey;size:36"`
	ChannelModelID               string            `json:"channelModelId" gorm:"size:36;index;uniqueIndex:idx_channel_model_price_tier_active,priority:1,where:deleted_at IS NULL"`
	SelectorKey                  string            `json:"selectorKey" gorm:"size:500;not null;default:{};uniqueIndex:idx_channel_model_price_tier_active,priority:2,where:deleted_at IS NULL"`
	SelectorJSON                 string            `json:"-" gorm:"type:text;not null;default:{}"`
	Selector                     map[string]string `json:"selector,omitempty" gorm:"-"`
	Resolution                   string            `json:"resolution" gorm:"size:24;not null;default:*"`
	VideoSeconds                 int               `json:"videoSeconds" gorm:"not null;default:0"`
	ProviderModelKey             string            `json:"providerModelKey" gorm:"size:120"`
	BillingMode                  string            `json:"billingMode" gorm:"size:32"`
	UnitPriceMicrocredits        int64             `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits  int64             `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits int64             `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits int64             `json:"cachedTokenPriceMicrocredits"`
	PriceConfigured              bool              `json:"priceConfigured" gorm:"index"`
	Enabled                      bool              `json:"enabled" gorm:"index"`
	PriceVersion                 int64             `json:"priceVersion"`
	CreatedAt                    time.Time         `json:"createdAt"`
	UpdatedAt                    time.Time         `json:"updatedAt"`
	DeletedAt                    gorm.DeletedAt    `json:"-" gorm:"index"`
}

type ApiCallLog struct {
	ID                  string        `json:"id" gorm:"primaryKey;size:36"`
	UserID              string        `json:"userId" gorm:"index;size:36;index:idx_api_logs_user_created,priority:1"`
	TraceID             string        `json:"traceId,omitempty" gorm:"index;size:96"`
	RequestID           string        `json:"requestId,omitempty" gorm:"index;size:96"`
	UserDisplayName     string        `json:"userDisplayName,omitempty" gorm:"-"`
	UserAccount         string        `json:"userAccount,omitempty" gorm:"-"`
	ChannelID           string        `json:"channelId" gorm:"index;size:36;index:idx_api_logs_channel_created,priority:1"`
	ChannelName         string        `json:"channelName" gorm:"-"`
	TaskID              string        `json:"taskId,omitempty" gorm:"index;size:36"`
	TaskStatus          TaskStatus    `json:"taskStatus,omitempty" gorm:"-"`
	BillingOrderID      string        `json:"billingOrderId,omitempty" gorm:"index;size:36"`
	BillingStatus       BillingStatus `json:"billingStatus,omitempty" gorm:"-"`
	BillingAmount       int64         `json:"billingAmountMicrocredits" gorm:"-"`
	BillingAvailable    bool          `json:"billingAvailable" gorm:"-"`
	Source              string        `json:"source" gorm:"index;size:64"`
	Capability          string        `json:"capability" gorm:"index;size:32"`
	Operation           string        `json:"operation" gorm:"size:64"`
	RequestKind         string        `json:"requestKind" gorm:"index;size:24"`
	Billable            bool          `json:"billable" gorm:"index"`
	APIFormat           string        `json:"apiFormat" gorm:"size:24"`
	Method              string        `json:"method" gorm:"size:16"`
	Path                string        `json:"path"`
	Model               string        `json:"model" gorm:"size:120;index:idx_api_logs_model_created,priority:1"`
	Status              ApiCallStatus `json:"status" gorm:"index;size:24;index:idx_api_logs_status_created,priority:1"`
	StatusCode          int           `json:"statusCode"`
	DurationMs          int64         `json:"durationMs"`
	PollCount           int           `json:"pollCount"`
	ProviderStatus      string        `json:"providerStatus,omitempty" gorm:"size:32"`
	InputTokens         int64         `json:"inputTokens"`
	OutputTokens        int64         `json:"outputTokens"`
	CachedTokens        int64         `json:"cachedTokens"`
	UsageAvailable      bool          `json:"usageAvailable"`
	MediaCount          int           `json:"mediaCount"`
	MediaPreviewURL     string        `json:"mediaPreviewUrl,omitempty" gorm:"-"`
	MediaPreviewKind    string        `json:"mediaPreviewKind,omitempty" gorm:"-"`
	VideoSeconds        int           `json:"videoSeconds"`
	ProviderRequestID   string        `json:"providerRequestId" gorm:"size:160"`
	EstimatedCostMicros int64         `json:"estimatedCostMicros"`
	CostAvailable       bool          `json:"costAvailable"`
	Currency            string        `json:"currency" gorm:"size:12"`
	ErrorCode           string        `json:"errorCode,omitempty" gorm:"index;size:80"`
	Error               string        `json:"error"`
	ConcurrencyLimit    int           `json:"concurrencyLimit"`
	UpstreamURL         string        `json:"upstreamUrl"`
	RequestContentType  string        `json:"requestContentType,omitempty" gorm:"size:160"`
	RequestBody         string        `json:"requestBody,omitempty" gorm:"type:text"`
	ResponseBody        string        `json:"responseBody,omitempty" gorm:"type:text"`
	StartedAt           time.Time     `json:"startedAt"`
	CreatedAt           time.Time     `json:"createdAt" gorm:"index;index:idx_api_logs_user_created,priority:2;index:idx_api_logs_channel_created,priority:2;index:idx_api_logs_model_created,priority:2;index:idx_api_logs_status_created,priority:2"`
}
