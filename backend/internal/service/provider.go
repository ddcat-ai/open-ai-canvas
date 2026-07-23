package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
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
}

type providerConfig struct {
	ChannelID             string `json:"channelId"`
	APIFormat             string `json:"apiFormat"`
	InterfaceType         string `json:"interfaceType"`
	BaseURL               string `json:"baseUrl"`
	APIKey                string `json:"apiKey"`
	Model                 string `json:"model"`
	Size                  string `json:"size"`
	Quality               string `json:"quality"`
	TransparentBackground string `json:"transparentBackground"`
	Count                 string `json:"count"`
	VideoSeconds          string `json:"videoSeconds"`
	VQuality              string `json:"vquality"`
	VideoGenerateAudio    string `json:"videoGenerateAudio"`
	VideoWatermark        string `json:"videoWatermark"`
	AudioVoice            string `json:"audioVoice"`
	AudioFormat           string `json:"audioFormat"`
	AudioSpeed            string `json:"audioSpeed"`
	AudioInstructions     string `json:"audioInstructions"`
	SystemPrompt          string `json:"systemPrompt"`
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
	if input.Config.APIFormat == "gemini" {
		return nil, errors.New("后端任务队列暂不支持 Gemini 调用格式，请使用 OpenAI 兼容渠道")
	}
	if strings.TrimSpace(input.Config.BaseURL) == "" || strings.TrimSpace(input.Config.APIKey) == "" || strings.TrimSpace(input.Config.Model) == "" {
		return nil, errors.New("后端生成任务缺少 Base URL、API Key 或模型名")
	}
	if err := validateGenerationInterface(input.Mode, input.Config.InterfaceType); err != nil {
		return nil, err
	}
	if resumedProviderRequestID(ctx) == "" {
		if err := s.hydrateGenerationMedia(userID, &input, input.Config.InterfaceType == "newapi-channel-1"); err != nil {
			return nil, err
		}
	}
	switch input.Mode {
	case "image":
		return runImageTask(ctx, input)
	case "text":
		return runTextTask(ctx, input)
	case "video":
		return runVideoTask(ctx, input)
	case "audio":
		return runAudioTask(ctx, input)
	default:
		return nil, fmt.Errorf("不支持的生成模式：%s", input.Mode)
	}
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
			return errors.New("NewAPI 渠道 1 的参考素材不能使用内嵌数据，请先上传到 OSS 或提供公网素材地址")
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
		if resource.Provider == "local" {
			return errors.New("NewAPI 渠道 1 的参考素材需要公网可访问地址，请启用 OSS 后重新上传该素材")
		}
		setting, err := s.ossSettingForResource(userID, resource)
		if err != nil {
			return err
		}
		if setting.Provider != "aliyun" {
			return errors.New("NewAPI 渠道 1 的参考素材暂时只支持阿里云 OSS 签名地址")
		}
		signedURL, err := signedOSSObjectURL(setting, resource.ObjectKey, time.Now().Add(providerResourceURLTTL))
		if err != nil {
			return fmt.Errorf("生成 NewAPI 渠道 1 参考素材地址失败：%w", err)
		}
		media.URL = signedURL
		media.DataURL = ""
		media.MimeType = firstNonEmpty(media.MimeType, resource.MimeType)
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
	config.InterfaceType = string(channel.InterfaceType)
	config.BaseURL = channel.BaseURL
	config.APIKey = channel.APIKey
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
	var payload imageResponse
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
	if len(input.ReferenceImages) == 0 {
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
	return content, nil
}

func textChatContent(input canvasGenerationInput) (interface{}, error) {
	if len(input.ReferenceImages) == 0 {
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
	data, mimeType, err := postBinary(ctx, input.Config, "/audio/speech", body)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"mode": "audio", "audio": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType, "format": format}}, nil
}

func runVideoTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if input.Config.InterfaceType == "newapi-channel-2" {
		return runNewAPIChannel2VideoTask(ctx, input)
	}
	if input.Config.InterfaceType == "newapi-channel-1" {
		return runNewAPIChannel1VideoTask(ctx, input)
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
				data, mimeType, err := getExternalBinary(withProviderRequestKind(ctx, "download"), videoURL)
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
	newAPIChannel2VideoPollInterval = 5 * time.Second
	newAPIChannel2VideoPollTimeout  = 5 * time.Minute
)

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
		return nil, errors.New("NewAPI 渠道 2 没有返回任务 ID")
	}

	for deadline := time.Now().Add(newAPIChannel2VideoPollTimeout); time.Now().Before(deadline); {
		var state map[string]interface{}
		if err := getJSON(ctx, input.Config, "/video/generations/"+id, &state); err != nil {
			return nil, err
		}
		if data, ok := state["data"].(map[string]interface{}); ok {
			state = data
		}
		status := strings.ToUpper(strings.TrimSpace(stringField(state, "status")))
		switch status {
		case "SUCCESS":
			videoURL := strings.TrimSpace(stringField(state, "result_url"))
			if videoURL == "" {
				return nil, fmt.Errorf("NewAPI 渠道 2 任务 %s 已成功但没有返回视频地址", id)
			}
			data, mimeType, err := getExternalBinary(withProviderRequestKind(ctx, "download"), videoURL)
			if err != nil {
				return nil, fmt.Errorf("NewAPI 渠道 2 视频结果下载失败（任务 %s）：%w", id, err)
			}
			mimeType = normalizedMediaMimeType(mimeType, data)
			return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
		case "FAILURE":
			reason := strings.TrimSpace(stringField(state, "fail_reason"))
			return nil, fmt.Errorf("NewAPI 渠道 2 视频生成失败（任务 %s）：%s", id, defaultString(reason, "上游返回失败"))
		case "SUBMITTED", "QUEUED", "IN_PROGRESS", "NOT_START", "":
			// 按上游协议继续轮询；空状态也可能出现在任务刚写入队列时。
		default:
			return nil, fmt.Errorf("NewAPI 渠道 2 任务 %s 返回未知状态：%s", id, status)
		}
		if err := sleepContext(ctx, newAPIChannel2VideoPollInterval); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("NewAPI 渠道 2 视频生成超时（任务 %s）", id)
}

func newAPIChannel2VideoBody(input canvasGenerationInput) (map[string]interface{}, error) {
	if len(input.ReferenceVideos) > 0 || len(input.ReferenceAudios) > 0 {
		return nil, errors.New("NewAPI 渠道 2 只支持参考图片，不支持参考视频或音频")
	}
	modelName := strings.ToLower(strings.TrimSpace(input.Config.Model))
	requiresSingleImage := modelName == "grok-video-1.5" || modelName == "grok-video-1.5-1080p"
	images := make([]string, 0, len(input.ReferenceImages))
	// 单图模型以实际参考图为准，兼容旧画布中未随连接关系更新的 text_to_video 元数据。
	if shouldSendNewAPIVideoImages(input) || requiresSingleImage {
		for _, image := range input.ReferenceImages {
			url, err := openAIImageInputURL(image)
			if err != nil {
				return nil, err
			}
			images = append(images, url)
		}
	}
	if len(images) > 7 {
		return nil, errors.New("NewAPI 渠道 2 最多支持 7 张参考图")
	}
	if requiresSingleImage {
		if len(images) != 1 {
			return nil, fmt.Errorf("NewAPI 渠道 2 的 %s 必须且只能提供 1 张参考图（当前 %d 张）", input.Config.Model, len(images))
		}
	}

	seconds, secondsErr := strconv.Atoi(strings.TrimSpace(input.Config.VideoSeconds))
	if secondsErr != nil || seconds < 1 {
		seconds = 6
	}
	if len(images) > 1 && seconds > 10 {
		seconds = 10
	} else if seconds > 15 {
		seconds = 15
	}
	ratio := normalizeNewAPIChannel2Ratio(input.Config.Size, modelName)
	resolution := normalizeNewAPIChannel2Resolution(input.Config.VQuality, modelName)
	body := map[string]interface{}{
		"model":        input.Config.Model,
		"prompt":       strings.TrimSpace(input.Prompt),
		"seconds":      seconds,
		"aspect_ratio": ratio,
		"resolution":   resolution,
	}
	if len(images) > 0 {
		body["image_urls"] = images
	}
	return body, nil
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
		return nil, fmt.Errorf("NewAPI 渠道 1 视频生成失败（任务 %s）：%s", id, strings.TrimSpace(strings.TrimPrefix(status, "FAILED:")))
	}
	if id == "" {
		return nil, errors.New("NewAPI 渠道 1 没有返回任务 ID")
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
				return nil, fmt.Errorf("NewAPI 渠道 1 任务 %s 已完成但没有返回视频 URL", id)
			}
			data, mimeType, err := getExternalBinary(ctx, videoURL)
			if err != nil {
				return nil, fmt.Errorf("NewAPI 渠道 1 视频结果下载失败（任务 %s）：%w", id, err)
			}
			return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
		case strings.HasPrefix(status, "FAILED"):
			message := strings.TrimSpace(strings.TrimPrefix(status, "FAILED:"))
			return nil, fmt.Errorf("NewAPI 渠道 1 视频生成失败（任务 %s）：%s", id, defaultString(message, "上游返回失败"))
		}
		if err := sleepContext(ctx, newAPIChannel1VideoPollInterval); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("NewAPI 渠道 1 视频生成超时（任务 %s）", id)
}

