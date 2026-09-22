package app

// 画布生成任务调度、输入水合与跨能力共享类型/辅助函数。

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"infinite-canvas/backend/internal/kernel"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

var sseFrameBoundaryPattern = regexp.MustCompile(`\r?\n\r?\n`)

type canvasGenerationInput struct {
	Mode             string                 `json:"mode"`
	Prompt           string                 `json:"prompt"`
	Config           providerConfig         `json:"config"`
	ReferenceImages  []providerMedia        `json:"referenceImages"`
	ReferenceVideos  []providerMedia        `json:"referenceVideos"`
	ReferenceAudios  []providerMedia        `json:"referenceAudios"`
	TextHistory      []providerTextMessage  `json:"textHistory"`
	Mask             *providerMedia         `json:"mask"`
	Metadata         map[string]interface{} `json:"metadata"`
	AgentRequests    *agentToolRequests     `json:"agentRequests"`
	TextOptions      canvasTextOptions      `json:"textOptions"`
	ImageCapability  *ImageCapabilityConfig `json:"-"`
	StreamText       bool                   `json:"-"` // 分镜请求使用上游 SSE 保活；最终结构仍在流结束后统一校验。
	MaxOutputTokens  int                    `json:"-"`
	OnTextDelta      func(string)           `json:"-"`
	OnReasoningDelta func(string)           `json:"-"`
	VideoCapability  *VideoCapabilityConfig `json:"-"`
}

type canvasTextOptions struct {
	Stream   *bool `json:"stream"`
	Thinking bool  `json:"thinking"`
	// MaxOutputTokens 是本次调用的输出上限（思考 + 正文 + 工具参数）。
	// 画布 Agent 的每一步都带上限：不设时上游按"剩余上下文"放行，思考模型可以把单步
	// 拖到几分钟（实测 output_tokens 正好吃满可用预算、正文与工具调用皆空）；0 表示不限制。
	MaxOutputTokens int `json:"maxOutputTokens,omitempty"`
}

type agentToolRequests struct {
	Canonical      *canonicalAgentRequest `json:"canonical,omitempty"`
	Responses      map[string]interface{} `json:"responses"`
	ChatCompletion map[string]interface{} `json:"chatCompletion"`
	Claude         map[string]interface{} `json:"claude"`
	Gemini         map[string]interface{} `json:"gemini"`
}

type providerTextMessage struct {
	Role               string `json:"role"`
	Content            string `json:"content"`
	AgentContextSource string `json:"agentContextSource,omitempty"`
}

type providerConfig struct {
	ChannelID             string                 `json:"channelId"`
	ChannelModelKey       string                 `json:"channelModelKey,omitempty"`
	PriceTierID           string                 `json:"priceTierId,omitempty"`
	ProviderModelKey      string                 `json:"providerModelKey,omitempty"`
	APIFormat             string                 `json:"apiFormat"`
	InterfaceType         string                 `json:"interfaceType"`
	BaseURL               string                 `json:"baseUrl"`
	APIKey                string                 `json:"apiKey"`
	SecretKey             string                 `json:"secretKey"`
	Headers               []OutboundHeader       `json:"headers"`
	Model                 string                 `json:"model"`
	Size                  string                 `json:"size"`
	Quality               string                 `json:"quality"`
	TransparentBackground string                 `json:"transparentBackground"`
	Count                 string                 `json:"count"`
	VideoSeconds          string                 `json:"videoSeconds"`
	VQuality              string                 `json:"vquality"`
	VideoGenerateAudio    string                 `json:"videoGenerateAudio"`
	VideoWatermark        string                 `json:"videoWatermark"`
	ArkPrivateAssetUpload string                 `json:"videoArkPrivateAssetUpload"`
	AudioVoice            string                 `json:"audioVoice"`
	AudioFormat           string                 `json:"audioFormat"`
	AudioSpeed            string                 `json:"audioSpeed"`
	AudioInstructions     string                 `json:"audioInstructions"`
	SystemPrompt          string                 `json:"systemPrompt"`
	CapabilityConfig      *ModelCapabilityConfig `json:"capabilityConfig"`
	WorkflowID            string                 `json:"workflowId"`
	WebappID              string                 `json:"webappId"`
	WorkflowJSON          map[string]interface{} `json:"workflowJson"`
	WorkflowFields        []WorkflowField        `json:"workflowFields"`
	RunningHubUseWallet   bool                   `json:"runningHubUseWallet"`
	RunningHubWalletKey   string                 `json:"runningHubWalletApiKey"`
	RunningHubUploadKey   string                 `json:"runningHubUploadApiKey"`
}

const providerHTTPTimeout = 5 * time.Minute
const videoPollTimeout = time.Hour
const maxProviderResponseBytes int64 = 64 << 20

