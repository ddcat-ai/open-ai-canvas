package app

// 声明式协议插件宿主与接口类型校验。

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/textproto"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"

	"github.com/google/uuid"
	"github.com/volcengine/volc-sdk-golang/base"
)

// runDeclarativeProtocolTask 是 JSON manifest 插件的宿主运行时。
// manifest 只能描述请求/响应映射；凭证、出站安全策略、轮询和结果下载必须由宿主统一掌握，
// 这样插件不能绕过服务端的鉴权、超时和 SSRF 防护边界。
func runDeclarativeProtocolTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	adapter, ok := declarativeProtocolAdapterForContext(ctx, input.Config.InterfaceType)
	if !ok {
		return nil, fmt.Errorf("接口类型 %s 未安装声明式适配器", input.Config.InterfaceType)
	}
	return runProtocolAdapterTask(ctx, input, adapter)
}

type protocolPollTiming struct {
	InitialDelay            time.Duration
	PollInterval            time.Duration
	TaskNotExistWindow      time.Duration
	TaskNotExistMaxMisses   int
	TaskNotExistRetryDelays []time.Duration
}

var defaultProtocolPollTiming = protocolPollTiming{
	InitialDelay:            2 * time.Second,
	PollInterval:            2500 * time.Millisecond,
	TaskNotExistWindow:      15 * time.Second,
	TaskNotExistMaxMisses:   5,
	TaskNotExistRetryDelays: []time.Duration{2 * time.Second, 3 * time.Second, 5 * time.Second, 5 * time.Second},
}

func runProtocolAdapterTask(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter) (map[string]interface{}, error) {
	return runProtocolAdapterTaskWithTiming(ctx, input, adapter, defaultProtocolPollTiming)
}

