// 声明式插件请求的求值：把清单里的表达式、查询、文件与变换（transform）
// 代入任务输入，得到最终请求。所有取值都经过白名单路径与类型规范化。

package protocol

import (
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

func buildManifestOperation(operation ManifestOperation, auth ManifestAuth, request GenerationRequest, taskID string) (RequestSpec, error) {
	requestValues := manifestRequestValues(request)
	env := map[string]any{"request": requestValues, "taskId": taskID}
	var body any
	if operation.Body != nil {
		value, err := evaluateManifestValue(operation.Body, env)
		if err != nil {
			return RequestSpec{}, fmt.Errorf("evaluate request body: %w", err)
		}
		body = normalizeManifestValue(value)
	} else if len(operation.Fields) > 0 {
		legacyBody := make(map[string]any, len(operation.Fields))
		for key, expression := range operation.Fields {
			value := manifestExpressionValue(expression, request, taskID)
			if value == nil {
				continue
			}
			setMapPath(legacyBody, key, value)
		}
		body = normalizeManifestValue(legacyBody)
	}
	pathValue := any(operation.Path)
	if operation.PathTemplate != nil {
		pathValue = operation.PathTemplate
	}
	evaluatedPath, err := evaluateManifestValue(pathValue, env)
	if err != nil {
		return RequestSpec{}, fmt.Errorf("evaluate request path: %w", err)
	}
	path := strings.ReplaceAll(manifestString(evaluatedPath), "{{taskId}}", url.PathEscape(taskID))
	// Model identifiers from async aggregators commonly contain path segments
	// (for example openai/gpt-image/edit). Escape each segment while preserving
	// the provider's intentional slash separators in the manifest path.
	escapedModel := strings.ReplaceAll(url.PathEscape(request.Model), "%2F", "/")
	path = strings.ReplaceAll(path, "{{model}}", escapedModel)
	path = interpolateManifestString(path, env)
	if !isRelativePath(path) {
		return RequestSpec{}, fmt.Errorf("evaluated request path must be relative: %q", path)
	}
	headers, err := evaluateManifestStringMap(operation.Headers, env)
	if err != nil {
		return RequestSpec{}, fmt.Errorf("evaluate request headers: %w", err)
	}
	query, err := evaluateManifestQuery(operation.Query, env)
	if err != nil {
		return RequestSpec{}, fmt.Errorf("evaluate request query: %w", err)
	}
	files, err := evaluateManifestFiles(operation.Files, env)
	if err != nil {
		return RequestSpec{}, err
	}
	contentTypeValue := any(operation.ContentType)
	if operation.ContentTypeTemplate != nil {
		contentTypeValue = operation.ContentTypeTemplate
	}
	evaluatedContentType, err := evaluateManifestValue(contentTypeValue, env)
	if err != nil {
		return RequestSpec{}, fmt.Errorf("evaluate request content type: %w", err)
	}
	contentType := defaultValue(manifestString(evaluatedContentType), "application/json")
	return RequestSpec{Method: strings.ToUpper(operation.Method), Path: path, OriginPath: operation.OriginPath, ContentType: contentType, Headers: headers, Query: query, Body: body, Files: files, Auth: auth}, nil
}

func evaluateManifestStringMap(values map[string]any, env map[string]any) (map[string]string, error) {
	if len(values) == 0 {
		return nil, nil
	}
	result := make(map[string]string, len(values))
	for key, template := range values {
		value, err := evaluateManifestValue(template, env)
		if err != nil {
			return nil, err
		}
		if text := strings.TrimSpace(manifestString(value)); text != "" {
			result[key] = text
		}
	}
	return result, nil
}

func evaluateManifestQuery(values map[string]any, env map[string]any) (map[string][]string, error) {
	if len(values) == 0 {
		return nil, nil
	}
	result := make(map[string][]string, len(values))
	for key, template := range values {
		value, err := evaluateManifestValue(template, env)
		if err != nil {
			return nil, err
		}
		for _, item := range manifestArray(value) {
			if text := strings.TrimSpace(manifestString(item)); text != "" {
				result[key] = append(result[key], text)
			}
		}
	}
	return result, nil
}

func evaluateManifestFiles(parts []ManifestFilePart, env map[string]any) ([]RequestFilePart, error) {
	result := make([]RequestFilePart, 0)
	for _, part := range parts {
		source, err := evaluateManifestValue(part.Source, env)
		if err != nil {
			return nil, fmt.Errorf("evaluate multipart file %q: %w", part.Name, err)
		}
		filename, err := evaluateManifestValue(part.Filename, env)
		if err != nil {
			return nil, fmt.Errorf("evaluate multipart filename %q: %w", part.Name, err)
		}
		mimeType, err := evaluateManifestValue(part.MIMEType, env)
		if err != nil {
			return nil, fmt.Errorf("evaluate multipart MIME type %q: %w", part.Name, err)
		}
		for index, value := range manifestArray(source) {
			references := mediaReferencesFromManifestValue(value, "file", false)
			for _, reference := range references {
				name := strings.TrimSpace(manifestString(filename))
				if name == "" {
					name = reference.Name
				}
				if name == "" {
					name = fmt.Sprintf("%s-%d", part.Name, index+1)
				}
				contentType := strings.TrimSpace(manifestString(mimeType))
				if contentType == "" {
					contentType = reference.MIMEType
				}
				result = append(result, RequestFilePart{Name: part.Name, Filename: name, MIMEType: contentType, Reference: reference})
			}
		}
	}
	return result, nil
}

func normalizeManifestValue(value any) any {
	switch v := value.(type) {
	case map[string]any:
		if len(v) == 0 {
			return v
		}
		isSequential := true
		for i := 0; i < len(v); i++ {
			if _, ok := v[strconv.Itoa(i)]; !ok {
				isSequential = false
				break
			}
		}
		if isSequential {
			arr := make([]any, len(v))
			for i := 0; i < len(v); i++ {
				arr[i] = normalizeManifestValue(v[strconv.Itoa(i)])
			}
			return arr
		}
		res := make(map[string]any, len(v))
		for k, val := range v {
			res[k] = normalizeManifestValue(val)
		}
		return res
	case []any:
		arr := make([]any, len(v))
		for i, val := range v {
			arr[i] = normalizeManifestValue(val)
		}
		return arr
	default:
		return value
	}
}

func manifestExpressionValue(expression string, request GenerationRequest, taskID string) any {
	expression = strings.TrimSpace(expression)
	source := expression
	transforms := []string{}
	if separator := strings.IndexByte(expression, '|'); separator >= 0 {
		source = strings.TrimSpace(expression[:separator])
		transforms = strings.Split(expression[separator+1:], "|")
	}

	var value any
	switch {
	case source == "taskId":
		value = taskID
	case strings.HasPrefix(source, "request."):
		value = pathValue(manifestRequestValues(request), strings.TrimPrefix(source, "request."))
	default:
		value = source
	}
	for _, transform := range transforms {
		value = applyManifestTransform(value, transform, request)
		if value == nil {
			break
		}
	}
	return value
}

// manifestRequestValues is deliberately a small, JSON-shaped view of the
// platform request. It lets uploaded manifests address media items by index
// without exposing Go structs or adding provider-specific host code.
func manifestRequestValues(request GenerationRequest) map[string]any {
	userContent := make([]any, 0)
	if strings.TrimSpace(request.Prompt) != "" {
		userContent = append(userContent, map[string]any{"type": "text", "text": request.Prompt})
	}
	for _, img := range request.Images {
		val := defaultValue(img.URL, img.DataURL)
		if val != "" {
			userContent = append(userContent, map[string]any{"type": "image_url", "image_url": map[string]any{"url": val}})
		}
	}
	for _, vid := range request.Videos {
		val := defaultValue(vid.URL, vid.DataURL)
		if val != "" {
			userContent = append(userContent, map[string]any{"type": "video_url", "video_url": map[string]any{"url": val}})
		}
	}
	for _, aud := range request.Audios {
		val := defaultValue(aud.URL, aud.DataURL)
		if val != "" {
			userContent = append(userContent, map[string]any{"type": "audio_url", "audio_url": map[string]any{"url": val}})
		}
	}
	messages := make([]any, 0, len(request.Messages)+2)
	// instructions 是统一的系统指令字段，但多数 OpenAI 系协议只映射 request.messages。
	// 系统指令必须进入消息数组，否则会被静默丢弃；带独立 system 字段的协议（Claude、
	// Gemini、Responses）在各自模板里过滤 system 角色，不会重复发送。
	if instructions := strings.TrimSpace(request.Instructions); instructions != "" && !hasSystemMessage(request.Messages) {
		messages = append(messages, map[string]any{"role": "system", "content": instructions})
	}
	for _, message := range request.Messages {
		if strings.TrimSpace(message.Role) == "" || message.Content == nil {
			continue
		}
		messages = append(messages, map[string]any{"role": message.Role, "content": message.Content})
	}
	if len(userContent) > 0 {
		content := any(userContent)
		if len(userContent) == 1 && len(request.Images)+len(request.Videos)+len(request.Audios) == 0 {
			content = request.Prompt
		}
		messages = append(messages, map[string]any{"role": "user", "content": content})
	}

	inputs := request.Inputs
	if len(inputs) == 0 {
		inputs = append(inputs, request.Images...)
		inputs = append(inputs, request.Videos...)
		inputs = append(inputs, request.Audios...)
	}
	output := request.Output
	if output.Count == 0 {
		output.Count = request.ImageCount
	}
	if output.Duration == 0 {
		output.Duration = request.Duration
	}
	if output.AspectRatio == "" {
		output.AspectRatio = request.AspectRatio
	}
	if output.Resolution == "" {
		output.Resolution = request.Resolution
	}
	if output.Quality == "" {
		output.Quality = request.Quality
	}
	output.GenerateAudio = output.GenerateAudio || request.GenerateAudio
	output.Watermark = output.Watermark || request.Watermark
	outputValue, _ := requestAsManifestValue(output)
	providerOptionsValue, _ := requestAsManifestValue(request.ProviderOptions)
	if providerOptionsValue == nil {
		providerOptionsValue = map[string]any{}
	}

	return map[string]any{
		"capability":      request.Capability,
		"model":           request.Model,
		"prompt":          request.Prompt,
		"instructions":    request.Instructions,
		"messages":        messages,
		"inputs":          manifestMediaValues(inputs),
		"images":          manifestMediaValues(request.Images),
		"videos":          manifestMediaValues(request.Videos),
		"audios":          manifestMediaValues(request.Audios),
		"imageCount":      request.ImageCount,
		"duration":        request.Duration,
		"aspectRatio":     request.AspectRatio,
		"resolution":      request.Resolution,
		"quality":         request.Quality,
		"generateAudio":   request.GenerateAudio,
		"watermark":       request.Watermark,
		"operation":       request.Operation,
		"output":          outputValue,
		"providerOptions": providerOptionsValue,
		"extra":           request.Extra,
	}
}

func hasSystemMessage(messages []Message) bool {
	for _, message := range messages {
		if strings.EqualFold(strings.TrimSpace(message.Role), "system") {
			return true
		}
	}
	return false
}

func requestAsManifestValue(value any) (any, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var result any
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func manifestModelID(request GenerationRequest) string {
	modelID := strings.TrimSpace(request.Model)
	if separator := strings.LastIndex(modelID, "::"); separator >= 0 {
		modelID = modelID[separator+2:]
	}
	return strings.ToLower(modelID)
}

func manifestMediaValues(values []MediaReference) []any {
	result := make([]any, 0, len(values))
	for index, value := range values {
		order := value.Order
		if order == 0 && index > 0 {
			order = index
		}
		resolved := defaultValue(value.URL, value.DataURL)
		result = append(result, map[string]any{
			"id":       value.ID,
			"url":      value.URL,
			"dataUrl":  value.DataURL,
			"value":    resolved,
			"kind":     value.Kind,
			"role":     value.Role,
			"mimeType": value.MIMEType,
			"name":     value.Name,
			"order":    order,
			"weight":   value.Weight,
			"metadata": value.Metadata,
			"source": map[string]any{
				"type":     manifestMediaSourceType(value),
				"value":    resolved,
				"mimeType": value.MIMEType,
			},
			"ephemeral": value.Ephemeral,
		})
	}
	return result
}

func manifestMediaSourceType(value MediaReference) string {
	if value.DataURL != "" {
		return "data"
	}
	if value.URL != "" {
		return "url"
	}
	return "unknown"
}

func applyManifestTransform(value any, transform string, request GenerationRequest) any {
	transform = strings.ToLower(strings.TrimSpace(transform))
	if transform == "bool" || transform == "boolean" {
		switch v := value.(type) {
		case bool:
			return v
		case string:
			s := strings.ToLower(strings.TrimSpace(v))
			return s == "true" || s == "1" || s == "yes"
		case int, int64, float64:
			return v != 0
		default:
			return false
		}
	}
	if transform == "int" || transform == "integer" {
		switch v := value.(type) {
		case int:
			return v
		case int64:
			return int(v)
		case float64:
			return int(v)
		case string:
			if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
				return n
			}
			return 0
		default:
			return 0
		}
	}
	if transform == "omit_zero" {
		switch v := value.(type) {
		case int:
			if v == 0 {
				return nil
			}
		case int64:
			if v == 0 {
				return nil
			}
		case float64:
			if v == 0 {
				return nil
			}
		case string:
			if strings.TrimSpace(v) == "0" || strings.TrimSpace(v) == "" {
				return nil
			}
		}
	}
	cleanModel := manifestModelID(request)
	if strings.HasPrefix(transform, "omit_unless_model_contains:") {
		needle := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(transform, "omit_unless_model_contains:")))
		if needle == "" || !strings.Contains(cleanModel, needle) {
			return nil
		}
	}
	if strings.HasPrefix(transform, "omit_if_model_contains:") {
		needle := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(transform, "omit_if_model_contains:")))
		if needle != "" && strings.Contains(cleanModel, needle) {
			return nil
		}
	}
	if strings.HasPrefix(transform, "omit_unless_model_equals:") {
		target := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(transform, "omit_unless_model_equals:")))
		if target == "" || cleanModel != target {
			return nil
		}
	}
	if strings.HasPrefix(transform, "omit_if_model_equals:") {
		target := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(transform, "omit_if_model_equals:")))
		if target != "" && cleanModel == target {
			return nil
		}
	}
	text, ok := value.(string)
	if transform == "omit_empty" && (!ok || strings.TrimSpace(text) == "") {
		return nil
	}
	if transform == "omit_auto" && (!ok || strings.TrimSpace(text) == "" || strings.EqualFold(strings.TrimSpace(text), "auto") || strings.EqualFold(strings.TrimSpace(text), "default")) {
		return nil
	}
	if !ok {
		return value
	}
	switch transform {
	case "trim":
		return strings.TrimSpace(text)
	case "lower", "lowercase":
		return strings.ToLower(text)
	case "upper", "uppercase":
		return strings.ToUpper(text)
	case "resolution_p":
		if regexp.MustCompile(`^\d+$`).MatchString(strings.TrimSpace(text)) {
			return strings.TrimSpace(text) + "p"
		}
		return text
	case "video-resolution", "video_resolution", "videoresolution":
		// Compatibility for already-installed 1.0.1 manifests. New plugins
		// should declare exact enum values and use generic string transforms.
		return normalizeLegacyManifestVideoResolution(text)
	default:
		return value
	}
}

func normalizeLegacyManifestVideoResolution(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return ""
	}
	for _, char := range normalized {
		if char < '0' || char > '9' {
			return normalized
		}
	}
	return normalized + "p"
}

func pathValue(payload map[string]any, path string) any {
	return manifestPathValue(payload, path)
}

func arrayValue(value any) []any {
	items, _ := value.([]any)
	return items
}

func firstPathValue(payload map[string]any, paths ...string) string {
	for _, path := range paths {
		value := pathValue(payload, path)
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}
