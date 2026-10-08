package app

// 画布生成任务调度、输入水合与跨能力共享类型/辅助函数。

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
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
	AudioLanguage         string                 `json:"audioLanguage"`
	AudioDialect          string                 `json:"audioDialect"`
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
		string(model.ChannelInterfaceVolcengineArkVideo), string(model.ChannelInterfaceVolcengineArkAgentPlanVideo),
		string(model.ChannelInterfaceDoubaoStreamingTTS):
		return true
	}
	if isGrokVideoConfig(input.Config) || isSeedanceVideoConfig(input.Config) || isArkPlanVideoConfig(input.Config) {
		return true
	}
	return false
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