func runProtocolAdapterTaskWithTiming(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter, timing protocolPollTiming) (map[string]interface{}, error) {
	// create、poll、download 是同一个外部任务的三个阶段：任一阶段失败都向上返回真实错误，
	// 不把“已提交但结果未知”伪装成成功，也不把下载失败降级成空结果。
	request := protocolRequestFromInput(input)
	taskID := resumedProviderRequestID(ctx)
	var created protocol.CreateResult
	createdProviderTask := false
	syncWindowStartedAt := time.Now()
	if taskID == "" {
		// 幂等键只存在于宿主请求元数据中，声明式插件可以把它映射到 Header，
		// 但不能把宿主控制字段泄漏到供应商 JSON body。恢复已有 taskID 时不会进入 create 分支。
		request.Extra["idempotencyKey"] = uuid.NewString()
		spec, err := adapter.BuildCreate(ctx, protocol.RequestContext{BaseURL: input.Config.BaseURL, Request: request})
		if err != nil {
			return nil, err
		}
		body, err := executeProtocolRequest(withProviderRequestKind(ctx, "create"), input.Config, spec)
		if err != nil {
			return nil, err
		}
		created, err = adapter.ParseCreate(ctx, body)
		if err != nil {
			return nil, err
		}
		taskID = created.TaskID
		if taskID == "" {
			extracted, extractErr := extractProviderTaskID(body)
			if extractErr != nil {
				return nil, extractErr
			}
			taskID = extracted
		}
		if created.Status == protocol.StatusFailed || created.Status == protocol.StatusCancelled {
			return nil, protocolResultError(created.Message, taskID)
		}
		if created.Status == protocol.StatusSucceeded {
			return finishProtocolAdapterResult(ctx, input, adapter, request, taskID, created.Result)
		}
		if taskID == "" {
			return nil, errors.New("声明式协议创建请求没有返回任务 ID")
		}
		createdProviderTask = true
		syncWindowStartedAt = time.Now()
	}
	if createdProviderTask && input.Config.InterfaceType == string(model.ChannelInterfaceNewAPIChannel2) {
		if err := sleepContext(ctx, timing.InitialDelay); err != nil {
			return nil, err
		}
	}

	taskNotExistMisses := 0
	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		spec, err := adapter.BuildPoll(ctx, protocol.PollContext{BaseURL: input.Config.BaseURL, Model: request.Model, Request: request, TaskID: taskID})
		if err != nil {
			return nil, err
		}
		body, err := executeProtocolRequest(withProviderRequestKind(ctx, "poll"), input.Config, spec)
		if err != nil {
			if isNewAPIChannel2TaskNotReady(input.Config.InterfaceType, taskID, err) {
				// NewAPI Channel 2 创建后存在短暂同步窗口。窗口内的 task_not_exist 只表示尚未可查；
				// 超过窗口仍不可查时返回 pending error，让上层保留任务 ID，而不是误判成功或失败。
				taskNotExistMisses++
				maxMisses := timing.TaskNotExistMaxMisses
				if maxMisses <= 0 {
					maxMisses = len(timing.TaskNotExistRetryDelays) + 1
				}
				if time.Since(syncWindowStartedAt) >= timing.TaskNotExistWindow || taskNotExistMisses >= maxMisses {
					return nil, providerStatePendingError{TaskID: taskID, Cause: err}
				}
				delayIndex := min(taskNotExistMisses-1, len(timing.TaskNotExistRetryDelays)-1)
				if delayIndex >= 0 {
					if sleepErr := sleepContext(ctx, timing.TaskNotExistRetryDelays[delayIndex]); sleepErr != nil {
						return nil, sleepErr
					}
				}
				continue
			}
			return nil, err
		}
		taskNotExistMisses = 0
		state, err := adapter.ParsePoll(ctx, protocol.PollContext{BaseURL: input.Config.BaseURL, Model: request.Model, Request: request, TaskID: taskID}, body)
		if err != nil {
			return nil, err
		}
		if state.TaskID != "" {
			taskID = state.TaskID
		}
		switch state.Status {
		case protocol.StatusSucceeded:
			return finishProtocolAdapterResult(ctx, input, adapter, request, taskID, state.Result)
		case protocol.StatusFailed, protocol.StatusCancelled:
			return nil, protocolResultError(state.Message, taskID)
		}
		if err := sleepContext(ctx, timing.PollInterval); err != nil {
			return nil, err
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return nil, fmt.Errorf("声明式协议任务超时（任务 %s）", taskID)
}

func extractProviderTaskID(body []byte) (string, error) {
	var payload map[string]interface{}
	if json.Unmarshal(body, &payload) != nil {
		return "", nil
	}
	id, err := firstJSONString(payload, "id", "task_id", "taskId", "request_id", "name")
	if id != "" {
		return id, nil
	}
	if data, ok := payload["data"].(map[string]interface{}); ok {
		nested, nestedErr := firstJSONString(data, "id", "task_id", "taskId", "request_id")
		if nested != "" {
			return nested, nil
		}
		if nestedErr != nil {
			return "", nestedErr
		}
	}
	return "", err
}

func isNewAPIChannel2TaskNotReady(interfaceType string, taskID string, err error) bool {
	if strings.TrimSpace(interfaceType) != string(model.ChannelInterfaceNewAPIChannel2) || strings.TrimSpace(taskID) == "" {
		return false
	}
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusBadRequest {
		return false
	}
	var payload map[string]any
	if json.Unmarshal([]byte(httpErr.Body), &payload) != nil {
		return false
	}
	code, message := providerFailureDetails(payload)
	return strings.EqualFold(strings.TrimSpace(code), "task_not_exist") || strings.EqualFold(strings.TrimSpace(message), "task_not_exist")
}

// queryProtocolAdapterVideoTask 只读取一次已有的声明式 Provider 任务。
// 人工恢复走此路径，因此检查本地失败任务时绝不会创建第二个计费任务。
func queryProtocolAdapterVideoTask(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter, taskID string) (map[string]interface{}, string, error) {
	request := protocolRequestFromInput(input)
	pollContext := protocol.PollContext{BaseURL: input.Config.BaseURL, Model: request.Model, Request: request, TaskID: taskID}
	spec, err := adapter.BuildPoll(ctx, pollContext)
	if err != nil {
		return nil, "", err
	}
	body, err := executeProtocolRequest(withProviderRequestKind(ctx, "poll"), input.Config, spec)
	if err != nil {
		return nil, "", err
	}
	state, err := adapter.ParsePoll(ctx, pollContext, body)
	if err != nil {
		return nil, "", err
	}
	providerStatus := string(state.Status)
	switch state.Status {
	case protocol.StatusSucceeded:
		result, err := finishProtocolAdapterResult(ctx, input, adapter, request, taskID, state.Result)
		return result, providerStatus, err
	case protocol.StatusFailed, protocol.StatusCancelled:
		return nil, providerStatus, protocolResultError(state.Message, taskID)
	case protocol.StatusPending, protocol.StatusProcessing:
		return nil, providerStatus, nil
	default:
		return nil, providerStatus, fmt.Errorf("声明式协议任务 %s 返回未知状态：%s", taskID, providerStatus)
	}
}

func protocolRequestFromInput(input canvasGenerationInput) protocol.GenerationRequest {
	resolution := strings.TrimSpace(input.Config.VQuality)
	if input.Mode == "video" {
		if declared := videoResolutionNameRequest(input.VideoCapability, resolution); declared != "" {
			resolution = declared
		}
	}
	request := protocol.GenerationRequest{
		Capability:    protocol.Capability(input.Mode),
		Model:         input.Config.Model,
		Prompt:        input.Prompt,
		Instructions:  strings.TrimSpace(input.Config.SystemPrompt),
		Images:        protocolImageReferences(input),
		Videos:        protocolMediaReferences(input.ReferenceVideos, "video"),
		Audios:        protocolMediaReferences(input.ReferenceAudios, "audio"),
		AspectRatio:   input.Config.Size,
		Resolution:    resolution,
		Quality:       input.Config.Quality,
		GenerateAudio: parseBool(input.Config.VideoGenerateAudio, false),
		Watermark:     parseBool(input.Config.VideoWatermark, false),
		Operation:     firstNonEmpty(metadataString(input.Metadata, "videoEditOperation"), metadataString(input.Metadata, "videoOperation")),
		Extra: map[string]any{
			"videoSeconds": input.Config.VideoSeconds,
			"audioVoice":   input.Config.AudioVoice,
			"audioFormat":  input.Config.AudioFormat,
			"count":        input.Config.Count,
		},
	}
	for _, message := range input.TextHistory {
		role := strings.ToLower(strings.TrimSpace(message.Role))
		if role != "user" && role != "assistant" && role != "system" {
			continue
		}
		if content := strings.TrimSpace(message.Content); content != "" {
			request.Messages = append(request.Messages, protocol.Message{Role: role, Content: content})
		}
	}
	request.Inputs = append(request.Inputs, request.Images...)
	request.Inputs = append(request.Inputs, request.Videos...)
	request.Inputs = append(request.Inputs, request.Audios...)
	if input.MaxOutputTokens > 0 {
		request.Extra["max_output_tokens"] = input.MaxOutputTokens
		request.Extra["max_tokens"] = input.MaxOutputTokens
	}
	if duration, err := strconv.Atoi(strings.TrimSpace(input.Config.VideoSeconds)); err == nil && duration > 0 {
		request.Duration = duration
	}
	if count, err := strconv.Atoi(strings.TrimSpace(input.Config.Count)); err == nil && count > 0 {
		request.ImageCount = count
	}
	request.Output = protocol.OutputOptions{
		Count: request.ImageCount, Duration: request.Duration, AspectRatio: request.AspectRatio,
		Resolution: request.Resolution, Quality: request.Quality, GenerateAudio: request.GenerateAudio,
		Watermark: request.Watermark, Format: input.Config.AudioFormat,
	}
	request.ProviderOptions = make(map[string]map[string]any)
	if configured, ok := input.Metadata["providerOptions"].(map[string]any); ok {
		for namespace, raw := range configured {
			if options, ok := raw.(map[string]any); ok {
				request.ProviderOptions[strings.TrimSpace(namespace)] = options
			}
		}
	}
	return request
}

func protocolImageReferences(input canvasGenerationInput) []protocol.MediaReference {
	if input.Mode == "video" {
		return protocolVideoImageReferences(input)
	}
	result := make([]protocol.MediaReference, 0, len(input.ReferenceImages)+1)
	for index, value := range input.ReferenceImages {
		item := protocolMediaReference(value, "image", index)
		item.Role = "reference_image"
		if input.Mode == "image" {
			item.Role = "edit_source"
		}
		if item.URL != "" || item.DataURL != "" {
			result = append(result, item)
		}
	}
	if input.Mask != nil {
		mask := protocolMediaReference(*input.Mask, "image", len(result))
		mask.Role = "mask"
		if mask.URL != "" || mask.DataURL != "" {
			result = append(result, mask)
		}
	}
	return result
}

func protocolVideoImageReferences(input canvasGenerationInput) []protocol.MediaReference {
	result := make([]protocol.MediaReference, 0, len(input.ReferenceImages))
	fallbackRole := ""
	if metadataString(input.Metadata, "videoStartFrameNodeId") != "" || metadataString(input.Metadata, "videoEndFrameNodeId") != "" {
		fallbackRole = "reference_image"
	}
	for index, value := range input.ReferenceImages {
		item := protocolMediaReference(value, "image", index)
		item.Role = videoImageRoleOrDefault(input, value, fallbackRole)
		if item.URL != "" || item.DataURL != "" {
			result = append(result, item)
		}
	}
	return result
}

func protocolMediaReferences(values []providerMedia, kind string) []protocol.MediaReference {
	result := make([]protocol.MediaReference, 0, len(values))
	for index, value := range values {
		item := protocolMediaReference(value, kind, index)
		if kind == "video" {
			item.Role = "reference_video"
		} else if kind == "audio" {
			item.Role = "reference_audio"
		}
		if item.URL != "" || item.DataURL != "" {
			result = append(result, item)
		}
	}
	return result
}

func protocolMediaReference(value providerMedia, kind string, order int) protocol.MediaReference {
	return protocol.MediaReference{
		ID: strings.TrimSpace(value.ID), URL: strings.TrimSpace(value.URL), DataURL: strings.TrimSpace(value.DataURL),
		Kind: kind, MIMEType: firstNonEmpty(strings.TrimSpace(value.MimeType), strings.TrimSpace(value.Type)), Name: strings.TrimSpace(value.Name), Order: order,
		Metadata: map[string]any{"bytes": value.Bytes, "width": value.Width, "height": value.Height, "durationMs": value.DurationMs, "storageKey": strings.TrimSpace(value.StorageKey)},
	}
}

func executeProtocolRequest(ctx context.Context, config providerConfig, spec protocol.RequestSpec) ([]byte, error) {
	data, _, err := executeProtocolBinaryRequest(ctx, config, spec)
	return data, err
}

// executeProtocolBinaryRequest 是声明式插件与宿主网络能力之间的边界。manifest 只能声明
// method/path/body/auth；最终 URL 校验、凭证注入、SSRF、超时、大小限制和审计仍由宿主统一执行，
// 插件不能通过自定义请求规格绕过这些安全约束。
func executeProtocolBinaryRequest(ctx context.Context, config providerConfig, spec protocol.RequestSpec) ([]byte, string, error) {
	if err := spec.Validate(); err != nil {
		return nil, "", err
	}
	method := strings.ToUpper(strings.TrimSpace(spec.Method))
	body, contentType, err := protocolRequestBody(ctx, config, spec)
	if err != nil {
		return nil, "", err
	}
	requestURL, err := protocolRequestURL(config.BaseURL, spec)
	if err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, method, requestURL, body)
	if err != nil {
		return nil, "", err
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for name, value := range spec.Headers {
		req.Header.Set(name, value)
	}
	ApplyOutboundHeaders(req, config.Headers)
	if err := applyProtocolAuth(req, config, spec.Auth); err != nil {
		return nil, "", err
	}
	return doBinary(req)
}

func protocolRequestBody(ctx context.Context, config providerConfig, spec protocol.RequestSpec) (io.Reader, string, error) {
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(spec.ContentType, ";")[0]))
	if spec.Body == nil && len(spec.Files) == 0 {
		return nil, "", nil
	}
	switch contentType {
	case "", "application/json":
		data, err := json.Marshal(spec.Body)
		if err != nil {
			return nil, "", err
		}
		return bytes.NewReader(data), "application/json", nil
	case "application/x-www-form-urlencoded":
		values := url.Values{}
		for key, value := range protocolBodyObject(spec.Body) {
			for _, item := range protocolFormValues(value) {
				values.Add(key, item)
			}
		}
		return strings.NewReader(values.Encode()), contentType, nil
	case "multipart/form-data":
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		keys := make([]string, 0)
		for key := range protocolBodyObject(spec.Body) {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			for _, item := range protocolFormValues(protocolBodyObject(spec.Body)[key]) {
				if err := writer.WriteField(key, item); err != nil {
					_ = writer.Close()
					return nil, "", err
				}
			}
		}
		for _, file := range spec.Files {
			data, detectedMIME, err := protocolMediaBytes(ctx, config, file.Reference)
			if err != nil {
				_ = writer.Close()
				return nil, "", fmt.Errorf("读取 multipart 文件 %s 失败：%w", file.Name, err)
			}
			filename := safeProtocolFilename(file.Filename)
			mimeType := strings.TrimSpace(file.MIMEType)
			if mimeType == "" {
				mimeType = detectedMIME
			}
			header := make(textproto.MIMEHeader)
			header.Set("Content-Disposition", fmt.Sprintf(`form-data; name=%q; filename=%q`, file.Name, filename))
			header.Set("Content-Type", defaultString(mimeType, "application/octet-stream"))
			part, err := writer.CreatePart(header)
			if err != nil {
				_ = writer.Close()
				return nil, "", err
			}
			if _, err := part.Write(data); err != nil {
				_ = writer.Close()
				return nil, "", err
			}
		}
		if err := writer.Close(); err != nil {
			return nil, "", err
		}
		return bytes.NewReader(body.Bytes()), writer.FormDataContentType(), nil
	case "application/octet-stream":
		switch value := spec.Body.(type) {
		case []byte:
			return bytes.NewReader(value), contentType, nil
		case string:
			if strings.HasPrefix(value, "data:") {
				mimeType, data, err := decodeProviderDataURL(value)
				if err != nil {
					return nil, "", err
				}
				return bytes.NewReader(data), defaultString(mimeType, contentType), nil
			}
			return strings.NewReader(value), contentType, nil
		default:
			return nil, "", fmt.Errorf("二进制协议请求体必须是字节或字符串")
		}
	default:
		return nil, "", fmt.Errorf("声明式协议暂不支持 %s 请求体", spec.ContentType)
	}
}

