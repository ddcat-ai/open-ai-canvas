package generation

import (
	"fmt"
	"net/http"
	"time"

	"infinite-canvas/backend/internal/outbound"
)

// Input 是画布生成任务的统一输入合同。
type Input struct {
	Mode            string                 `json:"mode"`
	Prompt          string                 `json:"prompt"`
	Config          Config                 `json:"config"`
	ReferenceImages []Media                `json:"referenceImages"`
	ReferenceVideos []Media                `json:"referenceVideos"`
	ReferenceAudios []Media                `json:"referenceAudios"`
	TextHistory     []TextMessage          `json:"textHistory"`
	Mask            *Media                 `json:"mask"`
	Metadata        map[string]interface{} `json:"metadata"`
	AgentRequests   *AgentToolRequests     `json:"agentRequests"`
	TextOptions     TextOptions            `json:"textOptions"`
	ImageCapability *ImageCapabilityConfig `json:"-"`
	StreamText      bool                   `json:"-"`
	MaxOutputTokens int                    `json:"-"`
	OnTextDelta     func(string)           `json:"-"`
	VideoCapability *VideoCapabilityConfig `json:"-"`
}

type TextOptions struct {
	Stream   *bool `json:"stream"`
	Thinking bool  `json:"thinking"`
}

type AgentToolRequests struct {
	Canonical      *CanonicalAgentRequest `json:"canonical,omitempty"`
	Responses      map[string]interface{} `json:"responses"`
	ChatCompletion map[string]interface{} `json:"chatCompletion"`
	Claude         map[string]interface{} `json:"claude"`
	Gemini         map[string]interface{} `json:"gemini"`
}

// CanonicalAgentRequest 是协议无关的画布 Agent 会话合同（域类型；service 侧仍有同结构实现期间兼容）。
type CanonicalAgentRequest struct {
	Messages     []map[string]interface{} `json:"messages"`
	Tools        []map[string]interface{} `json:"tools"`
	ToolChoice   interface{}              `json:"toolChoice"`
	SystemPrompt string                   `json:"systemPrompt"`
}

type TextMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Config struct {
	ChannelID             string                    `json:"channelId"`
	ChannelModelKey       string                    `json:"channelModelKey,omitempty"`
	PriceTierID           string                    `json:"priceTierId,omitempty"`
	ProviderModelKey      string                    `json:"providerModelKey,omitempty"`
	APIFormat             string                    `json:"apiFormat"`
	InterfaceType         string                    `json:"interfaceType"`
	BaseURL               string                    `json:"baseUrl"`
	AllowLocalChannel     bool                      `json:"allowLocalChannel"`
	APIKey                string                    `json:"apiKey"`
	SecretKey             string                    `json:"secretKey"`
	Headers               []outbound.OutboundHeader `json:"headers"`
	Model                 string                    `json:"model"`
	Size                  string                    `json:"size"`
	Quality               string                    `json:"quality"`
	TransparentBackground string                    `json:"transparentBackground"`
	Count                 string                    `json:"count"`
	VideoSeconds          string                    `json:"videoSeconds"`
	VQuality              string                    `json:"vquality"`
	VideoGenerateAudio    string                    `json:"videoGenerateAudio"`
	VideoWatermark        string                    `json:"videoWatermark"`
	ArkPrivateAssetUpload string                    `json:"videoArkPrivateAssetUpload"`
	AudioVoice            string                    `json:"audioVoice"`
	AudioFormat           string                    `json:"audioFormat"`
	AudioSpeed            string                    `json:"audioSpeed"`
	AudioInstructions     string                    `json:"audioInstructions"`
	SystemPrompt          string                    `json:"systemPrompt"`
	CapabilityConfig      *ModelCapabilityConfig    `json:"capabilityConfig"`
	WorkflowID            string                    `json:"workflowId"`
	WebappID              string                    `json:"webappId"`
	WorkflowJSON          map[string]interface{}    `json:"workflowJson"`
	WorkflowFields        []WorkflowField           `json:"workflowFields"`
	BridgeID              string                    `json:"bridgeId"`
	RunningHubUseWallet   bool                      `json:"runningHubUseWallet"`
	RunningHubWalletKey   string                    `json:"runningHubWalletApiKey"`
	RunningHubUploadKey   string                    `json:"runningHubUploadApiKey"`
}

