package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

type canvasGenerationInput struct {
	Mode            string                 `json:"mode"`
	Prompt          string                 `json:"prompt"`
	Config          providerConfig         `json:"config"`
	ReferenceImages []providerMedia        `json:"referenceImages"`
	ReferenceVideos []providerMedia        `json:"referenceVideos"`
	ReferenceAudios []providerMedia        `json:"referenceAudios"`
	Mask            *providerMedia         `json:"mask"`
	Metadata        map[string]interface{} `json:"metadata"`
	VideoCapability *VideoCapabilityConfig `json:"-"`
}

type providerConfig struct {
	ChannelID             string                 `json:"channelId"`
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
	AudioVoice            string                 `json:"audioVoice"`
	AudioFormat           string                 `json:"audioFormat"`
	AudioSpeed            string                 `json:"audioSpeed"`
	AudioInstructions     string                 `json:"audioInstructions"`
	SystemPrompt          string                 `json:"systemPrompt"`
	CapabilityConfig      *ModelCapabilityConfig `json:"capabilityConfig"`
}

const providerHTTPTimeout = 5 * time.Minute
const videoPollTimeout = 30 * time.Minute
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

type providerHTTPError struct {
	StatusCode int
	Status     string
	Body       string
}

type providerAnalyticsKey struct{}

