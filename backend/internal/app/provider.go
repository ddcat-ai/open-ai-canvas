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
	"yingce/backend/internal/protocol"
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
	ImageResolution       string                 `json:"imageResolution"`
	ImageParameters       map[string]any         `json:"imageParameters,omitempty"`
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
	// RequestFormat 是宿主从插件声明的 create 路径推出来的文字请求格式（chat-completion / responses / claude-api）。
	// 运行时推出来，不落库、不随任务输入回写；空值表示插件未声明或本次不是文字请求。
	// 文字链路的格式判断从协议 ID 改为读这个声明推导结果。
	RequestFormat string `json:"-"`
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
	Role       string `json:"role,omitempty"`
	SlotKey    string `json:"slotKey,omitempty"`
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
	// 工作流协议仍按作者内置协议名分流（未装插件的内置实现）；
	// 改成读 contributes.workflows[].providerId 还要同步改 workflow_plugins.go，不在本次范围内。
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
	// apiFormat 已改为按插件声明的鉴权方式推导（channelAPIFormatForProtocol），
	// 这里只看推导结果：声明了 Gemini 鉴权的声明式插件已装适配器就能通过。
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
	if s.needsSecondCredential(input.Config.InterfaceType) && strings.TrimSpace(input.Config.SecretKey) == "" {
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
	if err := s.validateArkPortraitReferences(userID, &input); err != nil {
		return nil, err
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
		var result map[string]interface{}
		var taskErr error
		if draft, ok := ecommercePlanningBatchable(input); ok {
			result, taskErr = runEcommercePlanningBatches(ctx, input, draft)
		} else {
			result, taskErr = runTextTask(ctx, input)
		}
		if taskErr == nil {
			taskErr = s.validateEcommerceWorkbenchResult(userID, input, result)
		}
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
	policy := providerMediaHydrationPolicy{preferURL: providerPrefersMediaURLs(ctx, input)}
	// 协议名白名单只服务于未装插件的作者内置实现；装了声明式插件就只看插件声明。
	if _, declarative := protocolAdapterForContext(ctx, input.Config.InterfaceType); !declarative {
		switch strings.TrimSpace(input.Config.InterfaceType) {
		case string(model.ChannelInterfaceNewAPIVideo), string(model.ChannelInterfaceNewAPIChannel1), string(model.ChannelInterfaceNewAPIChannel2), string(model.ChannelInterfaceVolcengineArkVideo), string(model.ChannelInterfaceVolcengineArkAgentPlanVideo), string(model.ChannelInterfaceMiniMaxVideo):
			policy.requireURL = true
			policy.preferURL = true
		}
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
func providerPrefersMediaURLs(ctx context.Context, input canvasGenerationInput) bool {
	if input.Mask != nil {
		// OpenAI 图片编辑等 multipart 请求需要真实文件字节，遮罩场景不能改发 URL。
		return false
	}
	switch strings.TrimSpace(input.Config.InterfaceType) {
	case string(model.ChannelInterfaceChatCompletion), string(model.ChannelInterfaceOpenAIResponse), string(model.ChannelInterfaceClaudeAPI),
		string(model.ChannelInterfaceGrokImage), string(model.ChannelInterfaceVolcengineArkImage), string(model.ChannelInterfaceVolcengineArkAgentPlanImage),
		string(model.ChannelInterfaceXAIVideo), string(model.ChannelInterfaceNovitaVideo),
		string(model.ChannelInterfaceMiniMaxVideo), string(model.ChannelInterfaceNewAPIVideo),
		string(model.ChannelInterfaceNewAPIChannel1), string(model.ChannelInterfaceNewAPIChannel2),
		string(model.ChannelInterfaceVolcengineArkVideo), string(model.ChannelInterfaceVolcengineArkAgentPlanVideo),
		string(model.ChannelInterfaceDoubaoStreamingTTS):
		return true
	}
	// 按模型名猜素材策略只保留给没装插件的作者内置实现；
	// 装了声明式插件时由插件声明的 requiresPublicMediaUrls 决定（上面已有该分支）。
	if _, declarative := protocolAdapterForContext(ctx, input.Config.InterfaceType); declarative {
		return false
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
	// 这条只服务作者内置 RunningHub 实现；声明式插件的地址完全由插件声明的 baseUrl/create.path 决定。
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
		config.RequestFormat = string(s.declaredTextRequestFormat(config.InterfaceType))
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
	config.APIFormat = s.channelAPIFormatForProtocol(channel.APIFormat, channelModel.Protocol)
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
	config.RequestFormat = string(s.declaredTextRequestFormat(config.InterfaceType))
	return config, nil
}

// declaredTextRequestFormat 从已安装插件声明的 create 路径推出文字请求格式。
// 未安装插件（作者手写内置实现）返回空，由调用方保留作者原来的协议 ID 分支。
// 文字与 Agent 链路的格式判断统一走这里，不再散落协议名字比较。
func (s *Service) declaredTextRequestFormat(interfaceType string) protocol.TextWire {
	adapter, ok := s.protocolRegistry().Resolve(strings.TrimSpace(interfaceType))
	if !ok {
		return protocol.TextWireUnknown
	}
	return protocol.TextWireForCreatePath(adapter.Metadata().Create)
}

// channelAPIFormatForProtocol 以模型协议而不是客户端缓存决定鉴权和请求封装格式。
// 同一系统渠道可以挂载不同协议的模型，因此渠道级 APIFormat 只能作为协议缺失时的兼容值。
//
// 声明式插件先读插件声明的 auth.type；未装插件时才走作者内置协议判断。
func (s *Service) channelAPIFormatForProtocol(channelDefault string, protocol model.ChannelInterfaceType) string {
	if format, ok := declaredAuthAPIFormat(s.declaredProviderAuth(string(protocol))); ok {
		return format
	}
	return channelAPIFormatForProtocol(channelDefault, protocol)
}

// DeclaredProtocolOperations 描述插件为某个协议声明的操作（create/poll/cancel/result）。
// 系统代理的路径白名单改为读这份声明，不再只认作者内置协议名。
// 鉴权方式由 declaredProviderAuth 单独取，不在这里重复携带。
type DeclaredProtocolOperations struct {
	// Declared 为 false 表示没装该协议的插件，调用方保留作者内置分支。
	Declared bool
	// 各操作都是 "METHOD /path" 形式，模板段（{{taskId}} / {model}）按单段通配匹配。
	Create string
	Poll   string
	Cancel string
	Result string
}

// DeclaredProtocolOperations 返回已启用插件对该协议声明的操作路径与鉴权方式。
func (s *Service) DeclaredProtocolOperations(protocolID string) DeclaredProtocolOperations {
	protocolID = strings.TrimSpace(protocolID)
	if protocolID == "" {
		return DeclaredProtocolOperations{}
	}
	for _, plugin := range s.Plugins() {
		if plugin.Status != "enabled" {
			continue
		}
		for _, provider := range plugin.Manifest.Contributes.Providers {
			if strings.TrimSpace(provider.ID) != protocolID {
				continue
			}
			operations := DeclaredProtocolOperations{
				Declared: true,
				Create:   operationSummary(provider.Create),
			}
			if provider.Poll != nil {
				operations.Poll = operationSummary(*provider.Poll)
			}
			if provider.Cancel != nil {
				operations.Cancel = operationSummary(*provider.Cancel)
			}
			if provider.Result != nil {
				operations.Result = operationSummary(*provider.Result)
			}
			return operations
		}
	}
	return DeclaredProtocolOperations{}
}

// DeclaredOperationMatch 是声明操作匹配的唯一实现：返回命中的是否为 create 以及是否命中。
// 声明路径与请求路径比对前各去掉一层渠道版本前缀（前端发给系统代理的路径不带 /v1 等前缀）。
func DeclaredOperationMatch(operations DeclaredProtocolOperations, method string, requestPath string) (create bool, matched bool) {
	if !operations.Declared {
		return false, false
	}
	for _, entry := range []struct {
		summary  string
		isCreate bool
	}{
		{operations.Create, true},
		{operations.Poll, false},
		{operations.Cancel, false},
		{operations.Result, false},
	} {
		if declaredOperationMatches(entry.summary, method, requestPath) {
			return entry.isCreate, true
		}
	}
	return false, false
}

// DeclaredProxyOperationMatch 供系统代理使用：判定该协议是否为声明式插件、命中的是否为 create、是否命中。
// declared=false 表示没装该协议的插件，调用方保留作者原来的内置分支。
// handler 不再自己写一份路径匹配，统一走这里。
func (s *Service) DeclaredProxyOperationMatch(protocolID string, method string, requestPath string) (declared bool, create bool, matched bool) {
	operations := s.DeclaredProtocolOperations(protocolID)
	if !operations.Declared {
		return false, false, false
	}
	create, matched = DeclaredOperationMatch(operations, method, requestPath)
	return true, create, matched
}

func declaredOperationMatches(declared string, method string, requestPath string) bool {
	declaredMethod, declaredPath := splitDeclaredOperation(declared)
	if declaredPath == "" {
		return false
	}
	if method = strings.TrimSpace(method); method != "" && declaredMethod != "" && !strings.EqualFold(method, declaredMethod) {
		return false
	}
	return declaredPathMatches(declaredPath, requestPath)
}

func splitDeclaredOperation(declared string) (string, string) {
	declared = strings.TrimSpace(declared)
	if declared == "" {
		return "", ""
	}
	if index := strings.IndexAny(declared, " \t"); index >= 0 {
		return declared[:index], strings.TrimSpace(declared[index+1:])
	}
	return "", declared
}

func declaredPathMatches(declared string, requestPath string) bool {
	declared = strings.TrimSpace(declared)
	if declared == "" {
		return false
	}
	if _, path := splitDeclaredOperation(declared); path != "" {
		declared = path
	}
	if index := strings.IndexAny(declared, "?#"); index >= 0 {
		declared = declared[:index]
	}
	requestPath = strings.TrimSpace(requestPath)
	if index := strings.IndexAny(requestPath, "?#"); index >= 0 {
		requestPath = requestPath[:index]
	}
	// 系统代理收到的路径不带版本前缀，插件声明的路径通常带，比对前各自去一层前缀。
	declared = TrimChannelAPIVersionPrefix(declared)
	requestPath = TrimChannelAPIVersionPrefix(requestPath)
	declaredSegments := strings.Split(strings.Trim(declared, "/"), "/")
	requestSegments := strings.Split(strings.Trim(requestPath, "/"), "/")
	if len(declaredSegments) != len(requestSegments) {
		return false
	}
	for index, segment := range declaredSegments {
		if strings.ContainsAny(segment, "{}") {
			if requestSegments[index] == "" {
				return false
			}
			continue
		}
		if segment != requestSegments[index] {
			return false
		}
	}
	return true
}

// SystemChannelDeclaredOperationProtocol 在请求不带 model 时按插件声明的
// poll/cancel/result 路径判定渠道协议（不只看 MiniMax 视频这一个内置协议）。
func (s *Service) SystemChannelDeclaredOperationProtocol(channelID string, requestPath string) (model.ChannelInterfaceType, string, bool) {
	items, err := s.repo.ChannelModels(channelID, false)
	if err != nil {
		return "", "", false
	}
	for _, item := range items {
		if !item.Enabled || item.Protocol == "" {
			continue
		}
		operations := s.DeclaredProtocolOperations(string(item.Protocol))
		if !operations.Declared {
			continue
		}
		for _, declared := range []string{operations.Poll, operations.Cancel, operations.Result} {
			if declaredPathMatches(declared, requestPath) {
				return item.Protocol, item.Capability, true
			}
		}
	}
	return "", "", false
}

// ProtocolRequestsChatStreamUsage 判定该协议的流式请求是否要用 stream_options.include_usage 索取用量。
// 改看插件声明的 create 路径，token 计费的文字模型才能拿到用量。
func (s *Service) ProtocolRequestsChatStreamUsage(protocolID string) bool {
	return s.declaredTextRequestFormat(protocolID) == protocol.TextWireChatCompletion
}

// declaredProviderAuth 返回已安装插件为该协议声明的鉴权方式。
// needsSecondCredential 判定该协议是否必需第二凭证：插件声明了 auth.secretField 就要，
// 未装插件时保留作者内置的即梦协议判断。
func (s *Service) needsSecondCredential(interfaceType string) bool {
	if auth, ok := s.declaredProviderAuth(interfaceType); ok {
		return strings.TrimSpace(auth.SecretField) != ""
	}
	return isVolcengineJiMengProtocol(interfaceType)
}
func (s *Service) declaredProviderAuth(protocolID string) (protocol.ManifestAuth, bool) {
	protocolID = strings.TrimSpace(protocolID)
	if protocolID == "" {
		return protocol.ManifestAuth{}, false
	}
	for _, plugin := range s.Plugins() {
		if plugin.Status != "enabled" {
			continue
		}
		for _, provider := range plugin.Manifest.Contributes.Providers {
			if strings.TrimSpace(provider.ID) == protocolID {
				return provider.Auth, true
			}
		}
	}
	return protocol.ManifestAuth{}, false
}

// declaredAuthAPIFormat 把插件声明的鉴权方式折成宿主的上游封装格式（openai / gemini / claude）。
func declaredAuthAPIFormat(auth protocol.ManifestAuth, declared bool) (string, bool) {
	if !declared {
		return "", false
	}
	switch strings.ToLower(strings.TrimSpace(auth.Type)) {
	case "google-api-key", "gemini":
		return "gemini", true
	case "anthropic":
		return "claude", true
	case "":
		return "", false
	default:
		return "openai", true
	}
}

// channelAPIFormatForProtocol 是未装插件时的内置实现：按作者内置协议名决定封装格式。
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