func protocolBodyObject(value any) map[string]any {
	result, _ := value.(map[string]any)
	return result
}

func protocolFormValues(value any) []string {
	switch typed := value.(type) {
	case nil:
		return nil
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			result = append(result, protocolFormValues(item)...)
		}
		return result
	case string:
		return []string{typed}
	case bool:
		return []string{strconv.FormatBool(typed)}
	case float64:
		return []string{strconv.FormatFloat(typed, 'f', -1, 64)}
	case int:
		return []string{strconv.Itoa(typed)}
	default:
		data, err := json.Marshal(typed)
		if err != nil {
			return nil
		}
		return []string{string(data)}
	}
}

func safeProtocolFilename(value string) string {
	value = strings.TrimSpace(value)
	if index := strings.LastIndexAny(value, `/\\`); index >= 0 {
		value = value[index+1:]
	}
	value = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 || r == '"' {
			return -1
		}
		return r
	}, value)
	if value == "" {
		return "upload.bin"
	}
	return value
}

func applyProtocolAuth(req *http.Request, config providerConfig, auth protocol.ManifestAuth) error {
	typeName := strings.ToLower(strings.TrimSpace(auth.Type))
	if typeName == "" {
		applyProviderAuth(req, config)
		return nil
	}
	credential := protocolCredentialField(config, auth.Field)
	switch typeName {
	case "none":
		return nil
	case "bearer":
		header := defaultString(strings.TrimSpace(auth.Header), "Authorization")
		prefix := auth.Prefix
		if prefix == "" {
			prefix = "Bearer "
		}
		req.Header.Set(header, prefix+credential)
		return nil
	case "header", "api-key", "apikey":
		header := strings.TrimSpace(auth.Header)
		if header == "" {
			return errors.New("插件 header 鉴权缺少 header 名称")
		}
		req.Header.Set(header, auth.Prefix+credential)
		return nil
	case "query":
		name := defaultString(strings.TrimSpace(auth.Query), strings.TrimSpace(auth.Field))
		if name == "" {
			return errors.New("插件 query 鉴权缺少参数名")
		}
		query := req.URL.Query()
		query.Set(name, auth.Prefix+credential)
		req.URL.RawQuery = query.Encode()
		return nil
	case "basic":
		username := auth.Username
		if username == "" {
			username = credential
		}
		password := protocolCredentialField(config, auth.SecretField)
		req.SetBasicAuth(username, password)
		return nil
	case "anthropic":
		req.Header.Set(defaultString(auth.Header, "x-api-key"), credential)
		if req.Header.Get("anthropic-version") == "" {
			req.Header.Set("anthropic-version", "2023-06-01")
		}
		return nil
	case "google-api-key", "gemini":
		req.Header.Set(defaultString(auth.Header, "x-goog-api-key"), credential)
		return nil
	case "volcengine-v4":
		secret := protocolCredentialField(config, auth.SecretField)
		if credential == "" || secret == "" {
			return errors.New("火山引擎 V4 鉴权需要 Access Key 和 Secret Key")
		}
		credentials := base.Credentials{
			AccessKeyID: credential, SecretAccessKey: secret,
			Region:  defaultString(strings.TrimSpace(auth.Region), "cn-north-1"),
			Service: strings.TrimSpace(auth.Service),
		}
		if credentials.Service == "" {
			return errors.New("火山引擎 V4 鉴权缺少 service")
		}
		signed := credentials.Sign(req)
		*req = *signed
		return nil
	case "aws-sigv4":
		secret := protocolCredentialField(config, auth.SecretField)
		return signProtocolAWSV4(req, credential, secret, auth)
	case "tc3":
		secret := protocolCredentialField(config, auth.SecretField)
		return signProtocolTC3(req, credential, secret, auth)
	default:
		return fmt.Errorf("插件声明了尚未启用的鉴权驱动 %s", auth.Type)
	}
}