type providerMedia struct {
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

type imageResponse struct {
	Data  []map[string]interface{} `json:"data"`
	Error *providerError           `json:"error"`
	Code  *int                     `json:"code"`
	Msg   string                   `json:"msg"`
}

type providerError struct {
	Message string `json:"message"`
}

// providerPayloadError 在进程内保留上游原始原因，供协议兼容分支做机器判断；
// 对调用方只暴露经过过滤的错误原因。Provider 正文可能包含密钥或内部诊断，
// 禁止原样进入用户错误和日志。
type providerPayloadError struct {
	raw     string
	message string
}

func (e providerPayloadError) Error() string { return e.message }

type providerHTTPError struct {
	StatusCode int
	Status     string
	Body       string
	RetryAfter time.Duration
}

type providerResponseDecodeError struct {
	Err error
}

func (e providerResponseDecodeError) Error() string { return e.Err.Error() }
func (e providerResponseDecodeError) Unwrap() error { return e.Err }

type providerCircuitOpenError struct{}

func (providerCircuitOpenError) Error() string {
	return "当前渠道连续失败，已暂时熔断，请稍后重试"
}

type providerStatePendingError struct {
	TaskID string
	Cause  error
}

func (e providerStatePendingError) Error() string {
	return fmt.Sprintf("上游任务状态尚未同步，将继续查询原任务（任务 %s）", e.TaskID)
}

func (e providerStatePendingError) Unwrap() error { return e.Cause }

type providerAnalyticsKey struct{}

type providerAnalyticsContext struct {
	Service           *Service
	Billing           taskBillingLifecycle
	UserID            string
	TaskID            string
	TraceID           string
	RequestID         string
	BillingOrderID    string
	BillingMode       string
	Capability        string
	Operation         string
	ChannelID         string
	Model             string
	VideoSeconds      int
	RequestKind       string
	ProviderRequestID string
	ConcurrencyLimit  int
}

func withProviderAnalytics(ctx context.Context, service *Service, task model.Task) context.Context {
	metadata := providerAnalyticsContext{Service: service, UserID: task.UserID, TaskID: task.ID, TraceID: task.TraceID, RequestID: task.RequestID, BillingOrderID: task.BillingOrderID, Capability: capabilityFromTaskType(task.Type), Operation: task.Operation, Model: task.Model, ProviderRequestID: task.ProviderRequestID}
	if service != nil {
		metadata.Billing = service.taskBilling()
	}
	// 账单模式随请求上下文传递，流式协议据此只为 Token 计费开启 usage 终态块。
	if service != nil && task.BillingOrderID != "" {
		if order, err := service.repo.BillingOrder(task.BillingOrderID); err == nil {
			metadata.BillingMode = order.BillingMode
		}
	}
	var input struct {
		Mode   string         `json:"mode"`
		Config providerConfig `json:"config"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) == nil {
		metadata.ChannelID = firstNonEmpty(input.Config.ChannelID, systemChannelIDFromBaseURL(input.Config.BaseURL))
		metadata.Model = firstNonEmpty(input.Config.ChannelModelKey, input.Config.Model, metadata.Model)
		metadata.VideoSeconds, _ = strconv.Atoi(input.Config.VideoSeconds)
		if normalized := normalizeCapability(input.Mode); normalized != "" {
			metadata.Capability = normalized
		}
	}
	return context.WithValue(ctx, providerAnalyticsKey{}, metadata)
}

func resumedProviderRequestID(ctx context.Context) string {
	metadata, _ := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	return strings.TrimSpace(metadata.ProviderRequestID)
}

func withProviderRequestKind(ctx context.Context, requestKind string) context.Context {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok {
		return ctx
	}
	metadata.RequestKind = requestKind
	return context.WithValue(ctx, providerAnalyticsKey{}, metadata)
}

func (e providerHTTPError) Error() string {
	if e.StatusCode == http.StatusBadRequest || e.StatusCode == http.StatusUnprocessableEntity {
		return providerErrorWithDetail(e.summary(), e.Body)
	}
	return appendProviderErrorDetail(e.summary(), e.Body)
}

func (e providerHTTPError) summary() string {
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

func providerUserFacingErrorMessage(err error) string {
	if err == nil {
		return "模型服务请求失败"
	}
	if errors.Is(err, context.Canceled) {
		return "模型请求已取消"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "模型服务响应超时，请稍后重试"
	}
	var appErr *AppError
	if errors.As(err, &appErr) && strings.TrimSpace(appErr.Message) != "" {
		return appErr.Message
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.Error()
	}
	return "连接模型服务失败，请检查渠道地址和网络"
}

// providerPayloadErrorCategory 把上游失败正文归类为固定的用户可见原因。
// 第二个返回值为 false 表示正文无法归类，调用方应退回到更通用的提示，
// 不要因为归类失败就把正文本身当作错误信息。
// 正文可能包含密钥或内部诊断信息，只能参与归类，不得回传用户或写入日志。
func providerPayloadErrorCategory(raw string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" {
		return "", false
	}
	switch {
	// 真人肖像类目只匹配供应商错误码里的稳定标识，不扫描自然语言。
	// 正文常常回显用户提示词，"likeness"、"肖像"这类词单独出现并不能证明
	// 上游是因为真人形象拒绝，按词判断会把普通参数错误误报成肖像问题。
	// 该类目排在安全审核之前：错误码已经足够具体，比通用审核提示更可行动。
	case strings.Contains(normalized, "privacyinformation"), strings.Contains(normalized, "sensitivecontentdetected"):
		return "输入素材疑似包含真人形象，该模型拒绝生成，请更换为非真人素材或改用其他模型", true
	case strings.Contains(normalized, "safety"), strings.Contains(normalized, "moderation"), strings.Contains(normalized, "content policy"), strings.Contains(normalized, "blocked"):
		return "请求内容未通过模型服务安全审核，请调整后重试", true
	// 工具调用与工具结果不配对：上游要求 assistant 消息声明的每一个 tool_call_id 都在
	// 紧随其后的 tool 消息里被回应。这是**我们组装请求**的问题——用户改提示词或查额度
	// 都没用——所以文案指向反馈而不是"调整输入"。
	//
	// 必须排在额度类目之前：DeepSeek 的原文含 "insufficient"，
	// "An assistant message with 'tool_calls' must be followed by tool messages
	// responding to each 'tool_call_id'. (insufficient tool messages following
	// tool_calls message)" 落到额度类目就会把协议错误报成"渠道余额不足"，
	// 掩盖真正的原因（历史里的工具结果不连续）。
	case strings.Contains(normalized, "must be followed by tool messages"),
		strings.Contains(normalized, "insufficient tool messages following"):
		return "会话里的工具调用与结果不匹配，本轮已停止；这不是额度或提示词问题，如反复出现请反馈", true
	case strings.Contains(normalized, "quota"), strings.Contains(normalized, "insufficient"), strings.Contains(normalized, "balance"), strings.Contains(normalized, "billing"):
		return "模型服务额度不足，请检查渠道余额或配额", true
	case strings.Contains(normalized, "model") && (strings.Contains(normalized, "not found") || strings.Contains(normalized, "permission") || strings.Contains(normalized, "access")):
		return "模型不存在或当前渠道未获得模型权限", true
	// 推理/思考模式模型通常禁止强制指定工具调用：DeepSeek 思考模式返回
	// "Thinking mode does not support this tool_choice"，其他 OpenAI 兼容
	// 供应商措辞类似。归为固定可行动原因；显式思考模式会在出站前省略
	// tool_choice，未声明但由上游隐式开启思考时再按兼容序列重试。排在
	// 通用参数类目之前，避免稳定标识落回笼统的"请检查模型和参数"。
	case (strings.Contains(normalized, "thinking") || strings.Contains(normalized, "reasoning")) && strings.Contains(normalized, "tool_choice"),
		strings.Contains(normalized, "tool_choice") && (strings.Contains(normalized, "not support") || strings.Contains(normalized, "unsupported")):
		return "当前模型为思考/推理模式，不支持强制工具调用（tool_choice=required），请改用自动工具选择或更换非思考模式模型", true
	case strings.Contains(normalized, "invalid"), strings.Contains(normalized, "parameter"), strings.Contains(normalized, "argument"):
		return "模型服务拒绝了请求，请检查模型和参数", true
	}
	return "", false
}

func providerPayloadErrorMessage(raw string) string {
	return providerErrorWithDetail("模型服务返回失败，请检查请求内容或渠道配置", raw)
}

func (s *Service) processCanvasGenerationTask(ctx context.Context, userID string, taskProjectID string, taskType string, fallbackPrompt string, rawInput string) (map[string]interface{}, error) {
	ctx = withProtocolRegistry(ctx, s.protocolRegistry())
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(rawInput), &input); err != nil {
		return nil, fmt.Errorf("任务输入解析失败：%w", err)
	}
	if strings.TrimSpace(input.Prompt) == "" {
		input.Prompt = fallbackPrompt
	}
	if input.Mode == "" && strings.HasPrefix(taskType, "video_") {
		input.Mode = "video"
	}
	promptTemplateOperation := metadataString(input.Metadata, "promptTemplateOperation")
	// 视频节点的最终 Prompt 只取输入框内容，不能被分镜模板替换；图片和文本仍沿用模板能力。
	if input.Mode != "video" && promptTemplateOperation != "" {
		values := metadataStringValues(input.Metadata["promptTemplateVariables"])
		compiled, compileErr := s.compilePrompt(userID, promptTemplateOperation, values)
		if compileErr != nil {
			return nil, fmt.Errorf("编译用户提示词失败：%w", compileErr)
		}
		input.Prompt = compiled.Content
	}
	if strings.TrimSpace(input.Prompt) == "" {
		return nil, errors.New("prompt is required")
	}
	// 将 @[tool:type:ID:label:icon] 令牌替换为对应工具的提示词文本
	resolved, err := s.ResolveToolMentionTokens(userID, input.Mode, input.Prompt)
	if err != nil {
		return nil, err
	}
	input.Prompt = resolved
	config, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return nil, err
	}
	input.Config = config
	if input.Mode == "text" && input.Config.CapabilityConfig != nil && input.Config.CapabilityConfig.Text != nil {
		// The same capability contract drives provider output limits, billing
		// estimates and Agent context budgeting. Never silently fall back to a
		// transport-specific fixed token count when the model declares one.
		input.MaxOutputTokens = input.Config.CapabilityConfig.Text.MaxOutputTokens
	}
	var textPublisher *taskTextStreamPublisher
	if input.Mode == "text" && strings.HasPrefix(taskType, "canvas_text") {
		requestedStream := input.TextOptions.Stream == nil || *input.TextOptions.Stream
		supportsStream := input.Config.CapabilityConfig == nil || input.Config.CapabilityConfig.Text == nil || input.Config.CapabilityConfig.Text.Streaming == nil || *input.Config.CapabilityConfig.Text.Streaming
		input.StreamText = requestedStream && supportsStream
	}
	if input.Mode == "text" && strings.HasPrefix(taskType, "canvas_text") && input.StreamText {
		textPublisher = newTaskTextStreamPublisher(s, userID, taskExecutionID(ctx))
		if input.AgentRequests != nil {
			textPublisher = newCloudAgentStreamPublisher(s, userID, taskExecutionID(ctx), "assistant_delta")
			reasoningPublisher := newCloudAgentStreamPublisher(s, userID, taskExecutionID(ctx), "reasoning_delta")
			input.OnReasoningDelta = reasoningPublisher.Publish
			defer reasoningPublisher.Close()
		}
		input.OnTextDelta = textPublisher.Publish
		defer textPublisher.Close()
	}
	if isWorkflowProviderInterface(input.Config.InterfaceType) {
		if err := s.RequireWorkflowPluginForInterface(input.Config.InterfaceType); err != nil {
			return nil, err
		}
		if err := validateWorkflowProviderPromptLength(input); err != nil {
			return nil, err
		}
		if err := validateWorkflowProviderConfig(input.Mode, input.Config); err != nil {
			return nil, err
		}
		// 工作流参数由工作流字段定义校验，普通模型能力配置不能覆盖它们。
		if resumedProviderRequestID(ctx) == "" {
			if err := s.hydrateGenerationMedia(userID, &input, providerMediaHydrationPolicy{}); err != nil {
				return nil, err
			}
		}
		return s.runWorkflowProviderTask(ctx, input)
	}
	if input.Mode == "image" && input.Metadata != nil {
		if err := s.applyGenerationStyleProfile(userID, taskProjectID, &input); err != nil {
			return nil, err
		}
	}
	if input.Config.APIFormat == "gemini" && input.Config.InterfaceType != string(model.ChannelInterfaceGeminiVeo) && input.Config.InterfaceType != string(model.ChannelInterfaceGeminiImage) {
		_, hasDeclarativeAgent := agentProtocolAdapterForContext(ctx, input.Config.InterfaceType)
		if input.AgentRequests == nil || !hasDeclarativeAgent {
			return nil, errors.New("后端任务队列暂不支持该 Gemini 调用格式，请选择已安装的 Gemini 协议插件")
		}
	}
	if strings.TrimSpace(input.Config.BaseURL) == "" || strings.TrimSpace(input.Config.APIKey) == "" || strings.TrimSpace(input.Config.Model) == "" {
		return nil, errors.New("后端生成任务缺少 Base URL、API Key 或模型名")
	}
	if err := s.validateGenerationInterface(input.Mode, input.Config.InterfaceType); err != nil {
		return nil, err
	}
	if isVolcengineJiMengProtocol(input.Config.InterfaceType) && strings.TrimSpace(input.Config.SecretKey) == "" {
		return nil, errors.New("即梦官方 API 缺少 Secret Key")
	}
	if input.Mode == "image" {
		if err := s.validateResolvedImageCapability(&input); err != nil {
			return nil, err
		}
	}
	if input.Mode == "video" {
		if err := s.validateResolvedVideoCapability(&input); err != nil {
			return nil, err
		}
	}
	if resumedProviderRequestID(ctx) == "" {
		mediaPolicy := providerMediaHydrationPolicyFor(ctx, input)
		if err := s.hydrateGenerationMedia(userID, &input, mediaPolicy); err != nil {
			return nil, err
		}
		if err := s.prepareArkPrivateAssetReferences(ctx, userID, &input); err != nil {
			return nil, err
		}
	}
	if input.Mode == "video" && input.VideoCapability != nil {
		if err := validateVideoTask(input.VideoCapability, input); err != nil {
			return nil, err
		}
	}
	switch input.Mode {
	case "image":
		return runImageTask(ctx, input)
	case "text":
		if input.AgentRequests != nil {
			input, err = resolveAgentResourcePlaceholders(input, true)
			if err != nil {
				return nil, err
			}
			return runAgentToolTask(ctx, input)
		}
		result, taskErr := runTextTask(ctx, input)
		if taskErr == nil && promptTemplateOperation != "" {
			taskErr = validatePromptTemplateResult(promptTemplateOperation, result)
		}
		return result, taskErr
	case "video":
		return runVideoTask(ctx, input)
	case "audio":
		return runAudioTask(ctx, input)
	default:
		return nil, fmt.Errorf("不支持的生成模式：%s", input.Mode)
	}
}

type providerMediaHydrationPolicy struct {
	requireURL bool
	preferURL  bool
	imageOnly  bool
	maxBytes   int64
}

func providerMediaHydrationPolicyFor(ctx context.Context, input canvasGenerationInput) providerMediaHydrationPolicy {
	policy := providerMediaHydrationPolicy{preferURL: providerPrefersMediaURLs(input.Config.InterfaceType, input)}
	switch strings.TrimSpace(input.Config.InterfaceType) {
	case string(model.ChannelInterfaceNewAPIVideo), string(model.ChannelInterfaceNewAPIChannel1), string(model.ChannelInterfaceNewAPIChannel2), string(model.ChannelInterfaceVolcengineArkVideo), string(model.ChannelInterfaceVolcengineArkAgentPlanVideo), string(model.ChannelInterfaceMiniMaxVideo):
		policy.requireURL = true
		policy.preferURL = true
	}
	if adapter, ok := protocolAdapterForContext(ctx, input.Config.InterfaceType); ok && adapter.Metadata().RequiresPublicMediaURLs {
		policy.requireURL = true
		policy.preferURL = true
	}
	if input.Mask != nil {
		policy.requireURL = false
		policy.preferURL = false
	}
	return policy
}

// providerPrefersMediaURLs 只列出明确接受远程 URL 的协议。
// 需要 multipart/原始字节的协议继续走字节路径，不能为了减少下载而擅自改变请求合同。
func providerPrefersMediaURLs(interfaceType string, input canvasGenerationInput) bool {
	if input.Mask != nil {
		// OpenAI 图片编辑等 multipart 请求需要真实文件字节，遮罩场景不能改发 URL。
		return false
	}
	switch strings.TrimSpace(interfaceType) {
	case string(model.ChannelInterfaceChatCompletion), string(model.ChannelInterfaceOpenAIResponse), string(model.ChannelInterfaceClaudeAPI),
		string(model.ChannelInterfaceGrokImage), string(model.ChannelInterfaceVolcengineArkImage), string(model.ChannelInterfaceVolcengineArkAgentPlanImage),
		string(model.ChannelInterfaceXAIVideo), string(model.ChannelInterfaceNovitaVideo),
		string(model.ChannelInterfaceMiniMaxVideo), string(model.ChannelInterfaceNewAPIVideo),
		string(model.ChannelInterfaceNewAPIChannel1), string(model.ChannelInterfaceNewAPIChannel2),
		string(model.ChannelInterfaceVolcengineArkVideo), string(model.ChannelInterfaceVolcengineArkAgentPlanVideo):
		return true
	}
	if isGrokVideoConfig(input.Config) || isSeedanceVideoConfig(input.Config) || isArkPlanVideoConfig(input.Config) {
		return true
	}
	return false
}

type styleExecutionPlanDocument struct {
	SchemaVersion   int    `json:"schemaVersion"`
	ProfilePresetID string `json:"profilePresetId"`
	ProfileRevision int    `json:"profileRevision"`
	Mode            string `json:"mode"`
	Model           string `json:"model"`
	InterfaceType   string `json:"interfaceType"`
	Status          string `json:"status"`
	Prompt          string `json:"prompt"`
}

func (s *Service) applyGenerationStyleProfile(userID string, taskProjectID string, input *canvasGenerationInput) error {
	styleProfileJSON := metadataString(input.Metadata, "styleProfileJson")
	if strings.TrimSpace(styleProfileJSON) == "" {
		return nil
	}
	if _, err := validateStyleProfileJSON(styleProfileJSON); err != nil {
		return fmt.Errorf("项目画风执行配置无效：%w", err)
	}
	var profile styleProfileDocument
	if err := json.Unmarshal([]byte(styleProfileJSON), &profile); err != nil {
		return fmt.Errorf("项目画风执行配置解析失败：%w", err)
	}
	storedProfileJSON, storedPresetID, belongsToProject, err := s.taskProjectStyleProfile(userID, taskProjectID)
	if err != nil {
		return fmt.Errorf("读取项目画风失败：%w", err)
	}
	if belongsToProject {
		if strings.TrimSpace(storedProfileJSON) == "" {
			// 旧项目只有 preset ID，允许画布把该预设编译为结构化快照；仍需锁定同一预设，不能借降级路径换画风。
			if strings.TrimSpace(storedPresetID) == "" || strings.TrimSpace(profile.PresetID) != strings.TrimSpace(storedPresetID) {
				return errors.New("项目画风已发生变化，请返回项目列表后重新打开当前项目再生成")
			}
		} else {
			matches, compareErr := equivalentStyleProfileJSON(styleProfileJSON, storedProfileJSON)
			if compareErr != nil {
				return errors.New("项目画风配置暂时无法读取，请在项目设置中重新保存画风后重试")
			}
			if !matches {
				// 项目画风可能在另一个页面更新；保存路径以服务端快照为准，生成时自动采用最新版本。
				validatedStoredProfileJSON, validateErr := validateStyleProfileJSON(storedProfileJSON)
				if validateErr != nil || json.Unmarshal([]byte(validatedStoredProfileJSON), &profile) != nil {
					return errors.New("项目画风配置暂时无法读取，请在项目设置中重新保存画风后重试")
				}
			}
		}
	}
	// 执行计划是前端为即时预览生成的派生数据。平台模型入队后可能改选真实供应线路，
	// 因此后端必须以最终模型重新编译，不能要求用户手动“刷新配置”来同步内部路由。
	plan, _ := decodeStyleExecutionPlan(input.Metadata["styleExecutionPlan"])
	stylePrompt, expectedStatus, warnings := resolveGenerationStyleExecution(profile, input.Config.Model, firstNonEmpty(input.Config.InterfaceType, input.Config.APIFormat))
	input.Prompt = reconcileGenerationStylePrompt(input.Prompt, plan.Prompt, stylePrompt)
	if expectedStatus == "blocked" {
		return fmt.Errorf("当前图片模型无法完整执行项目画风：%s。请切换图片模型，或在项目设置中停用对应画风资产", strings.Join(warnings, "；"))
	}
	return nil
}

func reconcileGenerationStylePrompt(prompt string, previousStylePrompt string, currentStylePrompt string) string {
	content := strings.TrimSpace(prompt)
	previous := strings.TrimSpace(previousStylePrompt)
	if previous != "" {
		previousBlock := "【项目画风执行规范】\n" + previous
		if strings.HasSuffix(content, previousBlock) {
			content = strings.TrimSpace(strings.TrimSuffix(content, previousBlock))
		}
	}
	current := strings.TrimSpace(currentStylePrompt)
	if current == "" || strings.HasSuffix(content, "【项目画风执行规范】\n"+current) {
		return content
	}
	return strings.TrimSpace(content + "\n\n【项目画风执行规范】\n" + current)
}

func (s *Service) taskProjectStyleProfile(userID string, canvasOrProjectID string) (string, string, bool, error) {
	id := strings.TrimSpace(canvasOrProjectID)
	if id == "" {
		return "", "", false, nil
	}
	if canvas, err := s.repo.CanvasProjectForUser(userID, id); err == nil {
		if strings.TrimSpace(canvas.ProjectID) == "" {
			return "", "", false, nil
		}
		project, projectErr := s.repo.ProjectForUser(userID, canvas.ProjectID)
		if projectErr != nil {
			return "", "", true, projectErr
		}
		return project.StyleProfileJSON, project.StylePresetID, true, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", "", false, err
	}
	project, err := s.repo.ProjectForUser(userID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", "", false, nil
		}
		return "", "", false, err
	}
	return project.StyleProfileJSON, project.StylePresetID, true, nil
}

func equivalentStyleProfileJSON(left string, right string) (bool, error) {
	var leftValue interface{}
	if err := json.Unmarshal([]byte(left), &leftValue); err != nil {
		return false, err
	}
	var rightValue interface{}
	if err := json.Unmarshal([]byte(right), &rightValue); err != nil {
		return false, err
	}
	leftCanonical, err := json.Marshal(leftValue)
	if err != nil {
		return false, err
	}
	rightCanonical, err := json.Marshal(rightValue)
	if err != nil {
		return false, err
	}
	return bytes.Equal(leftCanonical, rightCanonical), nil
}

func decodeStyleExecutionPlan(value interface{}) (styleExecutionPlanDocument, error) {
	if value == nil {
		return styleExecutionPlanDocument{}, errors.New("项目画风执行计划缺失")
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return styleExecutionPlanDocument{}, errors.New("项目画风执行计划格式无效")
	}
	var plan styleExecutionPlanDocument
	if err := json.Unmarshal(raw, &plan); err != nil {
		return styleExecutionPlanDocument{}, errors.New("项目画风执行计划格式无效")
	}
	return plan, nil
}

func resolveGenerationStyleExecution(profile styleProfileDocument, generationModel string, interfaceType string) (string, string, []string) {
	fragments := []string{strings.TrimSpace(profile.Prompt)}
	if negative := strings.TrimSpace(profile.NegativePrompt); negative != "" {
		fragments = append(fragments, "【全局负面 Prompt】\n"+negative)
	}
	warnings := make([]string, 0)
	for _, asset := range profile.Assets {
		if asset.Enabled != nil && !*asset.Enabled {
			continue
		}
		if asset.Status != "validated" {
			reason := "资产尚未验证"
			if asset.Status == "unavailable" {
				reason = "资产当前不可用"
			}
			warnings = append(warnings, asset.Title+"："+reason)
			continue
		}
		if len(asset.BaseModels) > 0 && !styleAssetSupportsModel(asset.BaseModels, generationModel) {
			warnings = append(warnings, asset.Title+"：仅兼容 "+strings.Join(asset.BaseModels, "、"))
			continue
		}
		switch asset.Kind {
		case "prompt", "template":
			fragments = append(fragments, strings.TrimSpace(asset.PromptFragment))
			fragments = append(fragments, nonEmptyStyleProfileStrings(asset.TriggerWords)...)
		case "reference":
			warnings = append(warnings, asset.Title+"：项目参考图自动注入适配器尚未启用")
		case "lora":
			warnings = append(warnings, asset.Title+"：当前 "+firstNonEmpty(interfaceType, "图片")+" 协议未启用 LoRA 适配器")
		}
	}
	normalizedFragments := nonEmptyStyleProfileStrings(fragments)
	status := "ready"
	if len(warnings) > 0 {
		status = "degraded"
		if profile.ExecutionPolicy == "strict-assets" {
			status = "blocked"
		}
	}
	return strings.Join(normalizedFragments, "\n"), status, warnings
}

func styleAssetSupportsModel(baseModels []string, generationModel string) bool {
	for _, baseModel := range baseModels {
		if strings.EqualFold(strings.TrimSpace(baseModel), strings.TrimSpace(generationModel)) {
			return true
		}
	}
	return false
}

func (s *Service) validateResolvedImageCapability(input *canvasGenerationInput) error {
	fallback := DefaultImageCapabilityConfig(input.Config.InterfaceType, input.Config.Model)
	channelID := strings.TrimSpace(input.Config.ChannelID)
	if channelID == "" {
		if input.Config.CapabilityConfig != nil && input.Config.CapabilityConfig.Image != nil {
			input.ImageCapability = input.Config.CapabilityConfig.Image
		} else {
			input.ImageCapability = fallback
		}
		return validateImageTask(input.ImageCapability, *input)
	}
	item, err := s.repo.ChannelModelByKey(channelID, providerChannelModelKey(input.Config))
	if err != nil {
		return errors.New("当前系统渠道模型未配置或已停用")
	}
	profile, err := DecodeModelCapabilityConfig(item.CapabilityConfigJSON)
	if err != nil {
		return errors.New("当前图片模型能力参数无效")
	}
	if profile != nil && profile.Image != nil {
		input.ImageCapability = profile.Image
	} else {
		input.ImageCapability = fallback
	}
	return validateImageTask(input.ImageCapability, *input)
}

func metadataStringValues(value any) map[string]string {
	values := map[string]string{}
	raw, ok := value.(map[string]interface{})
	if !ok {
		return values
	}
	for key, item := range raw {
		values[key] = strings.TrimSpace(fmt.Sprint(item))
	}
	return values
}

func (s *Service) hydrateGenerationMedia(userID string, input *canvasGenerationInput, policy providerMediaHydrationPolicy) error {
	groups := [][]providerMedia{input.ReferenceImages, input.ReferenceVideos, input.ReferenceAudios}
	for groupIndex, group := range groups {
		mediaPolicy := policy
		// 仅 Agent 图片走内存字节；视频、音频及普通生成任务保留原来的协议策略。
		if groupIndex == 0 && input.Mode == "text" && input.AgentRequests != nil && input.AgentRequests.Canonical != nil {
			mediaPolicy = providerMediaHydrationPolicy{imageOnly: true}
			if input.Config.CapabilityConfig != nil && input.Config.CapabilityConfig.Text != nil {
				limits := input.Config.CapabilityConfig.Text.References
				if len(group) > limits.MaxImages {
					return errors.New("参考图片数量超过当前模型限制")
				}
				mediaPolicy.maxBytes = limits.MaxImageBytes
			}
		}
		for index := range group {
			if err := s.hydrateProviderMedia(userID, &group[index], mediaPolicy); err != nil {
				return err
			}
		}
	}
	if input.Mask != nil {
		return s.hydrateProviderMedia(userID, input.Mask, policy)
	}
	return nil
}

func (s *Service) hydrateProviderMedia(userID string, media *providerMedia, policy providerMediaHydrationPolicy) error {
	if !strings.HasPrefix(media.StorageKey, "resource:") {
		if policy.requireURL && strings.HasPrefix(strings.TrimSpace(media.DataURL), "data:") {
			return errors.New("当前 JSON 视频协议的参考素材不能使用内嵌数据，请先上传到对象存储或提供公网素材地址")
		}
		return nil
	}
	resourceID := strings.TrimPrefix(media.StorageKey, "resource:")
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		return fmt.Errorf("读取任务参考资源失败：%w", err)
	}
	if resource.Status != "ready" {
		return errors.New("任务参考资源尚未上传完成")
	}
	if policy.imageOnly && !strings.HasPrefix(strings.ToLower(resource.MimeType), "image/") {
		return errors.New("看图资源不是图片")
	}
	if policy.maxBytes > 0 && resource.Size > policy.maxBytes {
		return errors.New("参考图片文件超过当前模型大小限制")
	}
	useObjectURL := policy.requireURL || (policy.preferURL && resourceUsesObjectStorage(resource))
	if useObjectURL {
		signedURL, err := s.providerResourceURL(resource, time.Now().Add(providerResourceURLTTL))
		if err != nil {
			return fmt.Errorf("生成参考素材地址失败：%w", err)
		}
		media.URL = signedURL
		media.DataURL = ""
		media.MimeType = firstNonEmpty(media.MimeType, resource.MimeType)
		media.Bytes = resource.Size
		media.Width = resource.Width
		media.Height = resource.Height
		media.DurationMs = resource.DurationMs
		return nil
	}
	// Agent 看图以归属校验后的资源文件为准，不能让附带的内嵌内容替换真实图片。
	if !policy.imageOnly && strings.HasPrefix(strings.TrimSpace(media.DataURL), "data:") {
		return nil
	}
	resource, body, err := s.OpenResource(userID, resourceID)
	if err != nil {
		return fmt.Errorf("读取任务参考资源失败：%w", err)
	}
	defer body.Close()
	runtimePolicy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	resourceLimit := megabytes(runtimePolicy.Resource.ResourceUploadMB)
	if policy.maxBytes > 0 {
		resourceLimit = min(resourceLimit, policy.maxBytes)
	}
	data, err := io.ReadAll(io.LimitReader(body, resourceLimit+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > resourceLimit {
		return fmt.Errorf("任务参考资源超过读取上限 %d 字节", resourceLimit)
	}
	if policy.imageOnly && len(data) == 0 {
		return errors.New("看图资源内容为空")
	}
	mimeType := normalizedMediaMimeType(firstNonEmpty(media.MimeType, resource.MimeType), data)
	media.DataURL = dataURL(mimeType, data)
	media.MimeType = mimeType
	media.Bytes = int64(len(data))
	media.Width = resource.Width
	media.Height = resource.Height
	media.DurationMs = resource.DurationMs
	return nil
}

func resourceUsesObjectStorage(resource *model.Resource) bool {
	if resource == nil {
		return false
	}
	provider := strings.ToLower(strings.TrimSpace(resource.Provider))
	return provider != "" && provider != "local"
}

func normalizedMediaMimeType(declared string, data []byte) string {
	declared = strings.TrimSpace(strings.Split(declared, ";")[0])
	if declared != "" && declared != "application/octet-stream" {
		return declared
	}
	detected := strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0])
	return defaultString(detected, "application/octet-stream")
}

func (s *Service) resolveProviderConfig(config providerConfig) (providerConfig, error) {
	headers, err := NormalizeOutboundHeaders(config.Headers)
	if err != nil {
		return providerConfig{}, err
	}
	config.Headers = headers
	if isRunningHubInterface(config.InterfaceType) && strings.TrimSpace(config.BaseURL) == "" {
		config.BaseURL = "https://www.runninghub.cn"
	}
	channelID := strings.TrimSpace(config.ChannelID)
	if channelID == "" {
		channelID = systemChannelIDFromBaseURL(config.BaseURL)
	}
	if channelID == "" {
		if _, err := ValidateOutboundURL(config.BaseURL); err != nil {
			return providerConfig{}, err
		}
		return config, nil
	}
	channel, err := s.SystemChannel(channelID)
	if err != nil {
		return providerConfig{}, errors.New("系统渠道不存在或已停用")
	}
	modelKey := strings.TrimPrefix(strings.TrimSpace(config.ChannelModelKey), "models/")
	requestedModel := strings.TrimPrefix(strings.TrimSpace(config.Model), "models/")
	if modelKey == "" {
		modelKey = requestedModel
	}
	if modelKey == "" {
		channelModels, listErr := s.repo.ChannelModels(channel.ID, false)
		if listErr != nil {
			return providerConfig{}, listErr
		}
		if len(channelModels) > 0 {
			modelKey = channelModels[0].ModelKey
		} else {
			models := channelModelNames(*channel)
			if len(models) == 0 {
				return providerConfig{}, errors.New("系统渠道未配置可用模型")
			}
			modelKey = models[0]
		}
	}
	if _, err := ValidateOutboundURL(channel.BaseURL); err != nil {
		return providerConfig{}, err
	}
	config.ChannelID = channel.ID
	config.APIFormat = channel.APIFormat
	channelModel, modelErr := s.repo.ChannelModelByKey(channel.ID, modelKey)
	if modelErr != nil {
		// ModelsJSON 只是旧渠道表上的目录缓存。SKU 合并后它不能代表可执行模型，
		// 唯一授权来源必须是已启用的 channel_models 记录。
		return providerConfig{}, errors.New("当前系统渠道未授权该模型")
	}
	if channelModel.Protocol == "" {
		return providerConfig{}, errors.New("当前模型尚未配置请求协议")
	}
	providerModelKey := strings.TrimPrefix(strings.TrimSpace(config.ProviderModelKey), "models/")
	if config.PriceTierID != "" {
		matched := false
		for _, tier := range channelModel.PriceTiers {
			if tier.ID == config.PriceTierID && tier.Enabled && tier.PriceConfigured {
				providerModelKey = firstNonEmpty(providerModelKey, tier.ProviderModelKey)
				matched = true
				break
			}
		}
		if !matched {
			return providerConfig{}, errors.New("当前模型规格价格档已更新，请重新创建任务")
		}
	} else if modelKey != "" && requestedModel != "" && modelKey != requestedModel {
		return providerConfig{}, errors.New("系统渠道模型标识不一致")
	}
	config.InterfaceType = string(channelModel.Protocol)
	config.APIFormat = channelAPIFormatForProtocol(channel.APIFormat, channelModel.Protocol)
	config.BaseURL = channel.BaseURL
	config.APIKey = channel.APIKey
	config.SecretKey = channel.SecretKey
	config.Headers, err = ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return providerConfig{}, err
	}
	config.ChannelModelKey = modelKey
	config.ProviderModelKey = providerModelKey
	config.Model = firstNonEmpty(providerModelKey, channelModel.ProviderModelKey, modelKey)
	return config, nil
}

// channelAPIFormatForProtocol 以模型协议而不是客户端缓存决定鉴权和请求封装格式。
// 同一系统渠道可以挂载不同协议的模型，因此渠道级 APIFormat 只能作为协议缺失时的兼容值。
func channelAPIFormatForProtocol(channelDefault string, protocol model.ChannelInterfaceType) string {
	switch protocol {
	case model.ChannelInterfaceGeminiVeo, model.ChannelInterfaceGeminiImage:
		return "gemini"
	case model.ChannelInterfaceClaudeAPI:
		return "claude"
	case "":
		return strings.TrimSpace(channelDefault)
	default:
		return "openai"
	}
}

func providerChannelModelKey(config providerConfig) string {
	return strings.TrimPrefix(strings.TrimSpace(firstNonEmpty(config.ChannelModelKey, config.Model)), "models/")
}

func systemChannelIDFromBaseURL(baseURL string) string {
	value := strings.TrimSpace(baseURL)
	lowerValue := strings.ToLower(value)
	for _, marker := range []string{"/api/ai/system/", "/api/"} {
		index := strings.LastIndex(lowerValue, marker)
		if index < 0 {
			continue
		}
		id := strings.Trim(value[index+len(marker):], "/")
		if queryIndex := strings.IndexAny(id, "?#"); queryIndex >= 0 {
			id = id[:queryIndex]
		}
		if slash := strings.Index(id, "/"); slash >= 0 {
			continue
		}
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		switch strings.ToLower(id) {
		case "v1", "v1beta", "v2", "v3", "plan", "ai":
			continue
		default:
			return id
		}
	}
	return ""
}

func openAIImageInputURL(media providerMedia) (string, error) {
	value := strings.TrimSpace(media.DataURL)
	if strings.HasPrefix(value, "data:image/") {
		return value, nil
	}
	if strings.HasPrefix(value, "data:") {
		return "", errors.New("参考图片 MIME 类型无效，请重新读取或上传图片")
	}
	value = strings.TrimSpace(media.URL)
	if strings.HasPrefix(value, "data:image/") || isPublicMediaURL(value) {
		return value, nil
	}
	if strings.HasPrefix(value, "data:") {
		return "", errors.New("参考图片 MIME 类型无效，请重新读取或上传图片")
	}
	return "", errors.New("OpenAI 文本多模态参考图片需要公网 URL 或 base64 data URL")
}

func openAIVideoInputURL(media providerMedia) (string, error) {
	value := strings.TrimSpace(media.DataURL)
	if strings.HasPrefix(value, "data:video/") {
		return value, nil
	}
	if strings.HasPrefix(value, "data:") {
		return "", errors.New("参考视频 MIME 类型无效，请重新读取或上传视频")
	}
	value = strings.TrimSpace(media.URL)
	if strings.HasPrefix(value, "data:video/") || isPublicMediaURL(value) {
		return value, nil
	}
	if strings.HasPrefix(value, "data:") {
		return "", errors.New("参考视频 MIME 类型无效，请重新读取或上传视频")
	}
	return "", errors.New("文本多模态参考视频需要公网 URL 或 base64 data URL")
}

func firstNonEmptyString(values ...string) string {
	return kernel.FirstNonEmpty(values...)
}

func dataURL(mimeType string, data []byte) string {
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return "data:" + strings.Split(mimeType, ";")[0] + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// stringField 只读取异构上游 JSON 中的可选字符串：缺失或 null 返回空串，存在但类型错误也不强制转换。
// task ID 等必填标识必须使用 firstJSONString，让类型错误显式失败。
func stringField(payload map[string]interface{}, key string) string {
	value, err := optionalJSONString(payload, key)
	if err != nil {
		return ""
	}
	return value
}

func withSystemPrompt(config providerConfig, prompt string) string {
	systemPrompt := strings.TrimSpace(config.SystemPrompt)
	if systemPrompt == "" {
		return prompt
	}
	return systemPrompt + "\n\n" + prompt
}

func metadataString(metadata map[string]interface{}, key string) string {
	return strings.TrimSpace(stringField(metadata, key))
}