type Media struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Type       string `json:"type"`
	DataURL    string `json:"dataUrl"`
	URL        string `json:"url"`
	StorageKey string `json:"storageKey"`
	MimeType   string `json:"mimeType"`
	Bytes      int64  `json:"bytes"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DurationMs int64  `json:"durationMs"`
}

// WorkflowField 是 RunningHub/ComfyUI 共用的字段描述。完整工作流执行仍在 service。
type WorkflowField struct {
	ID                 string        `json:"id"`
	NodeID             string        `json:"nodeId"`
	ClassType          string        `json:"classType,omitempty"`
	FieldName          string        `json:"fieldName"`
	Value              interface{}   `json:"value,omitempty"`
	FieldValue         interface{}   `json:"fieldValue,omitempty"`
	FieldType          string        `json:"fieldType,omitempty"`
	Label              string        `json:"label,omitempty"`
	Role               string        `json:"role,omitempty"`
	SafeToOverride     *bool         `json:"safeToOverride,omitempty"`
	OptionsSource      string        `json:"optionsSource,omitempty"`
	Options            []interface{} `json:"options,omitempty"`
	Min                interface{}   `json:"min,omitempty"`
	Max                interface{}   `json:"max,omitempty"`
	Step               interface{}   `json:"step,omitempty"`
	RandomEnabled      bool          `json:"randomEnabled,omitempty"`
	BindPrompt         bool          `json:"bindPrompt,omitempty"`
	Enabled            *bool         `json:"enabled,omitempty"`
	Source             string        `json:"source,omitempty"`
	SourceIndex        int           `json:"sourceIndex,omitempty"`
	ImageOrder         int           `json:"imageOrder,omitempty"`
	SourceFromUpstream bool          `json:"sourceFromUpstream,omitempty"`
	Required           bool          `json:"required,omitempty"`
	SourceAutomatic    *bool         `json:"sourceAutomatic,omitempty"`
	sourceConfigured   bool
}

// SourceConfigured 暴露反序列化期间的来源配置标记，供 service 工作流逻辑使用。
func (f WorkflowField) SourceConfigured() bool { return f.sourceConfigured }

// SetSourceConfigured 供 service 在归一化路径写入来源配置标记。
func (f *WorkflowField) SetSourceConfigured(v bool) { f.sourceConfigured = v }

type MediaHydrationPolicy struct {
	RequireURL bool
	PreferURL  bool
}

// ModelCapabilityConfig 是模型能力声明，不包含供应商字段名。
type ModelCapabilityConfig struct {
	Version int                    `json:"version"`
	Text    *TextCapabilityConfig  `json:"text,omitempty"`
	Image   *ImageCapabilityConfig `json:"image,omitempty"`
	Video   *VideoCapabilityConfig `json:"video,omitempty"`
}

type TextCapabilityConfig struct {
	References TextReferenceConfig `json:"references"`
}

type TextReferenceConfig struct {
	PromptMaxChars int   `json:"promptMaxChars"`
	MaxImages      int   `json:"maxImages"`
	MaxImageBytes  int64 `json:"maxImageBytes"`
	MaxVideos      int   `json:"maxVideos"`
	MaxVideoBytes  int64 `json:"maxVideoBytes"`
}

type ImageCapabilityConfig struct {
	References            ImageReferenceConfig `json:"references"`
	Size                  ImageSizeConfig      `json:"size"`
	Quality               ImageQualityConfig   `json:"quality"`
	TransparentBackground VideoBooleanConfig   `json:"transparentBackground"`
	ResponseFormat        ParameterSupport     `json:"responseFormat"`
	OutputFormat          ParameterSupport     `json:"outputFormat"`
	MaxOutputs            int                  `json:"maxOutputs"`
}

type ImageReferenceConfig struct {
	PromptMaxChars int   `json:"promptMaxChars"`
	MaxImages      int   `json:"maxImages"`
	MaxImageBytes  int64 `json:"maxImageBytes"`
	MaskSupported  bool  `json:"maskSupported"`
}

type ImageSizeConfig struct {
	Parameter   string            `json:"parameter"`
	Values      []string          `json:"values"`
	Default     string            `json:"default"`
	AllowCustom bool              `json:"allowCustom"`
	Presets     []ImageSizePreset `json:"presets,omitempty"`
}

type ImageSizePreset struct {
	Tier   string `json:"tier"`
	Ratio  string `json:"ratio"`
	Size   string `json:"size"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type ImageQualityConfig struct {
	Supported bool     `json:"supported"`
	Values    []string `json:"values"`
	Default   string   `json:"default"`
}