type providerAnalyticsContext struct {
	Service           *Service
	UserID            string
	TaskID            string
	BillingOrderID    string
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
	metadata := providerAnalyticsContext{Service: service, UserID: task.UserID, TaskID: task.ID, BillingOrderID: task.BillingOrderID, Capability: capabilityFromTaskType(task.Type), Operation: task.Operation, Model: task.Model, ProviderRequestID: task.ProviderRequestID}
	var input struct {
		Mode   string         `json:"mode"`
		Config providerConfig `json:"config"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) == nil {
		metadata.ChannelID = firstNonEmpty(input.Config.ChannelID, systemChannelIDFromBaseURL(input.Config.BaseURL))
		metadata.Model = firstNonEmpty(input.Config.Model, metadata.Model)
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
	if e.StatusCode == 524 {
		return "上游网关超时（524）：模型请求可能仍在服务端执行并产生费用，请勿立即重试，请先到供应商后台核对任务或账单"
	}
	return fmt.Sprintf("接口请求失败：%s %s", e.Status, e.Body)
}

func (s *Service) processCanvasGenerationTask(ctx context.Context, userID string, taskType string, fallbackPrompt string, rawInput string) (map[string]interface{}, error) {
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(rawInput), &input); err != nil {
		return nil, fmt.Errorf("任务输入解析失败：%w", err)
	}
	if strings.TrimSpace(input.Prompt) == "" {
		input.Prompt = fallbackPrompt
	}
	promptTemplateOperation := metadataString(input.Metadata, "promptTemplateOperation")
	if promptTemplateOperation != "" {
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
	if input.Mode == "" && strings.HasPrefix(taskType, "video_") {
		input.Mode = "video"
	}
	config, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return nil, err
	}
	input.Config = config
	if input.Config.APIFormat == "gemini" && input.Config.InterfaceType != string(model.ChannelInterfaceGeminiVeo) {
		return nil, errors.New("后端任务队列暂不支持 Gemini 调用格式，请使用 OpenAI 兼容渠道")
	}
	if strings.TrimSpace(input.Config.BaseURL) == "" || strings.TrimSpace(input.Config.APIKey) == "" || strings.TrimSpace(input.Config.Model) == "" {
		return nil, errors.New("后端生成任务缺少 Base URL、API Key 或模型名")
	}
	if err := validateGenerationInterface(input.Mode, input.Config.InterfaceType); err != nil {
		return nil, err
	}
	if isVolcengineJiMengProtocol(input.Config.InterfaceType) && strings.TrimSpace(input.Config.SecretKey) == "" {
		return nil, errors.New("即梦官方 API 缺少 Secret Key")
	}
	if input.Mode == "video" {
		if err := s.validateResolvedVideoCapability(&input); err != nil {
			return nil, err
		}
	}
	if resumedProviderRequestID(ctx) == "" {
		requirePublicURL := input.Config.InterfaceType == "newapi-channel-1" || input.Config.InterfaceType == "newapi-channel-2" || input.Config.InterfaceType == string(model.ChannelInterfaceVolcengineArkVideo)
		if err := s.hydrateGenerationMedia(userID, &input, requirePublicURL); err != nil {
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

func (s *Service) validateResolvedVideoCapability(input *canvasGenerationInput) error {
	channelID := strings.TrimSpace(input.Config.ChannelID)
	if channelID == "" {
		if input.Config.CapabilityConfig == nil || input.Config.CapabilityConfig.Video == nil {
			return nil
		}
		input.VideoCapability = input.Config.CapabilityConfig.Video
		return validateVideoTask(input.VideoCapability, *input)
	}
	item, err := s.repo.ChannelModelByKey(channelID, strings.TrimPrefix(strings.TrimSpace(input.Config.Model), "models/"))
	if err != nil {
		return errors.New("当前系统渠道模型未配置或已停用")
	}
	profile, err := DecodeModelCapabilityConfig(item.CapabilityConfigJSON)
	if err != nil || profile == nil || profile.Video == nil {
		return errors.New("当前视频模型尚未配置能力参数")
	}
	input.VideoCapability = profile.Video
	return validateVideoTask(profile.Video, *input)
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

func (s *Service) hydrateGenerationMedia(userID string, input *canvasGenerationInput, requirePublicURL bool) error {
	groups := [][]providerMedia{input.ReferenceImages, input.ReferenceVideos, input.ReferenceAudios}
	for _, group := range groups {
		for index := range group {
			if err := s.hydrateProviderMedia(userID, &group[index], requirePublicURL); err != nil {
				return err
			}
		}
	}
	if input.Mask != nil {
		return s.hydrateProviderMedia(userID, input.Mask, requirePublicURL)
	}
	return nil
}

func (s *Service) hydrateProviderMedia(userID string, media *providerMedia, requirePublicURL bool) error {
	if !strings.HasPrefix(media.StorageKey, "resource:") {
		if requirePublicURL && strings.HasPrefix(strings.TrimSpace(media.DataURL), "data:") {
			return errors.New("当前 JSON 视频协议的参考素材不能使用内嵌数据，请先上传到 OSS 或提供公网素材地址")
		}
		return nil
	}
	resourceID := strings.TrimPrefix(media.StorageKey, "resource:")
	if requirePublicURL {
		resource, err := s.repo.ResourceForUser(userID, resourceID)
		if err != nil {
			return fmt.Errorf("读取任务参考资源失败：%w", err)
		}
		if resource.Status != "ready" {
			return errors.New("任务参考资源尚未上传完成")
		}
		signedURL, err := s.directResourceURL(resource, time.Now().Add(providerResourceURLTTL))
		if err != nil {
			return fmt.Errorf("生成 JSON 视频协议参考素材地址失败：%w", err)
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
	if strings.HasPrefix(strings.TrimSpace(media.DataURL), "data:") {
		return nil
	}
	resource, body, err := s.OpenResource(userID, resourceID)
	if err != nil {
		return fmt.Errorf("读取任务参考资源失败：%w", err)
	}
	defer body.Close()
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	resourceLimit := megabytes(policy.Resource.ResourceUploadMB)
	data, err := io.ReadAll(io.LimitReader(body, resourceLimit+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > resourceLimit {
		return fmt.Errorf("任务参考资源超过 %dMB", policy.Resource.ResourceUploadMB)
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
	channel, err := s.repo.SystemChannel(channelID)
	if err != nil {
		return providerConfig{}, errors.New("系统渠道不存在或已停用")
	}
	modelName := strings.TrimSpace(config.Model)
	if modelName == "" {
		models := channelModelNames(*channel)
		if len(models) == 0 {
			return providerConfig{}, errors.New("系统渠道未配置可用模型")
		}
		modelName = models[0]
	}
	if !stringInSlice(modelName, channelModelNames(*channel)) {
		return providerConfig{}, errors.New("当前系统渠道未授权该模型")
	}
	config.ChannelID = channel.ID
	config.APIFormat = channel.APIFormat
	channelModel, modelErr := s.repo.ChannelModelByKey(channel.ID, modelName)
	if modelErr != nil || channelModel.Protocol == "" {
		return providerConfig{}, errors.New("当前模型尚未配置请求协议")
	}
	config.InterfaceType = string(channelModel.Protocol)
	// 模型协议是实际请求契约；混合渠道中鉴权格式也必须随模型协议切换。
	if config.InterfaceType == string(model.ChannelInterfaceGeminiVeo) {
		config.APIFormat = "gemini"
	} else if config.InterfaceType != "" {
		config.APIFormat = "openai"
	}
	config.BaseURL = channel.BaseURL
	config.APIKey = channel.APIKey
	config.SecretKey = channel.SecretKey
	config.Headers, err = ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return providerConfig{}, err
	}
	config.Model = modelName
	return config, nil
}

func stringInSlice(value string, values []string) bool {
	value = strings.TrimPrefix(strings.TrimSpace(value), "models/")
	for _, candidate := range values {
		if strings.TrimPrefix(strings.TrimSpace(candidate), "models/") == value {
			return true
		}
	}
	return false
}

func systemChannelIDFromBaseURL(baseURL string) string {
	value := strings.TrimSpace(baseURL)
	for _, marker := range []string{"/api/ai/system/", "api/ai/system/"} {
		index := strings.Index(value, marker)
		if index < 0 {
			continue
		}
		id := strings.Trim(value[index+len(marker):], "/")
		if slash := strings.Index(id, "/"); slash >= 0 {
			id = id[:slash]
		}
		return strings.TrimSpace(id)
	}
	return ""
}

func runImageTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if input.Config.InterfaceType == string(model.ChannelInterfaceVolcengineJiMengImage) {
		return runVolcengineJiMengImageTask(ctx, input)
	}
	if input.Config.InterfaceType == string(model.ChannelInterfaceVolcengineArkImage) {
		return runVolcengineArkImageTask(ctx, input)
	}
	var payload imageResponse
	if input.Mask != nil {
		// 蒙版编辑是强校验写路径：协议能力不明确时必须失败，不能静默退化为整图重绘。
		if strings.TrimSpace(input.Config.InterfaceType) != string(model.ChannelInterfaceOpenAIImage) {
			return nil, errors.New("当前渠道未声明 OpenAI Images 编辑协议，已拒绝可能忽略蒙版的整图重绘")
		}
		if len(input.ReferenceImages) == 0 {
			return nil, errors.New("蒙版编辑必须提供与蒙版同尺寸的源图片")
		}
	}
	if len(input.ReferenceImages) > 0 || input.Mask != nil {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		writeField(writer, "model", input.Config.Model)
		writeField(writer, "prompt", withSystemPrompt(input.Config, input.Prompt))
		writeField(writer, "n", "1")
		writeField(writer, "response_format", "b64_json")
		writeField(writer, "output_format", "png")
		if input.Config.TransparentBackground == "true" {
			writeField(writer, "background", "transparent")
		}
		if input.Config.Quality != "" {
			writeField(writer, "quality", normalizeImageQuality(input.Config.Quality))
		}
		if size := normalizePixelSize(input.Config.Size); size != "" {
			writeField(writer, "size", size)
		}
		for _, image := range input.ReferenceImages {
			if err := writeMediaPart(writer, "image", image); err != nil {
				return nil, err
			}
		}
		if input.Mask != nil {
			if err := writeMediaPart(writer, "mask", *input.Mask); err != nil {
				return nil, err
			}
		}
		if err := writer.Close(); err != nil {
			return nil, err
		}
		if err := postForm(ctx, input.Config, "/images/edits", writer.FormDataContentType(), body, &payload); err != nil {
			return nil, err
		}
	} else {
		body := map[string]interface{}{
			"model":           input.Config.Model,
			"prompt":          withSystemPrompt(input.Config, input.Prompt),
			"n":               1,
			"response_format": "b64_json",
			"output_format":   "png",
		}
		if input.Config.TransparentBackground == "true" {
			body["background"] = "transparent"
		}
		if input.Config.Quality != "" {
			body["quality"] = normalizeImageQuality(input.Config.Quality)
		}
		if size := normalizePixelSize(input.Config.Size); size != "" {
			body["size"] = size
		}
		if err := postJSON(ctx, input.Config, "/images/generations", body, &payload); err != nil {
			return nil, err
		}
	}
	images, err := imageDataURLs(payload)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"mode": "image", "images": images}, nil
}

const volcengineArkImageMaxPixels = 4624220

func runVolcengineArkImageTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if input.Mask != nil {
		return nil, errors.New("火山方舟图片协议不支持蒙版编辑，请移除蒙版后重试")
	}
	body, err := volcengineArkImageBody(input)
	if err != nil {
		return nil, err
	}
	var payload imageResponse
	if err := postJSON(ctx, input.Config, "/images/generations", body, &payload); err != nil {
		return nil, err
	}
	images, err := imageDataURLs(payload)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"mode": "image", "images": images}, nil
}

func volcengineArkImageBody(input canvasGenerationInput) (map[string]interface{}, error) {
	body := map[string]interface{}{
		"model":  input.Config.Model,
		"prompt": withSystemPrompt(input.Config, input.Prompt),
		"n":      1,
	}
	if size := normalizeVolcengineArkImageSize(input.Config.Size); size != "" {
		body["size"] = size
	}
	if len(input.ReferenceImages) == 0 {
		return body, nil
	}
	images := make([]string, 0, len(input.ReferenceImages))
	for _, image := range input.ReferenceImages {
		url, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		images = append(images, url)
	}
	if len(images) == 1 {
		body["image"] = images[0]
	} else {
		body["image"] = images
	}
	return body, nil
}

func normalizeVolcengineArkImageSize(value string) string {
	size := normalizePixelSize(value)
	parts := strings.Split(strings.ToLower(size), "x")
	if len(parts) != 2 {
		return size
	}
	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return size
	}
	if int64(width)*int64(height) <= volcengineArkImageMaxPixels {
		return size
	}
	scale := math.Sqrt(float64(volcengineArkImageMaxPixels) / (float64(width) * float64(height)))
	width = int(math.Floor(float64(width)*scale/2)) * 2
	height = int(math.Floor(float64(height)*scale/2)) * 2
	for width > 2 && height > 2 && int64(width)*int64(height) > volcengineArkImageMaxPixels {
		if width >= height {
			width -= 2
		} else {
			height -= 2
		}
	}
	return strconv.Itoa(width) + "x" + strconv.Itoa(height)
}

func runTextTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	switch input.Config.InterfaceType {
	case "chat-completion":
		return runChatCompletionsTextTask(ctx, input)
	case "openai-response":
		return runResponsesTextTask(ctx, input)
	}
	return runLegacyTextTask(ctx, input)
}

func runLegacyTextTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	var payload map[string]interface{}
	responseInput, err := textResponseInput(input)
	if err != nil {
		return nil, err
	}
	body := map[string]interface{}{"model": input.Config.Model, "input": responseInput}
	if err := postJSON(ctx, input.Config, "/responses", body, &payload); err != nil {
		if !shouldFallbackTextToChat(err) {
			return nil, err
		}
		result, chatErr := runChatCompletionsTextTask(ctx, input)
		if chatErr == nil {
			return result, nil
		}
		return nil, fmt.Errorf("文本接口请求失败：Responses API %v；Chat Completions %v", err, chatErr)
	}
	text := stringField(payload, "output_text")
	if text == "" {
		text = extractResponseText(payload)
	}
	if text == "" {
		return nil, errors.New("文本接口没有返回内容")
	}
	return map[string]interface{}{"mode": "text", "text": text}, nil
}

func runResponsesTextTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	var payload map[string]interface{}
	responseInput, err := textResponseInput(input)
	if err != nil {
		return nil, err
	}
	if err := postJSON(ctx, input.Config, "/responses", map[string]interface{}{"model": input.Config.Model, "input": responseInput}, &payload); err != nil {
		return nil, err
	}
	text := stringField(payload, "output_text")
	if text == "" {
		text = extractResponseText(payload)
	}
	if text == "" {
		return nil, errors.New("文本接口没有返回内容")
	}
	return map[string]interface{}{"mode": "text", "text": text}, nil
}

func runChatCompletionsTextTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	var payload map[string]interface{}
	messages := []map[string]interface{}{}
	if systemPrompt := strings.TrimSpace(input.Config.SystemPrompt); systemPrompt != "" {
		messages = append(messages, map[string]interface{}{"role": "system", "content": systemPrompt})
	}
	userContent, err := textChatContent(input)
	if err != nil {
		return nil, err
	}
	messages = append(messages, map[string]interface{}{"role": "user", "content": userContent})
	body := map[string]interface{}{"model": input.Config.Model, "messages": messages}
	if err := postJSON(ctx, input.Config, "/chat/completions", body, &payload); err != nil {
		return nil, err
	}
	text := extractChatCompletionText(payload)
	if text == "" {
		return nil, errors.New("文本接口没有返回内容")
	}
	return map[string]interface{}{"mode": "text", "text": text}, nil
}

func textResponseInput(input canvasGenerationInput) (interface{}, error) {
	systemPrompt := strings.TrimSpace(input.Config.SystemPrompt)
	if len(input.ReferenceImages) == 0 && len(input.ReferenceVideos) == 0 {
		return withSystemPrompt(input.Config, input.Prompt), nil
	}
	messages := make([]map[string]interface{}, 0, 2)
	if systemPrompt != "" {
		messages = append(messages, map[string]interface{}{"role": "system", "content": systemPrompt})
	}
	content, err := textResponseContent(input)
	if err != nil {
		return nil, err
	}
	messages = append(messages, map[string]interface{}{"role": "user", "content": content})
	return messages, nil
}

func textResponseContent(input canvasGenerationInput) ([]map[string]interface{}, error) {
	content := []map[string]interface{}{{"type": "input_text", "text": input.Prompt}}
	for _, image := range input.ReferenceImages {
		url, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"type": "input_image", "image_url": url})
	}
	for _, video := range input.ReferenceVideos {
		url, err := openAIVideoInputURL(video)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"type": "input_video", "video_url": url})
	}
	return content, nil
}

func textChatContent(input canvasGenerationInput) (interface{}, error) {
	if len(input.ReferenceImages) == 0 && len(input.ReferenceVideos) == 0 {
		return input.Prompt, nil
	}
	content := []map[string]interface{}{{"type": "text", "text": input.Prompt}}
	for _, image := range input.ReferenceImages {
		url, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"type": "image_url", "image_url": map[string]interface{}{"url": url}})
	}
	for _, video := range input.ReferenceVideos {
		url, err := openAIVideoInputURL(video)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"type": "video_url", "video_url": map[string]interface{}{"url": url}})
	}
	return content, nil
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

func shouldFallbackTextToChat(err error) bool {
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) {
		return false
	}
	switch httpErr.StatusCode {
	case http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusNotImplemented, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

func runAudioTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if resolved, ok := input.Metadata["resolvedCharacterVersions"].([]interface{}); ok && len(resolved) > 0 {
		voiceKey := metadataString(input.Metadata, "resolvedCharacterVoiceKey")
		if voiceKey == "" || strings.TrimSpace(input.Config.AudioVoice) != voiceKey {
			return nil, errors.New("角色配音缺少已解析的声音绑定")
		}
	}
	format := defaultString(input.Config.AudioFormat, "mp3")
	body := map[string]interface{}{
		"model":           input.Config.Model,
		"input":           input.Prompt,
		"voice":           defaultString(input.Config.AudioVoice, "alloy"),
		"response_format": format,
		"speed":           1,
	}
	if input.Config.AudioSpeed != "" {
		body["speed"] = parseFloat(input.Config.AudioSpeed, 1)
	}
	if input.Config.AudioInstructions != "" {
		body["instructions"] = input.Config.AudioInstructions
	}
	if input.Config.InterfaceType == string(model.ChannelInterfaceAsyncAudio) {
		return runAsyncAudioTask(ctx, input, body, format)
	}
	data, mimeType, err := postBinary(ctx, input.Config, "/audio/speech", body)
	if err != nil {
		return nil, err
	}
	mimeType, err = validateGeneratedAudio(mimeType, data, format)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"mode": "audio", "audio": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType, "format": format}}, nil
}

func runAsyncAudioTask(ctx context.Context, input canvasGenerationInput, body map[string]interface{}, format string) (map[string]interface{}, error) {
	id := resumedProviderRequestID(ctx)
	var state map[string]interface{}
	if id == "" {
		if err := postJSON(ctx, input.Config, "/audio/tasks", body, &state); err != nil {
			return nil, err
		}
		state = asyncAudioPayload(state)
		id = firstNonEmptyString(stringField(state, "id"), stringField(state, "task_id"), stringField(state, "request_id"))
		if id == "" {
			return nil, errors.New("异步音频接口没有返回任务 ID")
		}
		if asyncAudioSucceeded(state) {
			return asyncAudioResult(ctx, input.Config, id, state, format)
		}
	}
	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		state = map[string]interface{}{}
		pollCtx := withProviderRequestKind(ctx, "poll")
		if err := getJSON(pollCtx, input.Config, "/audio/tasks/"+url.PathEscape(id), &state); err != nil {
			return nil, err
		}
		state = asyncAudioPayload(state)
		if asyncAudioSucceeded(state) {
			return asyncAudioResult(ctx, input.Config, id, state, format)
		}
		status := strings.ToLower(strings.TrimSpace(stringField(state, "status")))
		if status == "failed" || status == "cancelled" || status == "canceled" || status == "expired" || status == "error" {
			return nil, fmt.Errorf("异步音频生成失败（任务 %s）：%s", id, asyncAudioErrorMessage(state))
		}
		if err := sleepContext(ctx, 2500*time.Millisecond); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("异步音频生成超时（任务 %s）", id)
}

func asyncAudioPayload(payload map[string]interface{}) map[string]interface{} {
	for _, key := range []string{"data", "result", "output"} {
		if nested, ok := payload[key].(map[string]interface{}); ok {
			for parentKey, parentValue := range payload {
				if parentKey == "data" || parentKey == "result" || parentKey == "output" {
					continue
				}
				if _, exists := nested[parentKey]; !exists {
					nested[parentKey] = parentValue
				}
			}
			return nested
		}
	}
	return payload
}

func asyncAudioSucceeded(state map[string]interface{}) bool {
	status := strings.ToLower(strings.TrimSpace(stringField(state, "status")))
	done, _ := state["done"].(bool)
	return done || status == "completed" || status == "succeeded" || status == "success" || status == "done" || (status == "" && asyncAudioResultURL(state) != "")
}

func asyncAudioResult(ctx context.Context, config providerConfig, id string, state map[string]interface{}, format string) (map[string]interface{}, error) {
	resultURL := asyncAudioResultURL(state)
	var data []byte
	var mimeType string
	var err error
	if strings.HasPrefix(resultURL, "data:") {
		mimeType, data, err = decodeProviderDataURL(resultURL)
		if err == nil {
			limit, limitErr := providerGeneratedFileLimit(ctx)
			if limitErr != nil {
				err = limitErr
			} else if int64(len(data)) > limit {
				err = fmt.Errorf("异步音频结果超过 %s 限制", formatStorageLimit(limit))
			}
		}
	} else if isPublicMediaURL(resultURL) {
		data, mimeType, err = getExternalBinary(withProviderRequestKind(ctx, "download"), resultURL)
	} else {
		data, mimeType, err = getBinary(withProviderRequestKind(ctx, "download"), config, "/audio/tasks/"+url.PathEscape(id)+"/content")
	}
	if err != nil {
		return nil, fmt.Errorf("异步音频结果下载失败（任务 %s）：%w", id, err)
	}
	mimeType, err = validateGeneratedAudio(mimeType, data, format)
	if err != nil {
		return nil, fmt.Errorf("异步音频结果无效（任务 %s）：%w", id, err)
	}
	return map[string]interface{}{"mode": "audio", "audio": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType, "format": format}}, nil
}

func asyncAudioResultURL(state map[string]interface{}) string {
	for _, key := range []string{"audio_url", "audioUrl", "result_url", "resultUrl", "output_url", "outputUrl", "url", "data"} {
		if value := strings.TrimSpace(stringField(state, key)); strings.HasPrefix(value, "data:") || isPublicMediaURL(value) {
			return value
		}
	}
	for _, key := range []string{"audio", "data", "result", "output"} {
		if nested, ok := state[key].(map[string]interface{}); ok {
			if value := asyncAudioResultURL(nested); value != "" {
				return value
			}
		}
	}
	return ""
}

func asyncAudioErrorMessage(state map[string]interface{}) string {
	_, message := providerFailureDetails(state)
	return defaultString(message, firstNonEmptyString(stringField(state, "message"), "上游返回失败状态"))
}

func decodeProviderDataURL(value string) (string, []byte, error) {
	header, encoded, ok := strings.Cut(value, ",")
	if !ok || !strings.HasPrefix(header, "data:") || !strings.HasSuffix(strings.ToLower(header), ";base64") {
		return "", nil, errors.New("音频 data URL 格式无效")
	}
	mimeType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	data, err := base64.StdEncoding.DecodeString(encoded)
	return mimeType, data, err
}

func providerGeneratedFileLimit(ctx context.Context) (int64, error) {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Service == nil {
		return maxProviderResponseBytes, nil
	}
	policy, err := metadata.Service.RuntimePolicy()
	if err != nil {
		return 0, fmt.Errorf("读取生成资源限制失败：%w", err)
	}
	return megabytes(policy.Resource.GeneratedFileMB), nil
}

func validateGeneratedAudio(declared string, data []byte, format string) (string, error) {
	if len(data) == 0 {
		return "", errors.New("音频内容为空")
	}
	detected := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0]))
	if strings.Contains(detected, "json") || strings.HasPrefix(detected, "text/") || strings.HasPrefix(detected, "image/") || strings.HasPrefix(detected, "video/") {
		return "", fmt.Errorf("上游返回了非音频内容：%s", detected)
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(declared, ";")[0]))
	resolved := ""
	if strings.HasPrefix(mimeType, "audio/") {
		resolved = mimeType
	} else if strings.HasPrefix(detected, "audio/") {
		resolved = detected
	} else if fallback := audioFormatMimeType(format); fallback != "" && (mimeType == "" || mimeType == "application/octet-stream") {
		resolved = fallback
	}
	if resolved == "" {
		return "", fmt.Errorf("上游响应类型不是音频：%s", defaultString(mimeType, detected))
	}
	if !audioSignatureMatches(resolved, data) {
		return "", fmt.Errorf("音频内容与格式不匹配：%s", resolved)
	}
	return resolved, nil
}

func audioSignatureMatches(mimeType string, data []byte) bool {
	if strings.Contains(mimeType, "pcm") || mimeType == "audio/l16" {
		return len(data) > 0
	}
	if strings.Contains(mimeType, "mpeg") || strings.Contains(mimeType, "mp3") {
		return bytes.HasPrefix(data, []byte("ID3")) || (len(data) >= 2 && data[0] == 0xff && data[1]&0xe0 == 0xe0)
	}
	if strings.Contains(mimeType, "wav") || strings.Contains(mimeType, "wave") {
		return len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WAVE"))
	}
	if strings.Contains(mimeType, "opus") || strings.Contains(mimeType, "ogg") {
		return bytes.HasPrefix(data, []byte("OggS"))
	}
	if strings.Contains(mimeType, "flac") {
		return bytes.HasPrefix(data, []byte("fLaC"))
	}
	if strings.Contains(mimeType, "aac") {
		return bytes.HasPrefix(data, []byte("ADIF")) || (len(data) >= 2 && data[0] == 0xff && data[1]&0xf0 == 0xf0)
	}
	return false
}

func audioFormatMimeType(format string) string {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "wav":
		return "audio/wav"
	case "opus":
		return "audio/opus"
	case "aac":
		return "audio/aac"
	case "flac":
		return "audio/flac"
	case "pcm":
		return "audio/pcm"
	case "mp3":
		return "audio/mpeg"
	default:
		return ""
	}
}

func runVideoTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if input.Config.InterfaceType == string(model.ChannelInterfaceVolcengineJiMengVideo) {
		return runVolcengineJiMengVideoTask(ctx, input)
	}
	if input.Config.InterfaceType == "gemini-veo" {
		return runGeminiVeoVideoTask(ctx, input)
	}
	if input.Config.InterfaceType == "newapi-channel-2" {
		return runNewAPIChannel2VideoTask(ctx, input)
	}
	if input.Config.InterfaceType == "newapi-channel-1" {
		return runNewAPIChannel1VideoTask(ctx, input)
	}
	if input.Config.InterfaceType == string(model.ChannelInterfaceVolcengineArkVideo) {
		return runSeedanceAgentPlanVideoTask(ctx, input)
	}
	if isArkPlanVideoConfig(input.Config) {
		return runSeedanceAgentPlanVideoTask(ctx, input)
	}
	if isSeedanceVideoConfig(input.Config) {
		return runSeedanceVideosTask(ctx, input)
	}
	if len(input.ReferenceVideos) > 0 || len(input.ReferenceAudios) > 0 {
		return nil, errors.New("OpenAI 风格视频接口不支持参考视频或参考音频，请切换到 Seedance / Agent Plan 渠道")
	}
	id := resumedProviderRequestID(ctx)
	var created map[string]interface{}
	if id == "" && (input.Config.InterfaceType == "xai-video" || isGrokVideoConfig(input.Config)) {
		requestBody, err := grokVideoBody(input)
		if err != nil {
			return nil, err
		}
		createPath := "/videos"
		if input.Config.InterfaceType == "xai-video" {
			createPath = "/videos/generations"
		}
		if err := postJSON(ctx, input.Config, createPath, requestBody, &created); err != nil {
			return nil, err
		}
	} else if id == "" {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		writeField(writer, "model", input.Config.Model)
		writeField(writer, "prompt", newAPIVideoPromptText(input))
		writeField(writer, "seconds", defaultString(input.Config.VideoSeconds, "6"))
		if size := normalizeVideoSize(input.Config.Size); size != "" {
			writeField(writer, "size", size)
		}
		writeField(writer, "resolution_name", normalizeVideoResolution(input.Config.VQuality))
		writeField(writer, "preset", "normal")
		if shouldSendNewAPIVideoImages(input) {
			for _, image := range input.ReferenceImages {
				if err := writeMediaPart(writer, "input_reference[]", image); err != nil {
					return nil, err
				}
			}
		}
		if err := writer.Close(); err != nil {
			return nil, err
		}
		if err := postForm(ctx, input.Config, "/videos", writer.FormDataContentType(), body, &created); err != nil {
			return nil, err
		}
	}
	if id == "" {
		id = firstNonEmptyString(stringField(created, "id"), stringField(created, "request_id"), stringField(created, "task_id"))
	}
	if id == "" {
		if data, ok := created["data"].(map[string]interface{}); ok {
			id = firstNonEmptyString(stringField(data, "id"), stringField(data, "request_id"), stringField(data, "task_id"))
		}
	}
	if id == "" {
		return nil, errors.New("视频接口没有返回任务 ID")
	}
	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		var state map[string]interface{}
		if err := getJSON(ctx, input.Config, "/videos/"+id, &state); err != nil {
			return nil, err
		}
		if data, ok := state["data"].(map[string]interface{}); ok {
			state = data
		}
		status := strings.ToLower(stringField(state, "status"))
		if status == "completed" || status == "succeeded" || status == "success" || status == "done" {
			if videoURL := newAPIVideoResultURL(state); videoURL != "" {
				data, mimeType, err := getProviderExternalBinary(withProviderRequestKind(ctx, "download"), input.Config, videoURL)
				if err != nil {
					return nil, fmt.Errorf("视频结果下载失败（任务 %s）：%w", id, err)
				}
				mimeType = normalizedMediaMimeType(mimeType, data)
				return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
			}
			data, mimeType, err := getBinary(ctx, input.Config, "/videos/"+id+"/content")
			if err != nil {
				return nil, err
			}
			return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
		}
		if status == "failed" || status == "cancelled" {
			return nil, errors.New("视频生成失败")
		}
		if err := sleepContext(ctx, 2500*time.Millisecond); err != nil {
			return nil, err
		}
	}
	return nil, errors.New("视频生成超时")
}

func runGeminiVeoVideoTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if len(input.ReferenceImages) > 1 || len(input.ReferenceVideos) > 0 || len(input.ReferenceAudios) > 0 {
		return nil, errors.New("Gemini Veo 当前只支持 1 张起始图，不支持参考视频或音频")
	}
	id := resumedProviderRequestID(ctx)
	if id == "" {
		instance := map[string]interface{}{"prompt": strings.TrimSpace(input.Prompt)}
		if len(input.ReferenceImages) == 1 {
			raw, mimeType, err := mediaBytes(input.ReferenceImages[0])
			if err != nil {
				return nil, fmt.Errorf("读取 Gemini Veo 起始图失败：%w", err)
			}
			instance["image"] = map[string]interface{}{"bytesBase64Encoded": base64.StdEncoding.EncodeToString(raw), "mimeType": mimeType}
		}
		body := map[string]interface{}{
			"instances": []interface{}{instance},
			"parameters": map[string]interface{}{
				"aspectRatio":     normalizeNewAPIChannel2Ratio(input.Config.Size, strings.ToLower(input.Config.Model)),
				"durationSeconds": normalizeSeedanceVideosDuration(input.Config.VideoSeconds),
				"resolution":      normalizeNewAPIChannel2Resolution(input.Config.VQuality, strings.ToLower(input.Config.Model)),
				"sampleCount":     1,
			},
		}
		var created map[string]interface{}
		if err := postGeminiJSON(ctx, input.Config, "/models/"+url.PathEscape(input.Config.Model)+":predictLongRunning", body, &created); err != nil {
			return nil, err
		}
		id = strings.TrimSpace(stringField(created, "name"))
	}
	if id == "" {
		return nil, errors.New("Gemini Veo 没有返回 operation name")
	}
	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		var operation map[string]interface{}
		if err := getGeminiJSON(ctx, input.Config, "/"+strings.TrimLeft(id, "/"), &operation); err != nil {
			return nil, err
		}
		if errorValue, ok := operation["error"].(map[string]interface{}); ok && stringField(errorValue, "message") != "" {
			return nil, fmt.Errorf("Gemini Veo 视频生成失败（任务 %s）：%s", id, stringField(errorValue, "message"))
		}
		done, _ := operation["done"].(bool)
		if done {
			videoURL := findProviderMediaURL(operation["response"])
			if videoURL == "" {
				return nil, fmt.Errorf("Gemini Veo 任务 %s 已完成但没有返回视频地址", id)
			}
			data, mimeType, err := getGeminiBinary(withProviderRequestKind(ctx, "download"), input.Config, videoURL)
			if err != nil {
				return nil, fmt.Errorf("Gemini Veo 视频下载失败（任务 %s）：%w", id, err)
			}
			mimeType = normalizedMediaMimeType(mimeType, data)
			return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
		}
		if err := sleepContext(ctx, 5*time.Second); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("Gemini Veo 视频生成超时（任务 %s）", id)
}

func postGeminiJSON(ctx context.Context, config providerConfig, path string, body interface{}, target interface{}) error {
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, geminiVeoURL(config.BaseURL, path), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("x-goog-api-key", config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	ApplyOutboundHeaders(req, config.Headers)
	return doJSON(req, target)
}

func getGeminiJSON(ctx context.Context, config providerConfig, path string, target interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, geminiVeoURL(config.BaseURL, path), nil)
	if err != nil {
		return err
	}
	req.Header.Set("x-goog-api-key", config.APIKey)
	ApplyOutboundHeaders(req, config.Headers)
	return doJSON(req, target)
}

func getGeminiBinary(ctx context.Context, config providerConfig, rawURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("x-goog-api-key", config.APIKey)
	ApplyOutboundHeaders(req, config.Headers)
	return doBinary(req)
}

func geminiVeoURL(baseURL string, path string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if !strings.HasSuffix(strings.ToLower(base), "/v1beta") {
		base += "/v1beta"
	}
	return base + "/" + strings.TrimLeft(path, "/")
}

func findProviderMediaURL(value interface{}) string {
	switch typed := value.(type) {
	case map[string]interface{}:
		for _, key := range []string{"uri", "url", "videoUri", "video_url"} {
			if candidate := strings.TrimSpace(stringField(typed, key)); isPublicMediaURL(candidate) {
				return candidate
			}
		}
		for _, child := range typed {
			if candidate := findProviderMediaURL(child); candidate != "" {
				return candidate
			}
		}
	case []interface{}:
		for _, child := range typed {
			if candidate := findProviderMediaURL(child); candidate != "" {
				return candidate
			}
		}
	}
	return ""
}

func newAPIVideoResultURL(state map[string]interface{}) string {
	return nestedNewAPIVideoResultURL(state, false, 0)
}

func nestedNewAPIVideoResultURL(payload map[string]interface{}, allowResultURL bool, depth int) string {
	if depth < 2 {
		for _, key := range []string{"data", "result", "video"} {
			if nested, ok := payload[key].(map[string]interface{}); ok {
				if videoURL := nestedNewAPIVideoResultURL(nested, true, depth+1); videoURL != "" {
					return videoURL
				}
			}
		}
	}
	keys := []string{"video_url", "videoUrl", "url"}
	if allowResultURL {
		keys = append(keys, "result_url", "resultUrl")
	}
	for _, key := range keys {
		if videoURL := strings.TrimSpace(stringField(payload, key)); isPublicMediaURL(videoURL) {
			return videoURL
		}
	}
	return ""
}

const newAPIChannel1VideoPollInterval = 20 * time.Second

const (
	newAPIChannel2VideoPollInterval    = 10 * time.Second
	newAPIChannel2VideoRetryInterval   = time.Minute
	newAPIChannel2VideoMaxQueryRetries = 3
)

type newAPIChannel2ResponseError struct {
	Code    string
	Message string
}

func (e newAPIChannel2ResponseError) Error() string {
	return fmt.Sprintf("NewAPI Video Generations 任务查询失败（%s）：%s", e.Code, defaultString(e.Message, "上游查询失败"))
}

func runNewAPIChannel2VideoTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	id := resumedProviderRequestID(ctx)
	var created map[string]interface{}
	if id == "" {
		body, err := newAPIChannel2VideoBody(input)
		if err != nil {
			return nil, err
		}
		if err := postJSON(ctx, input.Config, "/video/generations", body, &created); err != nil {
			return nil, err
		}
		id = firstNonEmptyString(stringField(created, "task_id"), stringField(created, "id"))
	}
	if id == "" {
		if data, ok := created["data"].(map[string]interface{}); ok {
			id = firstNonEmptyString(stringField(data, "task_id"), stringField(data, "id"))
		}
	}
	if id == "" {
		return nil, errors.New("NewAPI Video Generations 没有返回任务 ID")
	}

	consecutiveQueryFailures := 0
	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		result, _, err := queryNewAPIChannel2VideoTask(ctx, input, id)
		if err != nil {
			if !isTransientNewAPIChannel2QueryError(err) || consecutiveQueryFailures >= newAPIChannel2VideoMaxQueryRetries {
				return nil, err
			}
			consecutiveQueryFailures++
			logNewAPIChannel2QueryRetry(ctx, id, consecutiveQueryFailures, err)
			if err := sleepContext(ctx, newAPIChannel2VideoRetryInterval); err != nil {
				return nil, err
			}
			continue
		}
		consecutiveQueryFailures = 0
		if result != nil {
			return result, nil
		}
		if err := sleepContext(ctx, newAPIChannel2VideoPollInterval); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("NewAPI Video Generations 视频生成超时（任务 %s）", id)
}

// 单次查询只读取既有上游任务，不创建新任务；自动轮询和人工恢复共用这条安全边界。
func queryNewAPIChannel2VideoTask(ctx context.Context, input canvasGenerationInput, id string) (map[string]interface{}, string, error) {
	var payload map[string]interface{}
	if err := getJSON(ctx, input.Config, "/video/generations/"+id, &payload); err != nil {
		return nil, "", err
	}
	if err := newAPIChannel2PayloadError(payload); err != nil {
		return nil, "", err
	}
	state := payload
	if data, ok := payload["data"].(map[string]interface{}); ok {
		state = data
	}
	status := strings.ToUpper(strings.TrimSpace(stringField(state, "status")))
	switch status {
	case "SUCCESS":
		videoURL := strings.TrimSpace(stringField(state, "result_url"))
		if videoURL == "" {
			return nil, status, fmt.Errorf("NewAPI Video Generations 任务 %s 已成功但没有返回视频地址", id)
		}
		data, mimeType, err := getProviderExternalBinary(withProviderRequestKind(ctx, "download"), input.Config, videoURL)
		if err != nil {
			return nil, status, fmt.Errorf("NewAPI Video Generations 视频结果下载失败（任务 %s）：%w", id, err)
		}
		mimeType = normalizedMediaMimeType(mimeType, data)
		return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, status, nil
	case "FAILURE":
		reason := strings.TrimSpace(stringField(state, "fail_reason"))
		return nil, status, fmt.Errorf("NewAPI Video Generations 视频生成失败（任务 %s）：%s", id, defaultString(reason, "上游返回失败"))
	case "SUBMITTED", "QUEUED", "IN_PROGRESS", "NOT_START", "":
		return nil, status, nil
	default:
		return nil, status, fmt.Errorf("NewAPI Video Generations 任务 %s 返回未知状态：%s", id, status)
	}
}

func newAPIChannel2PayloadError(payload map[string]interface{}) error {
	code := strings.ToLower(strings.TrimSpace(stringField(payload, "code")))
	if code == "" || code == "0" || code == "ok" || code == "success" {
		return nil
	}
	return newAPIChannel2ResponseError{Code: code, Message: firstNonEmptyString(stringField(payload, "message"), stringField(payload, "msg"))}
}

func isTransientNewAPIChannel2QueryError(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var responseErr newAPIChannel2ResponseError
	if errors.As(err, &responseErr) {
		return responseErr.Code == "do_request_failed" || strings.Contains(strings.ToLower(responseErr.Message), "do request failed")
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		body := strings.ToLower(httpErr.Body)
		return httpErr.StatusCode == http.StatusRequestTimeout || httpErr.StatusCode == http.StatusTooManyRequests || httpErr.StatusCode >= http.StatusInternalServerError || strings.Contains(body, "do_request_failed") || strings.Contains(body, "do request failed")
	}
	if errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var networkErr net.Error
	if errors.As(err, &networkErr) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "do_request_failed") || strings.Contains(message, "do request failed")
}

func logNewAPIChannel2QueryRetry(ctx context.Context, providerTaskID string, retry int, err error) {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Service == nil || metadata.TaskID == "" {
		return
	}
	payload := fmt.Sprintf("供应商任务 %s，第 %d/%d 次重试：%s", providerTaskID, retry, newAPIChannel2VideoMaxQueryRetries, safeProviderLogError(err))
	_ = metadata.Service.log(metadata.UserID, metadata.TaskID, "warn", "上游任务查询失败，1 分钟后重试", payload)
}

func newAPIChannel2VideoBody(input canvasGenerationInput) (map[string]interface{}, error) {
	if len(input.ReferenceImages) > 9 || len(input.ReferenceVideos) > 3 || len(input.ReferenceAudios) > 3 {
		return nil, errors.New("NewAPI Video Generations 最多支持 9 张参考图、3 个参考视频和 3 个参考音频")
	}
	modelName := strings.ToLower(strings.TrimSpace(input.Config.Model))
	requiresSingleImage := modelName == "grok-video-1.5" || modelName == "grok-video-1.5-1080p"
	images := make([]string, 0, len(input.ReferenceImages))
	// 单图模型以实际参考图为准，兼容旧画布中未随连接关系更新的 text_to_video 元数据。
	if shouldSendNewAPIVideoImages(input) || requiresSingleImage {
		for _, image := range input.ReferenceImages {
			url, err := videoGenerationsMediaURL(image)
			if err != nil {
				return nil, err
			}
			images = append(images, url)
		}
	}
	if requiresSingleImage {
		if len(images) != 1 {
			return nil, fmt.Errorf("NewAPI Video Generations 的 %s 必须且只能提供 1 张参考图（当前 %d 张）", input.Config.Model, len(images))
		}
	}
	frameImages, err := videoFrameImageURLs(input, images)
	if err != nil {
		return nil, err
	}
	if len(frameImages) > 0 {
		images = frameImages
	}

	seconds, secondsErr := strconv.Atoi(strings.TrimSpace(input.Config.VideoSeconds))
	if secondsErr != nil || seconds < 1 {
		seconds = 6
	}
	ratio := normalizeNewAPIChannel2Ratio(input.Config.Size, modelName)
	resolution := normalizeNewAPIChannel2Resolution(input.Config.VQuality, modelName)
	body := map[string]interface{}{
		"model":        input.Config.Model,
		"prompt":       strings.TrimSpace(input.Prompt),
		"seconds":      strconv.Itoa(seconds),
		"aspect_ratio": ratio,
		"resolution":   resolution,
	}
	if videoCapabilitySupportsAudio(input) {
		body["generate_audio"] = parseBool(input.Config.VideoGenerateAudio, true)
	}
	if len(images) > 0 {
		body["image_urls"] = images
	}
	videoURLs := make([]string, 0, len(input.ReferenceVideos))
	for _, video := range input.ReferenceVideos {
		url, err := videoGenerationsMediaURL(video)
		if err != nil {
			return nil, err
		}
		videoURLs = append(videoURLs, url)
	}
	if len(videoURLs) > 0 {
		body["video_urls"] = videoURLs
	}
	audioURLs := make([]string, 0, len(input.ReferenceAudios))
	for _, audio := range input.ReferenceAudios {
		url, err := videoGenerationsMediaURL(audio)
		if err != nil {
			return nil, err
		}
		audioURLs = append(audioURLs, url)
	}
	if len(audioURLs) > 0 {
		body["audio_urls"] = audioURLs
	}
	return body, nil
}

func videoGenerationsMediaURL(media providerMedia) (string, error) {
	value := strings.TrimSpace(firstNonEmpty(media.URL, media.DataURL))
	if isPublicMediaURL(value) || strings.HasPrefix(value, "data:") {
		return value, nil
	}
	return "", errors.New("NewAPI Video Generations 的参考素材需要公网 URL；私有素材请先保存到 OSS")
}

func normalizeNewAPIChannel2Ratio(value string, modelName string) string {
	ratio := strings.TrimSpace(value)
	if strings.Contains(ratio, "x") {
		parts := strings.SplitN(ratio, "x", 2)
		width, widthErr := strconv.Atoi(parts[0])
		height, heightErr := strconv.Atoi(parts[1])
		if widthErr == nil && heightErr == nil && width > 0 && height > 0 {
			switch {
			case width == height:
				ratio = "1:1"
			case width > height:
				ratio = "16:9"
			default:
				ratio = "9:16"
			}
		}
	}
	if modelName == "grok-video-1.5" || modelName == "grok-video-1.5-1080p" {
		if ratio != "9:16" {
			return "16:9"
		}
		return ratio
	}
	switch ratio {
	case "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3":
		return ratio
	default:
		return "16:9"
	}
}

func normalizeNewAPIChannel2Resolution(value string, modelName string) string {
	if modelName == "grok-video-1.5-1080p" {
		return "1080p"
	}
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "480", "480p", "low":
		return "480p"
	case "1080", "1080p":
		return "1080p"
	case "2160", "2160p", "4k":
		return "2160p"
	default:
		return "720p"
	}
}

func runNewAPIChannel1VideoTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	id := resumedProviderRequestID(ctx)
	var created map[string]interface{}
	if id == "" {
		body, err := newAPIChannel1VideoBody(input)
		if err != nil {
			return nil, err
		}
		if err := postJSON(ctx, input.Config, "/videos", body, &created); err != nil {
			return nil, err
		}
		if data, ok := created["data"].(map[string]interface{}); ok {
			created = data
		}
		id = firstNonEmptyString(stringField(created, "id"), stringField(created, "task_id"))
	}
	status := strings.ToUpper(strings.TrimSpace(stringField(created, "status")))
	if strings.HasPrefix(status, "FAILED") {
		return nil, fmt.Errorf("NewAPI 媒体任务视频生成失败（任务 %s）：%s", id, strings.TrimSpace(strings.TrimPrefix(status, "FAILED:")))
	}
	if id == "" {
		return nil, errors.New("NewAPI 媒体任务没有返回任务 ID")
	}
	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		var state map[string]interface{}
		if err := getJSON(ctx, input.Config, "/videos/"+id, &state); err != nil {
			return nil, err
		}
		if data, ok := state["data"].(map[string]interface{}); ok {
			state = data
		}
		status := strings.ToUpper(strings.TrimSpace(stringField(state, "status")))
		switch {
		case status == "SUCCEEDED":
			videoURL := stringField(state, "object")
			if videoURL == "" {
				return nil, fmt.Errorf("NewAPI 媒体任务 %s 已完成但没有返回视频 URL", id)
			}
			data, mimeType, err := getExternalBinary(withProviderRequestKind(ctx, "download"), videoURL)
			if err != nil {
				return nil, fmt.Errorf("NewAPI 媒体任务视频结果下载失败（任务 %s）：%w", id, err)
			}
			return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
		case strings.HasPrefix(status, "FAILED"):
			message := strings.TrimSpace(strings.TrimPrefix(status, "FAILED:"))
			return nil, fmt.Errorf("NewAPI 媒体任务视频生成失败（任务 %s）：%s", id, defaultString(message, "上游返回失败"))
		}
		if err := sleepContext(ctx, newAPIChannel1VideoPollInterval); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("NewAPI 媒体任务视频生成超时（任务 %s）", id)
}

func newAPIChannel1VideoBody(input canvasGenerationInput) (map[string]interface{}, error) {
	if len(input.ReferenceImages) > 9 || len(input.ReferenceVideos) > 3 || len(input.ReferenceAudios) > 3 {
		return nil, errors.New("NewAPI 媒体任务最多支持 9 张参考图、3 个参考视频和 3 个参考音频")
	}
	media := make([]map[string]string, 0, len(input.ReferenceImages)+len(input.ReferenceVideos)+len(input.ReferenceAudios))
	if shouldSendNewAPIVideoImages(input) {
		for _, image := range input.ReferenceImages {
			url, err := newAPIChannel1MediaURL(image)
			if err != nil {
				return nil, err
			}
			media = append(media, map[string]string{"type": seedanceImageRole(input, image), "url": url})
		}
	}
	for _, video := range input.ReferenceVideos {
		url, err := newAPIChannel1MediaURL(video)
		if err != nil {
			return nil, err
		}
		media = append(media, map[string]string{"type": "reference_video", "url": url})
	}
	for _, audio := range input.ReferenceAudios {
		url, err := newAPIChannel1MediaURL(audio)
		if err != nil {
			return nil, err
		}
		media = append(media, map[string]string{"type": "reference_voice", "url": url})
	}
	parameters := map[string]interface{}{
		"resolution":    normalizeNewAPIChannel1Resolution(input.Config.VQuality),
		"ratio":         normalizeNewAPIChannel1Ratio(input.Config.Size),
		"prompt_extend": false,
		"duration":      normalizeSeedanceVideosDuration(input.Config.VideoSeconds),
	}
	if videoCapabilitySupportsWatermark(input) {
		parameters["watermark"] = parseBool(input.Config.VideoWatermark, false)
	}
	body := map[string]interface{}{
		"model":      input.Config.Model,
		"input":      map[string]interface{}{"prompt": strings.TrimSpace(input.Prompt)},
		"parameters": parameters,
	}
	if len(media) > 0 {
		body["input"].(map[string]interface{})["media"] = media
	}
	return body, nil
}

func newAPIChannel1MediaURL(media providerMedia) (string, error) {
	value := strings.TrimSpace(media.URL)
	if !isPublicMediaURL(value) {
		return "", errors.New("NewAPI 媒体任务的参考素材必须使用公网 HTTP(S) URL，请启用 OSS 或提供公网素材地址")
	}
	if _, err := ValidateOutboundURL(value); err != nil {
		return "", err
	}
	return value, nil
}

func normalizeNewAPIChannel1Resolution(value string) string {
	resolution := strings.TrimSuffix(strings.TrimSpace(value), "p")
	if resolution != "480" && resolution != "720" && resolution != "1080" {
		resolution = "720"
	}
	return resolution + "P"
}

func normalizeNewAPIChannel1Ratio(value string) string {
	switch strings.TrimSpace(value) {
	case "1:1", "16:9", "9:16", "4:3", "3:4":
		return strings.TrimSpace(value)
	default:
		return "16:9"
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func validateGenerationInterface(mode string, interfaceType string) error {
	interfaceType = strings.TrimSpace(interfaceType)
	if interfaceType == "" {
		return nil
	}
	allowed := map[string]map[string]bool{
		"text":  {"chat-completion": true, "openai-response": true},
		"image": {"openai-image": true, "volcengine-ark-image": true, "volcengine-jimeng-image": true},
		"video": {"newapi": true, "newapi-channel-1": true, "newapi-channel-2": true, "xai-video": true, "volcengine-ark-video": true, "volcengine-jimeng-video": true, "gemini-veo": true},
		"audio": {"openai-audio": true, "async-audio": true},
	}
	if allowed[mode] != nil && !allowed[mode][interfaceType] {
		return fmt.Errorf("接口类型 %s 不支持%s生成", interfaceType, mode)
	}
	return nil
}

func grokVideoBody(input canvasGenerationInput) (map[string]interface{}, error) {
	if input.Config.InterfaceType == "xai-video" {
		return xaiVideoBody(input)
	}

	seconds := defaultString(input.Config.VideoSeconds, "6")
	duration, err := strconv.Atoi(seconds)
	if err != nil || duration <= 0 {
		duration = 6
	}
	body := map[string]interface{}{
		"model":    input.Config.Model,
		"prompt":   strings.TrimSpace(input.Prompt),
		"duration": duration,
		"seconds":  strconv.Itoa(duration),
	}
	if size := normalizeVideoSize(input.Config.Size); size != "" {
		body["size"] = size
	}
	if shouldSendNewAPIVideoImages(input) && len(input.ReferenceImages) > 0 {
		images := make([]string, 0, len(input.ReferenceImages))
		for _, image := range input.ReferenceImages {
			url, err := openAIImageInputURL(image)
			if err != nil {
				return nil, err
			}
			images = append(images, url)
		}
		body["image"] = images[0]
		body["images"] = images
	}
	return body, nil
}

// xAI 生成接口与 legacy /videos 使用不同字段，保持独立可避免兼容字段触发上游 422。
func xaiVideoBody(input canvasGenerationInput) (map[string]interface{}, error) {
	body := map[string]interface{}{
		"model":        input.Config.Model,
		"prompt":       strings.TrimSpace(input.Prompt),
		"duration":     normalizeXAIVideoDuration(input.Config.VideoSeconds),
		"aspect_ratio": normalizeXAIVideoAspectRatio(input.Config.Size),
		"resolution":   normalizeXAIVideoResolution(input.Config.VQuality),
	}
	if !shouldSendNewAPIVideoImages(input) || len(input.ReferenceImages) == 0 {
		return body, nil
	}
	if len(input.ReferenceImages) > 1 {
		return nil, fmt.Errorf("xAI 图生视频只支持 1 张起始图，当前连接了 %d 张", len(input.ReferenceImages))
	}
	imageURL, err := openAIImageInputURL(input.ReferenceImages[0])
	if err != nil {
		return nil, err
	}
	body["image"] = map[string]interface{}{"url": imageURL}
	return body, nil
}

func runSeedanceVideosTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	id := resumedProviderRequestID(ctx)
	var created map[string]interface{}
	if id == "" {
		body, err := seedanceVideosBody(input)
		if err != nil {
			return nil, err
		}
		if err := postJSON(ctx, input.Config, "/videos", body, &created); err != nil {
			return nil, err
		}
		if data, ok := created["data"].(map[string]interface{}); ok {
			created = data
		}
		id = firstNonEmptyString(stringField(created, "id"), stringField(created, "task_id"))
	}
	if id == "" {
		return nil, errors.New("Seedance 接口没有返回任务 ID")
	}
	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		var state map[string]interface{}
		if err := getJSON(ctx, input.Config, "/videos/"+id, &state); err != nil {
			return nil, err
		}
		if data, ok := state["data"].(map[string]interface{}); ok {
			state = data
		}
		status := strings.ToLower(stringField(state, "status"))
		if status == "completed" || status == "succeeded" {
			videoURL := stringField(state, "video_url")
			if videoURL != "" {
				data, mimeType, err := getExternalBinary(withProviderRequestKind(ctx, "download"), videoURL)
				if err != nil {
					return nil, fmt.Errorf("视频结果下载失败：%w", err)
				}
				return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
			}
			data, mimeType, err := getBinary(ctx, input.Config, "/videos/"+id+"/content")
			if err != nil {
				return nil, errors.New("Seedance 任务成功但没有返回视频 URL")
			}
			return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
		}
		if status == "failed" || status == "cancelled" || status == "expired" {
			return nil, errors.New(defaultString(seedanceErrorMessage(state), "Seedance 视频生成失败"))
		}
		if err := sleepContext(ctx, 5*time.Second); err != nil {
			return nil, err
		}
	}
	return nil, errors.New("Seedance 视频生成超时")
}

func runSeedanceAgentPlanVideoTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	providerName := "Seedance"
	if input.Config.InterfaceType == string(model.ChannelInterfaceVolcengineArkVideo) {
		providerName = "火山方舟"
	}
	id := resumedProviderRequestID(ctx)
	var created map[string]interface{}
	if id == "" {
		content, err := seedanceContent(input)
		if err != nil {
			return nil, err
		}
		if input.Config.InterfaceType == string(model.ChannelInterfaceVolcengineArkVideo) {
			for _, item := range content {
				if item["type"] == "image_url" {
					item["role"] = "reference_image"
				}
			}
		}
		body := map[string]interface{}{
			"model":      input.Config.Model,
			"content":    content,
			"ratio":      normalizeSeedanceRatio(input.Config.Size),
			"resolution": normalizeSeedanceResolution(input.Config.VQuality, input.Config.Model),
			"duration":   normalizeSeedanceDuration(input.Config.VideoSeconds),
		}
		if videoCapabilitySupportsAudio(input) {
			body["generate_audio"] = parseBool(input.Config.VideoGenerateAudio, true)
		}
		if videoCapabilitySupportsWatermark(input) {
			body["watermark"] = parseBool(input.Config.VideoWatermark, false)
		}
		if err := postJSON(ctx, input.Config, "/contents/generations/tasks", body, &created); err != nil {
			return nil, err
		}
		if data, ok := created["data"].(map[string]interface{}); ok {
			created = data
		}
		id = stringField(created, "id")
	}
	if id == "" {
		return nil, fmt.Errorf("%s接口没有返回任务 ID", providerName)
	}
	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		var state map[string]interface{}
		if err := getJSON(ctx, input.Config, "/contents/generations/tasks/"+id, &state); err != nil {
			return nil, err
		}
		if data, ok := state["data"].(map[string]interface{}); ok {
			state = data
		}
		status := stringField(state, "status")
		if status == "succeeded" {
			content, _ := state["content"].(map[string]interface{})
			videoURL := stringField(content, "video_url")
			if videoURL == "" {
				return nil, fmt.Errorf("%s任务成功但没有返回视频 URL", providerName)
			}
			data, mimeType, err := getExternalBinary(withProviderRequestKind(ctx, "download"), videoURL)
			if err != nil {
				return nil, fmt.Errorf("视频结果下载失败：%w", err)
			}
			return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
		}
		if status == "failed" || status == "cancelled" || status == "expired" {
			return nil, fmt.Errorf("%s视频生成失败", providerName)
		}
		if err := sleepContext(ctx, 5*time.Second); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("%s视频生成超时", providerName)
}

func postJSON(ctx context.Context, config providerConfig, path string, body interface{}, target interface{}) error {
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL(config.BaseURL, path), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	ApplyOutboundHeaders(req, config.Headers)
	return doJSON(req, target)
}

func postForm(ctx context.Context, config providerConfig, path string, contentType string, body io.Reader, target interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL(config.BaseURL, path), body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	req.Header.Set("Content-Type", contentType)
	ApplyOutboundHeaders(req, config.Headers)
	return doJSON(req, target)
}

func getJSON(ctx context.Context, config providerConfig, path string, target interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL(config.BaseURL, path), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	ApplyOutboundHeaders(req, config.Headers)
	return doJSON(req, target)
}

func postBinary(ctx context.Context, config providerConfig, path string, body interface{}) ([]byte, string, error) {
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL(config.BaseURL, path), bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	ApplyOutboundHeaders(req, config.Headers)
	return doBinary(req)
}

func getBinary(ctx context.Context, config providerConfig, path string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL(config.BaseURL, path), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	ApplyOutboundHeaders(req, config.Headers)
	return doBinary(req)
}

func getExternalBinary(ctx context.Context, rawURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	return doBinary(req)
}

func getProviderExternalBinary(ctx context.Context, config providerConfig, rawURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	if sameProviderOrigin(config.BaseURL, rawURL) {
		req.Header.Set("Authorization", "Bearer "+config.APIKey)
		ApplyOutboundHeaders(req, config.Headers)
	}
	return doBinary(req)
}

func sameProviderOrigin(baseURL string, rawURL string) bool {
	base, baseErr := url.Parse(strings.TrimSpace(baseURL))
	target, targetErr := url.Parse(strings.TrimSpace(rawURL))
	if baseErr != nil || targetErr != nil || base.Scheme == "" || base.Host == "" || target.Scheme == "" || target.Host == "" {
		return false
	}
	return strings.EqualFold(base.Scheme, target.Scheme) && strings.EqualFold(base.Host, target.Host)
}

func doJSON(req *http.Request, target interface{}) error {
	data, mimeType, err := doBinary(req)
	if err != nil {
		return err
	}
	if !strings.Contains(mimeType, "json") && !json.Valid(data) {
		return fmt.Errorf("接口返回非 JSON 内容：%s", mimeType)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return err
	}
	if payload, ok := target.(*imageResponse); ok {
		if payload.Error != nil && payload.Error.Message != "" {
			return errors.New(payload.Error.Message)
		}
		if payload.Code != nil && *payload.Code != 0 {
			return errors.New(defaultString(payload.Msg, "请求失败"))
		}
	}
	if payload, ok := target.(*map[string]interface{}); ok {
		if code, ok := (*payload)["code"].(float64); ok && code != 0 {
			return errors.New(defaultString(stringField(*payload, "msg"), "请求失败"))
		}
		if errValue, ok := (*payload)["error"].(map[string]interface{}); ok && stringField(errValue, "message") != "" {
			return errors.New(stringField(errValue, "message"))
		}
	}
	return nil
}

func doBinary(req *http.Request) ([]byte, string, error) {
	startedAt := time.Now()
	requestTimeout := providerHTTPTimeout
	if deadline, ok := req.Context().Deadline(); ok {
		if remaining := time.Until(deadline); remaining > 0 {
			requestTimeout = remaining
		}
	}
	var release func()
	var coordinator *runtimeCoordinator
	var runtimeService *Service
	responseLimit := maxProviderResponseBytes
	channelID := ""
	if metadata, ok := req.Context().Value(providerAnalyticsKey{}).(providerAnalyticsContext); ok && metadata.Service != nil {
		runtimeService = metadata.Service
		coordinator = metadata.Service.coordinator
		channelID = metadata.ChannelID
		policy, err := metadata.Service.RuntimePolicy()
		if err != nil {
			return nil, "", fmt.Errorf("读取生成资源限制失败：%w", err)
		}
		responseLimit = megabytes(policy.Resource.GeneratedFileMB)
		open, err := coordinator.circuitOpen(req.Context(), channelID)
		if err != nil {
			return nil, "", fmt.Errorf("读取渠道熔断状态失败：%w", err)
		}
		if open {
			return nil, "", errors.New("当前渠道连续失败，已暂时熔断，请稍后重试")
		}
		slotID := channelID
		if slotID == "" {
			slotID = "custom:" + strings.ToLower(req.URL.Host)
		}
		var concurrencyLimit int
		release, concurrencyLimit, err = metadata.Service.AcquireChannelSlot(req.Context(), channelID, slotID, requestTimeout+time.Minute)
		metadata.ConcurrencyLimit = concurrencyLimit
		req = req.WithContext(context.WithValue(req.Context(), providerAnalyticsKey{}, metadata))
		if err != nil {
			recordProviderRequest(req, startedAt, 0, nil, err)
			return nil, "", err
		}
		defer release()
	}
	if _, err := ValidateOutboundURL(req.URL.String()); err != nil {
		recordProviderRequest(req, startedAt, 0, nil, err)
		return nil, "", err
	}
	ApplyDefaultOutboundHeaders(req)
	client := OutboundHTTPClient(requestTimeout)
	resp, err := client.Do(req)
	if err != nil {
		if runtimeService != nil {
			_ = runtimeService.RecordChannelResult(req.Context(), channelID, !errors.Is(err, context.Canceled))
		}
		recordProviderRequest(req, startedAt, 0, nil, err)
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.ContentLength > responseLimit {
		err = fmt.Errorf("上游响应超过 %s 限制", formatStorageLimit(responseLimit))
		recordProviderRequest(req, startedAt, resp.StatusCode, nil, err)
		return nil, "", err
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, responseLimit+1))
	if err != nil {
		recordProviderRequest(req, startedAt, resp.StatusCode, nil, err)
		return nil, "", err
	}
	if int64(len(data)) > responseLimit {
		err = fmt.Errorf("上游响应超过 %s 限制", formatStorageLimit(responseLimit))
		recordProviderRequest(req, startedAt, resp.StatusCode, nil, err)
		return nil, "", err
	}
	mimeType := resp.Header.Get("Content-Type")
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if runtimeService != nil {
			_ = runtimeService.RecordChannelResult(req.Context(), channelID, resp.StatusCode >= 500)
		}
		httpErr := providerHTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: string(data)}
		recordProviderRequest(req, startedAt, resp.StatusCode, data, httpErr)
		return nil, "", httpErr
	}
	recordProviderRequest(req, startedAt, resp.StatusCode, data, nil)
	if runtimeService != nil {
		_ = runtimeService.RecordChannelResult(req.Context(), channelID, false)
	}
	return data, mimeType, nil
}

func providerPollingDeadline(ctx context.Context) time.Time {
	if deadline, ok := ctx.Deadline(); ok {
		return deadline
	}
	return time.Now().Add(videoPollTimeout)
}

func recordProviderRequest(req *http.Request, startedAt time.Time, statusCode int, responseBody []byte, requestErr error) {
	metadata, ok := req.Context().Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Service == nil {
		return
	}
	status := model.ApiCallStatusSucceeded
	errorText := ""
	if requestErr != nil || statusCode < 200 || statusCode >= 300 {
		status = model.ApiCallStatusFailed
		if requestErr != nil {
			errorText = safeProviderLogError(requestErr)
		}
	}
	requestKind := providerRequestKind(req.Method, req.URL.Path)
	if metadata.RequestKind != "" {
		requestKind = metadata.RequestKind
	}
	apiFormat := "openai"
	if req.Header.Get("x-goog-api-key") != "" {
		apiFormat = "gemini"
	}
	log := model.ApiCallLog{
		UserID: metadata.UserID, ChannelID: metadata.ChannelID, TaskID: metadata.TaskID, BillingOrderID: metadata.BillingOrderID,
		Source: "backend-task", Capability: metadata.Capability, Operation: metadata.Operation,
		RequestKind: requestKind, Billable: req.Method == http.MethodPost && requestKind != "cancel",
		APIFormat: apiFormat, Method: req.Method, Path: req.URL.Path, Model: metadata.Model,
		Status: status, StatusCode: statusCode, DurationMs: time.Since(startedAt).Milliseconds(),
		Error: errorText, ConcurrencyLimit: metadata.ConcurrencyLimit, UpstreamURL: req.URL.Scheme + "://" + req.URL.Host + req.URL.Path,
		ProviderRequestID: metadata.ProviderRequestID, RequestContentType: req.Header.Get("Content-Type"), RequestBody: requestPayloadForLog(req), ResponseBody: SanitizeAPICallPayload(responseBody, ""),
	}
	channelSlotFailure := false
	if code, message := ChannelSlotFailureDetails(requestErr); code != "" {
		channelSlotFailure = true
		log.ErrorCode = code
		log.Error = message
	}
	if requestKind == "create" && metadata.Capability == "video" {
		log.VideoSeconds = metadata.VideoSeconds
		if log.VideoSeconds <= 0 {
			if strings.Contains(strings.ToLower(metadata.Model), "seedance") || strings.Contains(req.URL.Path, "/contents/generations/tasks") {
				log.VideoSeconds = 5
			} else {
				log.VideoSeconds = 6
			}
		}
	}
	metadata.Service.EnrichAPICallLog(&log, responseBody)
	if err := metadata.Service.LogAPICall(log); err != nil {
		if !channelSlotFailure {
			_ = metadata.Service.MarkBillingUncertain(metadata.BillingOrderID, "上游调用日志写入失败，费用状态待核对")
		}
	}
}

func safeProviderLogError(err error) string {
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		return fmt.Sprintf("上游 HTTP %d", httpErr.StatusCode)
	}
	return truncateRunes(err.Error(), 500)
}

func providerRequestKind(method string, path string) string {
	if method == http.MethodGet {
		if strings.HasSuffix(strings.TrimRight(path, "/"), "/content") || strings.Contains(path, "/download") {
			return "download"
		}
		return "poll"
	}
	if strings.Contains(path, "repair") {
		return "repair"
	}
	return "create"
}

func apiURL(baseURL string, path string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(base, "/v1") || strings.HasSuffix(base, "/v1beta") || strings.HasSuffix(base, "/api/v3") || strings.HasSuffix(base, "/api/plan/v3") {
		return base + path
	}
	return base + "/v1" + path
}

func writeField(writer *multipart.Writer, key string, value string) {
	_ = writer.WriteField(key, value)
}

func writeMediaPart(writer *multipart.Writer, field string, media providerMedia) error {
	raw, mimeType, err := mediaBytes(media)
	if err != nil {
		return err
	}
	filename := providerMediaFilename(media, mimeType)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": field, "filename": filename}))
	header.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return err
	}
	_, err = part.Write(raw)
	return err
}

func providerMediaFilename(media providerMedia, mimeType string) string {
	base := strings.TrimSpace(media.ID)
	if base == "" {
		base = "reference"
	}
	var builder strings.Builder
	for _, char := range base {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' {
			builder.WriteRune(char)
			if builder.Len() >= 64 {
				break
			}
		}
	}
	base = builder.String()
	if base == "" {
		base = "reference"
	}
	extensions, _ := mime.ExtensionsByType(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	extension := ".bin"
	if len(extensions) > 0 {
		extension = extensions[0]
	}
	return "reference-" + base + extension
}

func mediaBytes(media providerMedia) ([]byte, string, error) {
	value := media.DataURL
	if value == "" {
		value = media.URL
	}
	if !strings.HasPrefix(value, "data:") {
		return nil, "", errors.New("后端任务队列需要 data URL 形式的本地参考素材")
	}
	header, encoded, ok := strings.Cut(value, ",")
	if !ok {
		return nil, "", errors.New("data URL 格式错误")
	}
	mimeType := strings.TrimPrefix(strings.Split(strings.TrimPrefix(header, "data:"), ";")[0], " ")
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, "", err
	}
	return raw, normalizedMediaMimeType(defaultString(mimeType, media.Type), raw), nil
}

func imageDataURLs(payload imageResponse) ([]map[string]string, error) {
	if len(payload.Data) == 0 {
		return nil, errors.New("接口没有返回图片")
	}
	images := make([]map[string]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		if b64, ok := item["b64_json"].(string); ok && b64 != "" {
			images = append(images, map[string]string{"dataUrl": "data:image/png;base64," + b64})
			continue
		}
		if url, ok := item["url"].(string); ok && url != "" {
			images = append(images, map[string]string{"dataUrl": url})
		}
	}
	if len(images) == 0 {
		return nil, errors.New("接口没有返回可用图片")
	}
	return images, nil
}

func dataURL(mimeType string, data []byte) string {
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	return "data:" + strings.Split(mimeType, ";")[0] + ";base64," + base64.StdEncoding.EncodeToString(data)
}

func stringField(payload map[string]interface{}, key string) string {
	value, _ := payload[key].(string)
	return value
}

func extractResponseText(payload map[string]interface{}) string {
	output, ok := payload["output"].([]interface{})
	if !ok {
		return ""
	}
	var chunks []string
	for _, item := range output {
		record, ok := item.(map[string]interface{})
		if !ok || record["type"] != "message" {
			continue
		}
		content, _ := record["content"].([]interface{})
		for _, part := range content {
			partRecord, ok := part.(map[string]interface{})
			if ok && stringField(partRecord, "text") != "" {
				chunks = append(chunks, stringField(partRecord, "text"))
			}
		}
	}
	return strings.Join(chunks, "")
}

func extractChatCompletionText(payload map[string]interface{}) string {
	if data, ok := payload["data"].(map[string]interface{}); ok {
		payload = data
	}
	choices, ok := payload["choices"].([]interface{})
	if !ok {
		return ""
	}
	var chunks []string
	for _, choice := range choices {
		record, ok := choice.(map[string]interface{})
		if !ok {
			continue
		}
		if message, ok := record["message"].(map[string]interface{}); ok {
			if text := stringField(message, "content"); text != "" {
				chunks = append(chunks, text)
			}
		}
		if text := stringField(record, "text"); text != "" {
			chunks = append(chunks, text)
		}
	}
	return strings.Join(chunks, "")
}

func withSystemPrompt(config providerConfig, prompt string) string {
	systemPrompt := strings.TrimSpace(config.SystemPrompt)
	if systemPrompt == "" {
		return prompt
	}
	return systemPrompt + "\n\n" + prompt
}

func seedanceContent(input canvasGenerationInput) ([]map[string]interface{}, error) {
	content := make([]map[string]interface{}, 0, 1+len(input.ReferenceImages)+len(input.ReferenceVideos)+len(input.ReferenceAudios))
	text := seedancePromptText(input)
	if strings.TrimSpace(text) != "" {
		content = append(content, map[string]interface{}{"type": "text", "text": text})
	}
	for _, image := range input.ReferenceImages {
		url, err := mediaReferenceURL(image)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"type": "image_url", "image_url": map[string]interface{}{"url": url}, "role": seedanceImageRole(input, image)})
	}
	for _, video := range input.ReferenceVideos {
		url, err := mediaReferenceURL(video)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"type": "video_url", "video_url": map[string]interface{}{"url": url}, "role": "reference_video"})
	}
	for _, audio := range input.ReferenceAudios {
		url, err := mediaReferenceURL(audio)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"type": "audio_url", "audio_url": map[string]interface{}{"url": url}, "role": "reference_audio"})
	}
	if len(content) == 0 {
		return nil, errors.New("请输入视频提示词或连接参考素材")
	}
	return content, nil
}

func shouldSendNewAPIVideoImages(input canvasGenerationInput) bool {
	if input.Metadata == nil {
		return true
	}
	operation, _ := input.Metadata["videoEditOperation"].(string)
	return strings.TrimSpace(operation) != "text_to_video"
}

// 本地测试 helper 没有能力配置时保留历史协议字段；真实系统任务会携带已解析的模型能力。
func videoCapabilitySupportsAudio(input canvasGenerationInput) bool {
	return input.VideoCapability == nil || input.VideoCapability.GenerateAudio.Supported
}

func videoCapabilitySupportsWatermark(input canvasGenerationInput) bool {
	return input.VideoCapability == nil || input.VideoCapability.Watermark.Supported
}

func newAPIVideoPromptText(input canvasGenerationInput) string {
	return strings.TrimSpace(input.Prompt)
}

func seedanceVideosBody(input canvasGenerationInput) (map[string]interface{}, error) {
	if (len(input.ReferenceVideos) > 0 || len(input.ReferenceAudios) > 0) && len(input.ReferenceImages) == 0 {
		return nil, errors.New("Seedance 参考视频或参考音频需要同时连接至少 1 张主参考图")
	}
	body := map[string]interface{}{
		"model":        input.Config.Model,
		"prompt":       seedanceVideosPromptText(input),
		"aspect_ratio": normalizeSeedanceVideosRatio(input.Config.Size),
		"duration":     normalizeSeedanceVideosDuration(input.Config.VideoSeconds),
	}
	if videoCapabilitySupportsAudio(input) {
		body["generate_audio"] = parseBool(input.Config.VideoGenerateAudio, true)
	}
	imageURLs := make([]string, 0, len(input.ReferenceImages))
	for _, image := range input.ReferenceImages {
		url, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		imageURLs = append(imageURLs, url)
	}
	frameImageURLs, err := videoFrameImageURLs(input, imageURLs)
	if err != nil {
		return nil, err
	}
	if len(frameImageURLs) > 0 {
		body["image_urls"] = frameImageURLs
	} else if len(imageURLs) > 0 {
		body["image_url"] = imageURLs[0]
		if len(imageURLs) > 1 {
			body["reference_image_urls"] = imageURLs[1:]
		}
	}
	videoURLs := make([]string, 0, len(input.ReferenceVideos))
	for _, video := range input.ReferenceVideos {
		url, err := seedanceVideosMediaURL(video)
		if err != nil {
			return nil, err
		}
		videoURLs = append(videoURLs, url)
	}
	if len(videoURLs) > 0 {
		body["reference_videos"] = videoURLs
	}
	audioURLs := make([]string, 0, len(input.ReferenceAudios))
	for _, audio := range input.ReferenceAudios {
		url, err := seedanceVideosMediaURL(audio)
		if err != nil {
			return nil, err
		}
		audioURLs = append(audioURLs, url)
	}
	if len(audioURLs) > 0 {
		body["reference_audios"] = audioURLs
	}
	return body, nil
}

func seedancePromptText(input canvasGenerationInput) string {
	return strings.TrimSpace(input.Prompt)
}

func seedanceVideosPromptText(input canvasGenerationInput) string {
	return strings.TrimSpace(input.Prompt)
}

func seedanceImageRole(input canvasGenerationInput, image providerMedia) string {
	if id := metadataString(input.Metadata, "videoStartFrameNodeId"); id != "" && image.ID == id {
		return "first_frame"
	}
	if id := metadataString(input.Metadata, "videoEndFrameNodeId"); id != "" && image.ID == id {
		return "last_frame"
	}
	return "reference_image"
}

func videoFrameImageURLs(input canvasGenerationInput, imageURLs []string) ([]string, error) {
	startFrameID := metadataString(input.Metadata, "videoStartFrameNodeId")
	endFrameID := metadataString(input.Metadata, "videoEndFrameNodeId")
	if startFrameID == "" && endFrameID == "" {
		return nil, nil
	}
	// image_urls 按首帧、尾帧、普通参考图排序，保持 JSON 视频协议的结构化帧语义。
	ordered := make([]string, 0, len(imageURLs))
	used := make([]bool, len(imageURLs))
	appendFrame := func(frameID string, label string) error {
		if frameID == "" {
			return nil
		}
		for index, image := range input.ReferenceImages {
			if index >= len(imageURLs) || image.ID != frameID {
				continue
			}
			ordered = append(ordered, imageURLs[index])
			used[index] = true
			return nil
		}
		return fmt.Errorf("已配置的%s参考图未包含在视频请求中", label)
	}
	if err := appendFrame(startFrameID, "首帧"); err != nil {
		return nil, err
	}
	if err := appendFrame(endFrameID, "尾帧"); err != nil {
		return nil, err
	}
	for index, imageURL := range imageURLs {
		if !used[index] {
			ordered = append(ordered, imageURL)
		}
	}
	return ordered, nil
}

func metadataString(metadata map[string]interface{}, key string) string {
	if metadata == nil {
		return ""
	}
	value, _ := metadata[key].(string)
	return strings.TrimSpace(value)
}

func mediaReferenceURL(media providerMedia) (string, error) {
	value := strings.TrimSpace(media.URL)
	if isPublicMediaURL(value) || strings.HasPrefix(value, "asset://") || strings.HasPrefix(value, "data:") {
		return value, nil
	}
	value = strings.TrimSpace(media.DataURL)
	if value != "" {
		return value, nil
	}
	return "", errors.New("参考素材需要公网 URL、asset:// 素材 ID 或 data URL")
}

func seedanceVideosMediaURL(media providerMedia) (string, error) {
	value := strings.TrimSpace(media.DataURL)
	if strings.HasPrefix(value, "data:") {
		return value, nil
	}
	value = strings.TrimSpace(media.URL)
	if strings.HasPrefix(value, "data:") || isPublicMediaURL(value) {
		return value, nil
	}
	return "", errors.New("Seedance /videos 参考素材需要公网 URL 或 data URL")
}

func seedanceErrorMessage(state map[string]interface{}) string {
	if errorValue, ok := state["error"].(map[string]interface{}); ok {
		message := stringField(errorValue, "message")
		code := stringField(errorValue, "code")
		if message != "" && code != "" {
			return code + "：" + message
		}
		if message != "" {
			return message
		}
	}
	code := stringField(state, "error_code")
	if code != "" {
		return code
	}
	return ""
}

func isPublicMediaURL(value string) bool {
	lower := strings.ToLower(value)
	return strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://")
}

func isSeedanceVideoConfig(config providerConfig) bool {
	model := strings.ToLower(config.Model)
	return strings.Contains(model, "seedance") || strings.Contains(model, "doubao-seedance") || isArkPlanVideoConfig(config)
}

func isGrokVideoConfig(config providerConfig) bool {
	return strings.Contains(strings.ToLower(strings.TrimSpace(config.Model)), "grok")
}

func isArkPlanVideoConfig(config providerConfig) bool {
	return strings.Contains(strings.ToLower(config.BaseURL), "/api/plan/v3")
}

func normalizeImageQuality(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1k":
		return "low"
	case "2k":
		return "medium"
	case "4k":
		return "high"
	default:
		return value
	}
}

func normalizePixelSize(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "auto" {
		return ""
	}
	// 画布按比例保存常用预设；图片接口只接受像素尺寸，必须在请求边界完成转换。
	switch value {
	case "1:1":
		return "1024x1024"
	case "3:2":
		return "1536x1024"
	case "2:3":
		return "1024x1536"
	case "4:3":
		return "1360x1024"
	case "3:4":
		return "1024x1360"
	case "16:9":
		return "1824x1024"
	case "9:16":
		return "1024x1824"
	case "21:9":
		return "2352x1008"
	}
	if strings.Contains(value, "x") {
		return value
	}
	return ""
}

func normalizeVideoSize(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "auto" {
		return ""
	}
	if strings.Contains(value, "x") {
		return value
	}
	if value == "9:16" || value == "2:3" || value == "3:4" {
		return "720x1280"
	}
	return "1280x720"
}

func normalizeVideoResolution(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "auto" || value == "medium" || value == "high" {
		return "720p"
	}
	if value == "low" {
		return "480p"
	}
	if strings.EqualFold(value, "4k") {
		return "2160p"
	}
	if strings.HasSuffix(value, "p") {
		return value
	}
	return value + "p"
}

func normalizeXAIVideoDuration(value string) int {
	duration, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || duration <= 0 {
		return 6
	}
	return duration
}

func normalizeXAIVideoResolution(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "480", "480p", "low":
		return "480p"
	case "1080", "1080p":
		return "1080p"
	case "2160", "2160p", "4k":
		return "2160p"
	default:
		return "720p"
	}
}

func normalizeXAIVideoAspectRatio(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	allowed := map[string]bool{
		"1:1": true, "16:9": true, "9:16": true, "4:3": true,
		"3:4": true, "3:2": true, "2:3": true,
	}
	if allowed[value] {
		return value
	}
	parts := strings.Split(value, "x")
	if len(parts) != 2 {
		return "16:9"
	}
	width, widthErr := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, heightErr := strconv.Atoi(strings.TrimSpace(parts[1]))
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return "16:9"
	}
	ratio := float64(width) / float64(height)
	candidates := []struct {
		name  string
		ratio float64
	}{
		{name: "1:1", ratio: 1},
		{name: "16:9", ratio: 16.0 / 9},
		{name: "9:16", ratio: 9.0 / 16},
		{name: "4:3", ratio: 4.0 / 3},
		{name: "3:4", ratio: 3.0 / 4},
		{name: "3:2", ratio: 3.0 / 2},
		{name: "2:3", ratio: 2.0 / 3},
	}
	bestName := "16:9"
	bestDifference := 2.0
	for _, candidate := range candidates {
		difference := ratio - candidate.ratio
		if difference < 0 {
			difference = -difference
		}
		if difference < bestDifference {
			bestName = candidate.name
			bestDifference = difference
		}
	}
	return bestName
}

func normalizeSeedanceDuration(value string) int {
	if strings.TrimSpace(value) == "-1" {
		return -1
	}
	seconds, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || seconds <= 0 {
		return 5
	}
	return seconds
}

func normalizeSeedanceVideosDuration(value string) int {
	return normalizeSeedanceDuration(value)
}

func normalizeSeedanceRatio(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "auto" || value == "adaptive" {
		return "adaptive"
	}
	switch value {
	case "16:9", "9:16", "1:1", "4:3", "3:4", "21:9":
		return value
	default:
		return "adaptive"
	}
}

func normalizeSeedanceVideosRatio(value string) string {
	ratio := normalizeSeedanceRatio(value)
	if ratio == "adaptive" {
		return "16:9"
	}
	return ratio
}

func normalizeSeedanceResolution(value string, model string) string {
	resolution := strings.TrimSuffix(strings.TrimSpace(value), "p")
	if strings.EqualFold(resolution, "4k") {
		resolution = "2160"
	}
	switch resolution {
	case "480", "720", "1080", "2160":
	default:
		if value == "low" {
			resolution = "480"
		} else {
			resolution = "720"
		}
	}
	if strings.Contains(strings.ToLower(model), "fast") && (resolution == "1080" || resolution == "2160") {
		resolution = "720"
	}
	return resolution + "p"
}

func parseBool(value string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true":
		return true
	case "false":
		return false
	default:
		return fallback
	}
}

func parseFloat(value string, fallback float64) float64 {
	number, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || number == 0 {
		return fallback
	}
	return number
}

func sleepContext(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
