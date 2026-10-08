// 声明式协议插件的请求组装：请求体（JSON/表单/二进制）、媒体引用与 URL。

package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func protocolRequestFromInput(input canvasGenerationInput) protocol.GenerationRequest {
	resolution := strings.TrimSpace(input.Config.VQuality)
	if input.Mode == "video" {
		if declared := videoResolutionNameRequest(input.VideoCapability, resolution); declared != "" {
			resolution = declared
		}
	}
	aspectRatio := input.Config.Size
	if input.Mode == "image" && strings.TrimSpace(input.Config.InterfaceType) == string(model.ChannelInterfaceOpenAIImage) {
		aspectRatio = normalizePixelSize(aspectRatio)
	}
	request := protocol.GenerationRequest{
		Capability:    protocol.Capability(input.Mode),
		Model:         input.Config.Model,
		Prompt:        input.Prompt,
		Instructions:  strings.TrimSpace(input.Config.SystemPrompt),
		Images:        protocolImageReferences(input),
		Videos:        protocolMediaReferences(input.ReferenceVideos, "video"),
		Audios:        protocolMediaReferences(input.ReferenceAudios, "audio"),
		AspectRatio:   aspectRatio,
		Resolution:    resolution,
		Quality:       input.Config.Quality,
		GenerateAudio: parseBool(input.Config.VideoGenerateAudio, false),
		Watermark:     parseBool(input.Config.VideoWatermark, false),
		Operation:     firstNonEmpty(metadataString(input.Metadata, "videoEditOperation"), metadataString(input.Metadata, "videoOperation")),
		Extra: map[string]any{
			"videoSeconds":      input.Config.VideoSeconds,
			"audioVoice":        input.Config.AudioVoice,
			"audioFormat":       input.Config.AudioFormat,
			"audioSpeed":        input.Config.AudioSpeed,
			"audioInstructions": input.Config.AudioInstructions,
			"audioLanguage":     input.Config.AudioLanguage,
			"audioDialect":      input.Config.AudioDialect,
			"count":             input.Config.Count,
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
	if input.Mode == "image" && input.Config.InterfaceType == string(model.ChannelInterfaceGrokImage) {
		options := make(map[string]any)
		for name, value := range request.ProviderOptions[input.Config.InterfaceType] {
			options[name] = value
		}
		options["response_format"] = grokImageResponseFormat(input.ImageCapability)
		request.ProviderOptions[input.Config.InterfaceType] = options
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
	return executeProtocolBinaryRequestWithConsumer(ctx, config, spec, nil)
}

func executeProtocolBinaryRequestWithConsumer(ctx context.Context, config providerConfig, spec protocol.RequestSpec, consume func(string, []byte)) ([]byte, string, error) {
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
	if consume != nil {
		req.Header.Set("Accept", "text/event-stream")
		return doBinaryWithConsumer(req, consume)
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