func signProtocolAWSV4(req *http.Request, accessKey, secretKey string, auth protocol.ManifestAuth) error {
	if strings.TrimSpace(accessKey) == "" || strings.TrimSpace(secretKey) == "" {
		return errors.New("AWS SigV4 鉴权需要 Access Key ID 和 Secret Access Key")
	}
	serviceName := defaultString(strings.TrimSpace(auth.Service), "bedrock")
	region := strings.TrimSpace(auth.Region)
	if region == "" {
		parts := strings.Split(strings.ToLower(req.URL.Hostname()), ".")
		for index, part := range parts {
			if strings.HasPrefix(part, serviceName) && index+1 < len(parts) {
				region = parts[index+1]
				break
			}
		}
	}
	if region == "" {
		return errors.New("AWS SigV4 鉴权无法从 Base URL 推断 region，请使用包含区域的 Bedrock Runtime 地址")
	}
	payload, err := protocolRequestPayload(req)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	payloadHash := sha256Hex(payload)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	canonicalHeaders, signedHeaders := protocolCanonicalHeaders(req)
	canonicalRequest := strings.Join([]string{
		req.Method,
		defaultString(req.URL.EscapedPath(), "/"),
		req.URL.Query().Encode(),
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")
	scope := strings.Join([]string{dateStamp, region, serviceName, "aws4_request"}, "/")
	stringToSign := strings.Join([]string{"AWS4-HMAC-SHA256", amzDate, scope, sha256Hex([]byte(canonicalRequest))}, "\n")
	dateKey := protocolHMAC([]byte("AWS4"+secretKey), dateStamp)
	regionKey := protocolHMAC(dateKey, region)
	serviceKey := protocolHMAC(regionKey, serviceName)
	signingKey := protocolHMAC(serviceKey, "aws4_request")
	signature := hex.EncodeToString(protocolHMAC(signingKey, stringToSign))
	req.Header.Set("Authorization", fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s", accessKey, scope, signedHeaders, signature))
	return nil
}

func signProtocolTC3(req *http.Request, secretID, secretKey string, auth protocol.ManifestAuth) error {
	if strings.TrimSpace(secretID) == "" || strings.TrimSpace(secretKey) == "" {
		return errors.New("腾讯云 TC3 鉴权需要 SecretId 和 SecretKey")
	}
	serviceName := defaultString(strings.TrimSpace(auth.Service), "hunyuan")
	payload, err := protocolRequestPayload(req)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	timestamp := now.Unix()
	dateStamp := now.Format("2006-01-02")
	contentType := defaultString(req.Header.Get("Content-Type"), "application/json")
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-TC-Timestamp", strconv.FormatInt(timestamp, 10))
	if region := strings.TrimSpace(auth.Region); region != "" {
		req.Header.Set("X-TC-Region", region)
	}
	canonicalHeaders := "content-type:" + strings.ToLower(strings.TrimSpace(contentType)) + "\n" + "host:" + strings.ToLower(req.URL.Host) + "\n"
	signedHeaders := "content-type;host"
	canonicalRequest := strings.Join([]string{req.Method, defaultString(req.URL.EscapedPath(), "/"), req.URL.Query().Encode(), canonicalHeaders, signedHeaders, sha256Hex(payload)}, "\n")
	scope := dateStamp + "/" + serviceName + "/tc3_request"
	stringToSign := strings.Join([]string{"TC3-HMAC-SHA256", strconv.FormatInt(timestamp, 10), scope, sha256Hex([]byte(canonicalRequest))}, "\n")
	secretDate := protocolHMAC([]byte("TC3"+secretKey), dateStamp)
	secretService := protocolHMAC(secretDate, serviceName)
	secretSigning := protocolHMAC(secretService, "tc3_request")
	signature := hex.EncodeToString(protocolHMAC(secretSigning, stringToSign))
	req.Header.Set("Authorization", fmt.Sprintf("TC3-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s", secretID, scope, signedHeaders, signature))
	return nil
}

func protocolRequestPayload(req *http.Request) ([]byte, error) {
	if req.Body == nil {
		return nil, nil
	}
	var reader io.ReadCloser
	var err error
	if req.GetBody != nil {
		reader, err = req.GetBody()
	} else {
		reader = req.Body
	}
	if err != nil {
		return nil, err
	}
	data, err := io.ReadAll(reader)
	if req.GetBody != nil {
		_ = reader.Close()
	} else {
		req.Body = io.NopCloser(bytes.NewReader(data))
	}
	return data, err
}

func protocolCanonicalHeaders(req *http.Request) (string, string) {
	values := map[string]string{"host": strings.ToLower(req.URL.Host)}
	for name, entries := range req.Header {
		lower := strings.ToLower(strings.TrimSpace(name))
		if lower == "authorization" || lower == "user-agent" || lower == "content-length" || lower == "expect" {
			continue
		}
		cleaned := make([]string, 0, len(entries))
		for _, entry := range entries {
			cleaned = append(cleaned, strings.Join(strings.Fields(entry), " "))
		}
		values[lower] = strings.Join(cleaned, ",")
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var canonical strings.Builder
	for _, key := range keys {
		canonical.WriteString(key)
		canonical.WriteByte(':')
		canonical.WriteString(values[key])
		canonical.WriteByte('\n')
	}
	return canonical.String(), strings.Join(keys, ";")
}

func protocolHMAC(key []byte, value string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(value))
	return mac.Sum(nil)
}

func sha256Hex(value []byte) string {
	hash := sha256.Sum256(value)
	return hex.EncodeToString(hash[:])
}

func protocolCredentialField(config providerConfig, field string) string {
	switch strings.ToLower(strings.TrimSpace(field)) {
	case "secretkey", "secret_key", "secret":
		return strings.TrimSpace(config.SecretKey)
	default:
		return strings.TrimSpace(config.APIKey)
	}
}

func protocolRequestURL(baseURL string, spec protocol.RequestSpec) (string, error) {
	if !spec.OriginPath {
		return appendProtocolQuery(apiURL(baseURL, spec.Path), spec.Query)
	}
	base, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", fmt.Errorf("协议根路径请求的 Base URL 无效")
	}
	requestPath, err := url.Parse(spec.Path)
	if err != nil || !strings.HasPrefix(requestPath.Path, "/") {
		return "", fmt.Errorf("协议根路径请求必须使用绝对路径")
	}
	base.Path = requestPath.Path
	base.RawPath = requestPath.RawPath
	base.RawQuery = requestPath.RawQuery
	base.Fragment = ""
	return appendProtocolQuery(base.String(), spec.Query)
}

func appendProtocolQuery(rawURL string, values map[string][]string) (string, error) {
	if len(values) == 0 {
		return rawURL, nil
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	for key, items := range values {
		for _, item := range items {
			query.Add(key, item)
		}
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func finishProtocolResult(ctx context.Context, config providerConfig, mode string, result *protocol.Result) (map[string]interface{}, error) {
	if result == nil {
		return nil, errors.New("声明式协议已完成但没有返回结果")
	}
	if mode == "text" {
		output := map[string]interface{}{"mode": "text", "text": result.Text}
		if strings.TrimSpace(result.Reasoning) != "" {
			output["reasoning"] = result.Reasoning
		}
		return output, nil
	}
	var references []protocol.MediaReference
	switch mode {
	case "image":
		references = result.Images
	case "video":
		references = result.Videos
	case "audio":
		references = result.Audios
	default:
		return nil, fmt.Errorf("声明式协议不支持生成模式 %s", mode)
	}
	if len(references) == 0 {
		return nil, errors.New("声明式协议已完成但没有返回媒体地址")
	}
	items := make([]interface{}, 0, len(references))
	for _, reference := range references {
		data, mimeType, err := protocolMediaBytes(ctx, config, reference)
		if err != nil {
			return nil, err
		}
		item := map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}
		items = append(items, item)
	}
	switch mode {
	case "image":
		return map[string]interface{}{"mode": "image", "images": items}, nil
	case "video":
		return map[string]interface{}{"mode": "video", "video": items[0]}, nil
	default:
		return map[string]interface{}{"mode": "audio", "audio": items[0]}, nil
	}
}

// finishProtocolAdapterResult 优先消费 create/poll 已返回的内联或 URL 结果，只有插件明确声明独立结果端点时才下载。
// 空响应或下载失败必须向上失败，不能生成伪素材；application/octet-stream 仅表示传输层未知类型，
// 不会把未知内容伪装成具体图片、视频或音频 MIME。
func finishProtocolAdapterResult(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter, request protocol.GenerationRequest, taskID string, result *protocol.Result) (map[string]interface{}, error) {
	if protocolResultHasOutput(input.Mode, result) {
		return finishProtocolResult(ctx, input.Config, input.Mode, result)
	}
	resultAdapter, ok := adapter.(protocol.ResultAdapter)
	capability, hasCapability := adapter.(protocol.ResultCapability)
	if !ok || !hasCapability || !capability.ResultAvailable() {
		return finishProtocolResult(ctx, input.Config, input.Mode, result)
	}
	spec, err := resultAdapter.BuildResult(ctx, protocol.PollContext{BaseURL: input.Config.BaseURL, Model: request.Model, Request: request, TaskID: taskID})
	if err != nil {
		return nil, err
	}
	data, mimeType, err := executeProtocolBinaryRequest(withProviderRequestKind(ctx, "download"), input.Config, spec)
	if err != nil {
		return nil, fmt.Errorf("声明式协议结果下载失败：%w", err)
	}
	if len(data) == 0 {
		return nil, errors.New("声明式协议结果下载返回空内容")
	}
	mimeType = strings.TrimSpace(strings.Split(mimeType, ";")[0])
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	reference := protocol.MediaReference{DataURL: dataURL(mimeType, data), MIMEType: mimeType}
	downloaded := &protocol.Result{}
	switch input.Mode {
	case "image":
		downloaded.Images = []protocol.MediaReference{reference}
	case "video":
		downloaded.Videos = []protocol.MediaReference{reference}
	case "audio":
		downloaded.Audios = []protocol.MediaReference{reference}
	default:
		return nil, fmt.Errorf("声明式协议结果下载不支持生成模式 %s", input.Mode)
	}
	return finishProtocolResult(ctx, input.Config, input.Mode, downloaded)
}

func protocolResultHasOutput(mode string, result *protocol.Result) bool {
	if result == nil {
		return false
	}
	switch mode {
	case "text":
		return strings.TrimSpace(result.Text) != ""
	case "image":
		return len(result.Images) > 0
	case "video":
		return len(result.Videos) > 0
	case "audio":
		return len(result.Audios) > 0
	default:
		return false
	}
}

func protocolMediaBytes(ctx context.Context, config providerConfig, reference protocol.MediaReference) ([]byte, string, error) {
	if strings.TrimSpace(reference.DataURL) != "" {
		mimeType, data, err := decodeProviderDataURL(reference.DataURL)
		return data, mimeType, err
	}
	value := strings.TrimSpace(reference.URL)
	if value == "" {
		return nil, "", errors.New("声明式协议媒体结果地址为空")
	}
	var data []byte
	var mimeType string
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		data, mimeType, err = getProviderExternalBinary(withProviderRequestKind(ctx, "download"), config, value)
		if err == nil {
			return data, normalizedMediaMimeType(mimeType, data), nil
		}
		if attempt == 2 || !retryableProtocolMediaDownload(err) {
			break
		}
		if waitErr := sleepContext(ctx, time.Duration(attempt+1)*time.Second); waitErr != nil {
			return nil, "", fmt.Errorf("声明式协议媒体结果下载失败：%w", waitErr)
		}
	}
	return nil, "", fmt.Errorf("声明式协议媒体结果下载失败：%w", err)
}

func retryableProtocolMediaDownload(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var networkError net.Error
	if errors.As(err, &networkError) && (networkError.Timeout() || networkError.Temporary()) {
		return true
	}
	message := strings.ToLower(err.Error())
	for _, marker := range []string{"tls handshake timeout", "connection reset", "unexpected eof", "broken pipe"} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func protocolResultError(message, taskID string) error {
	message = strings.TrimSpace(message)
	if message == "" {
		message = "上游返回失败状态"
	}
	if taskID == "" {
		return errors.New(message)
	}
	return fmt.Errorf("声明式协议任务失败（任务 %s）：%s", taskID, message)
}

func validateGenerationInterface(mode string, interfaceType string) error {
	// Standalone callers (including legacy tests and migration tools) may not
	// have a Service/plugin runtime. Use the shipped declarative catalog first;
	// fall back to host builtins only when the package catalog is unavailable.
	registry := loadOfficialFallbackRegistry()
	if registry == nil {
		registry = protocol.Builtins()
	} else if _, ok := registry.Resolve(strings.TrimSpace(interfaceType)); !ok {
		// A deployment may ship only a subset of the optional plugin catalog.
		// Preserve the host-backed builtins for standalone validation instead of
		// reporting a false "not installed" error for those interfaces.
		if _, builtinOK := protocol.Builtins().Resolve(strings.TrimSpace(interfaceType)); builtinOK {
			registry = protocol.Builtins()
		}
	}
	return validateGenerationInterfaceWithRegistry(registry, mode, interfaceType)
}

func (s *Service) validateGenerationInterface(mode string, interfaceType string) error {
	return validateGenerationInterfaceWithRegistry(s.protocolRegistry(), mode, interfaceType)
}

func validateGenerationInterfaceWithRegistry(registry *protocol.Registry, mode string, interfaceType string) error {
	interfaceType = strings.TrimSpace(interfaceType)
	if interfaceType == "" {
		return nil
	}
	adapter, ok := registry.Resolve(interfaceType)
	if !ok {
		return fmt.Errorf("接口类型 %s 未安装", interfaceType)
	}
	metadata := adapter.Metadata()
	if !metadata.Enabled || metadata.UnavailableReason != "" {
		return fmt.Errorf("接口类型 %s 当前不可用：%s", interfaceType, metadata.UnavailableReason)
	}
	if mode != "" && !protocolCapabilityMatches(metadata, protocol.Capability(mode)) {
		return fmt.Errorf("接口类型 %s 不支持%s生成", interfaceType, mode)
	}
	return nil
}

func protocolCapabilityMatches(metadata protocol.Metadata, capability protocol.Capability) bool {
	for _, item := range metadata.Categories {
		if item == capability {
			return true
		}
	}
	return false
}