func newAPIChannel1VideoBody(input canvasGenerationInput) (map[string]interface{}, error) {
	if len(input.ReferenceImages) > 9 || len(input.ReferenceVideos) > 3 || len(input.ReferenceAudios) > 3 {
		return nil, errors.New("NewAPI 渠道 1 最多支持 9 张参考图、3 个参考视频和 3 个参考音频")
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
	body := map[string]interface{}{
		"model": input.Config.Model,
		"input": map[string]interface{}{"prompt": strings.TrimSpace(input.Prompt)},
		"parameters": map[string]interface{}{
			"resolution":    normalizeNewAPIChannel1Resolution(input.Config.VQuality),
			"ratio":         normalizeNewAPIChannel1Ratio(input.Config.Size),
			"prompt_extend": false,
			"watermark":     parseBool(input.Config.VideoWatermark, false),
			"duration":      normalizeSeedanceVideosDuration(input.Config.VideoSeconds),
		},
	}
	if len(media) > 0 {
		body["input"].(map[string]interface{})["media"] = media
	}
	return body, nil
}

func newAPIChannel1MediaURL(media providerMedia) (string, error) {
	value := strings.TrimSpace(media.URL)
	if !isPublicMediaURL(value) {
		return "", errors.New("NewAPI 渠道 1 的参考素材必须使用公网 HTTP(S) URL，请启用 OSS 或提供公网素材地址")
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
		"image": {"openai-image": true},
		"video": {"newapi": true, "newapi-channel-1": true, "newapi-channel-2": true, "xai-video": true},
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
				data, mimeType, err := getExternalBinary(ctx, videoURL)
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
	id := resumedProviderRequestID(ctx)
	var created map[string]interface{}
	if id == "" {
		content, err := seedanceContent(input)
		if err != nil {
			return nil, err
		}
		body := map[string]interface{}{
			"model":          input.Config.Model,
			"content":        content,
			"ratio":          normalizeSeedanceRatio(input.Config.Size),
			"resolution":     normalizeSeedanceResolution(input.Config.VQuality, input.Config.Model),
			"duration":       normalizeSeedanceDuration(input.Config.VideoSeconds),
			"generate_audio": parseBool(input.Config.VideoGenerateAudio, true),
			"watermark":      parseBool(input.Config.VideoWatermark, false),
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
		return nil, errors.New("Seedance 接口没有返回任务 ID")
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
				return nil, errors.New("Seedance 任务成功但没有返回视频 URL")
			}
			data, mimeType, err := getExternalBinary(ctx, videoURL)
			if err != nil {
				return nil, fmt.Errorf("视频结果下载失败：%w", err)
			}
			return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
		}
		if status == "failed" || status == "cancelled" || status == "expired" {
			return nil, errors.New("Seedance 视频生成失败")
		}
		if err := sleepContext(ctx, 5*time.Second); err != nil {
			return nil, err
		}
	}
	return nil, errors.New("Seedance 视频生成超时")
}

func postJSON(ctx context.Context, config providerConfig, path string, body interface{}, target interface{}) error {
	data, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL(config.BaseURL, path), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	return doJSON(req, target)
}

func postForm(ctx context.Context, config providerConfig, path string, contentType string, body io.Reader, target interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL(config.BaseURL, path), body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	req.Header.Set("Content-Type", contentType)
	return doJSON(req, target)
}

func getJSON(ctx context.Context, config providerConfig, path string, target interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL(config.BaseURL, path), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
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
	return doBinary(req)
}

func getBinary(ctx context.Context, config providerConfig, path string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL(config.BaseURL, path), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	return doBinary(req)
}

func getExternalBinary(ctx context.Context, rawURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	return doBinary(req)
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
	log := model.ApiCallLog{
		UserID: metadata.UserID, ChannelID: metadata.ChannelID, TaskID: metadata.TaskID, BillingOrderID: metadata.BillingOrderID,
		Source: "backend-task", Capability: metadata.Capability, Operation: metadata.Operation,
		RequestKind: requestKind, Billable: req.Method == http.MethodPost,
		APIFormat: "openai", Method: req.Method, Path: req.URL.Path, Model: metadata.Model,
		Status: status, StatusCode: statusCode, DurationMs: time.Since(startedAt).Milliseconds(),
		Error: errorText, ConcurrencyLimit: metadata.ConcurrencyLimit, UpstreamURL: req.URL.Scheme + "://" + req.URL.Host + req.URL.Path,
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
	imageURLs := make([]string, 0, len(input.ReferenceImages))
	for _, image := range input.ReferenceImages {
		url, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		imageURLs = append(imageURLs, url)
	}
	if frameImageURLs := seedanceVideosFrameImageURLs(input, imageURLs); len(frameImageURLs) > 0 {
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

func seedanceVideosFrameImageURLs(input canvasGenerationInput, imageURLs []string) []string {
	startFrameID := metadataString(input.Metadata, "videoStartFrameNodeId")
	endFrameID := metadataString(input.Metadata, "videoEndFrameNodeId")
	if startFrameID == "" && endFrameID == "" {
		return nil
	}
	// /v1/videos 的 image_urls 只接受字符串；首帧和尾帧通过数组顺序表达。
	ordered := make([]string, 0, len(imageURLs))
	used := make([]bool, len(imageURLs))
	appendFrame := func(frameID string) {
		if frameID == "" {
			return
		}
		for index, image := range input.ReferenceImages {
			if index >= len(imageURLs) || used[index] || image.ID != frameID {
				continue
			}
			ordered = append(ordered, imageURLs[index])
			used[index] = true
			return
		}
	}
	appendFrame(startFrameID)
	appendFrame(endFrameID)
	for index, imageURL := range imageURLs {
		if !used[index] {
			ordered = append(ordered, imageURL)
		}
	}
	return ordered
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
	if value == "" || value == "auto" || strings.Contains(value, ":") {
		return ""
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
	if duration > 15 {
		return 15
	}
	return duration
}

func normalizeXAIVideoResolution(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "480", "480p", "low":
		return "480p"
	case "1080", "1080p":
		return "1080p"
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
	if err != nil || seconds == 0 {
		seconds = 5
	}
	if seconds < 4 {
		return 4
	}
	if seconds > 15 {
		return 15
	}
	return seconds
}

func normalizeSeedanceVideosDuration(value string) int {
	seconds := normalizeSeedanceDuration(value)
	if seconds < 4 {
		return 5
	}
	return seconds
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
	switch resolution {
	case "480", "720", "1080":
	default:
		if value == "low" {
			resolution = "480"
		} else {
			resolution = "720"
		}
	}
	if strings.Contains(strings.ToLower(model), "fast") && resolution == "1080" {
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