type ParameterSupport struct {
	Supported bool `json:"supported"`
}

type VideoCapabilityConfig struct {
	References        VideoReferenceConfig `json:"references"`
	Duration          VideoDurationConfig  `json:"duration"`
	DurationSupported *bool                `json:"durationSupported,omitempty"`
	Ratios            []string             `json:"ratios"`
	DefaultRatio      string               `json:"defaultRatio"`
	Resolutions       []string             `json:"resolutions"`
	DefaultResolution string               `json:"defaultResolution"`
	GenerateAudio     VideoBooleanConfig   `json:"generateAudio"`
	Watermark         VideoBooleanConfig   `json:"watermark"`
	Operations        []string             `json:"operations"`
	DefaultOperation  string               `json:"defaultOperation"`
}

type VideoReferenceConfig struct {
	PromptMaxChars   int   `json:"promptMaxChars"`
	MinImages        int   `json:"minImages"`
	MaxImages        int   `json:"maxImages"`
	MaxImageBytes    int64 `json:"maxImageBytes"`
	MaxVideos        int   `json:"maxVideos"`
	MaxVideoBytes    int64 `json:"maxVideoBytes"`
	MaxVideoDuration int   `json:"maxVideoDurationSeconds"`
	MaxAudios        int   `json:"maxAudios"`
	MaxAudioBytes    int64 `json:"maxAudioBytes"`
	MaxAudioDuration int   `json:"maxAudioDurationSeconds"`
}

type VideoDurationConfig struct {
	Selection string `json:"selection"`
	Min       int    `json:"min,omitempty"`
	Max       int    `json:"max,omitempty"`
	Step      int    `json:"step,omitempty"`
	Values    []int  `json:"values,omitempty"`
	Default   int    `json:"default"`
}

type VideoBooleanConfig struct {
	Supported bool `json:"supported"`
	Default   bool `json:"default"`
}

type imageResponse struct {
	Data  []map[string]interface{} `json:"data"`
	Error *UpstreamError           `json:"error"`
	Code  *int                     `json:"code"`
	Msg   string                   `json:"msg"`
}

type UpstreamError struct {
	Message string `json:"message"`
}

// PayloadError 在进程内保留上游原始原因；对调用方只暴露归类后的稳定文案。
type PayloadError struct {
	raw     string
	message string
}

func (e PayloadError) Error() string { return e.message }
func (e PayloadError) Raw() string   { return e.raw }

// HTTPError 是上游 HTTP 失败的结构化错误。
type HTTPError struct {
	StatusCode int
	Status     string
	Body       string
	RetryAfter time.Duration
}

func (e HTTPError) Error() string {
	switch e.StatusCode {
	case 524:
		return "上游网关超时（524）：模型请求可能仍在服务端执行并产生费用，请勿立即重试，请先到供应商后台核对任务或账单"
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return "模型服务拒绝了请求，请检查模型和参数"
	case http.StatusUnauthorized, http.StatusForbidden:
		return "模型服务鉴权失败，请检查 API Key 和模型权限"
	case http.StatusNotFound:
		return "模型或模型接口不存在，请检查渠道配置"
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return "模型服务响应超时，请稍后重试"
	case http.StatusTooManyRequests:
		return "模型服务请求过于频繁或额度不足，请稍后重试"
	}
	if e.StatusCode >= http.StatusInternalServerError {
		return fmt.Sprintf("模型服务暂时不可用（HTTP %d）", e.StatusCode)
	}
	return fmt.Sprintf("模型服务请求失败（HTTP %d）", e.StatusCode)
}

// StatePendingError 表示上游任务状态尚未同步，应继续查询原任务。
type StatePendingError struct {
	TaskID string
	Cause  error
}

func (e StatePendingError) Error() string {
	return fmt.Sprintf("上游任务状态尚未同步，将继续查询原任务（任务 %s）", e.TaskID)
}

func (e StatePendingError) Unwrap() error { return e.Cause }
