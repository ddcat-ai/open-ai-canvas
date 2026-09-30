// 声明式插件的运行期适配器（manifestAdapter）：按清单组装请求、解析响应中的任务 ID、状态与媒体。
//
// 媒体提取同时支持 JSON 路径、Markdown 图片、HTML 视频标签与内联 data URL，
// 兼容不同上游的返回形态。

package protocol

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"regexp"
	"strings"
)

type manifestAdapter struct{ manifest Manifest }

func (a manifestAdapter) Metadata() Metadata { return a.manifest.Metadata }

func (a manifestAdapter) AgentAvailable() bool {
	return a.manifest.Agent != nil && a.manifest.AgentResponse != nil
}

func (a manifestAdapter) ResultAvailable() bool { return a.manifest.ResultOperation != nil }

func (a manifestAdapter) BuildCreate(_ context.Context, c RequestContext) (RequestSpec, error) {
	if len(a.manifest.Contributes.Providers) == 0 {
		return RequestSpec{}, fmt.Errorf("plugin %s does not provide a provider", a.manifest.Metadata.ID)
	}
	if err := validateManifestRequest(a.manifest.Validations, c.Request); err != nil {
		return RequestSpec{}, err
	}
	return buildManifestOperation(a.manifest.Create, a.manifest.Auth, c.Request, "")
}

func (a manifestAdapter) BuildAgent(_ context.Context, c AgentRequestContext) (RequestSpec, error) {
	if a.manifest.Agent == nil {
		return RequestSpec{}, fmt.Errorf("protocol %s has no agent operation", a.manifest.Metadata.ID)
	}
	request := GenerationRequest{Model: c.Model, Extra: map[string]any{"agent": c.Request}}
	return buildManifestOperation(*a.manifest.Agent, a.manifest.Auth, request, "")
}

func (a manifestAdapter) ParseAgent(_ context.Context, body []byte) (AgentResult, error) {
	if a.manifest.AgentResponse == nil {
		return AgentResult{}, fmt.Errorf("protocol %s has no agent response mapping", a.manifest.Metadata.ID)
	}
	payload, err := decodeObject(body)
	if err != nil {
		return AgentResult{}, err
	}
	response := a.manifest.AgentResponse
	result := AgentResult{Text: firstPathValue(payload, response.TextPaths...), Reasoning: firstPathValue(payload, response.ReasoningPaths...)}
	if response.ToolCallsPath == "" {
		return result, nil
	}
	for index, item := range arrayValue(pathValue(payload, response.ToolCallsPath)) {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		call := AgentToolCall{
			ID:               firstPathValue(object, response.ToolCallIDPaths...),
			Name:             firstPathValue(object, response.ToolCallNamePaths...),
			Arguments:        firstPathJSONValue(object, response.ToolCallArgsPaths...),
			ThoughtSignature: firstPathValue(object, response.ToolCallSignaturePaths...),
		}
		if strings.TrimSpace(call.Name) != "" {
			if strings.TrimSpace(call.ID) == "" {
				call.ID = syntheticAgentToolCallID(body, index)
			}
			result.ToolCalls = append(result.ToolCalls, call)
		}
	}
	return result, nil
}

func syntheticAgentToolCallID(body []byte, index int) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s#%d", body, index)))
	return fmt.Sprintf("call_%x", sum[:8])
}

func (a manifestAdapter) ParseCreate(_ context.Context, body []byte) (CreateResult, error) {
	if a.manifest.Response.BinaryPayload {
		return binaryPayloadCreateResult(a.manifest.Response.ResultKind, body)
	}
	payload, err := decodeObject(body)
	if err != nil {
		return CreateResult{}, err
	}
	return a.parse(payload, PollContext{}), nil
}

// binaryPayloadCreateResult 把同步二进制响应包装为单个媒体结果。MIME 以响应内容探测为准，
// 空响应必须失败，不能把空内容伪装成生成成功。
func binaryPayloadCreateResult(resultKind string, body []byte) (CreateResult, error) {
	if len(body) == 0 {
		return CreateResult{}, fmt.Errorf("binary payload response is empty")
	}
	mimeType := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(body), ";")[0]))
	reference := MediaReference{DataURL: "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(body), MIMEType: mimeType}
	result := &Result{}
	switch resultKind {
	case "audio":
		result.Audios = []MediaReference{reference}
	case "image":
		result.Images = []MediaReference{reference}
	case "video":
		result.Videos = []MediaReference{reference}
	default:
		return CreateResult{}, fmt.Errorf("binary payload response requires resultKind image, video or audio, got %q", resultKind)
	}
	return CreateResult{Status: StatusSucceeded, Result: result}, nil
}

func (a manifestAdapter) BuildPoll(_ context.Context, c PollContext) (RequestSpec, error) {
	if a.manifest.Poll == nil {
		return RequestSpec{}, fmt.Errorf("protocol %s has no poll operation", a.manifest.Metadata.ID)
	}
	request := c.Request
	request.Model = c.Model
	return buildManifestOperation(*a.manifest.Poll, a.manifest.Auth, request, c.TaskID)
}

func (a manifestAdapter) ParsePoll(_ context.Context, c PollContext, body []byte) (PollResult, error) {
	payload, err := decodeObject(body)
	if err != nil {
		return PollResult{}, err
	}
	result := a.parse(payload, c)
	return PollResult{TaskID: result.TaskID, Status: result.Status, Result: result.Result, Message: result.Message}, nil
}

func (a manifestAdapter) BuildCancel(_ context.Context, c PollContext) (RequestSpec, error) {
	if a.manifest.Cancel == nil {
		return RequestSpec{}, fmt.Errorf("protocol %s does not support cancellation", a.manifest.Metadata.ID)
	}
	request := c.Request
	request.Model = c.Model
	return buildManifestOperation(*a.manifest.Cancel, a.manifest.Auth, request, c.TaskID)
}

func (a manifestAdapter) BuildResult(_ context.Context, c PollContext) (RequestSpec, error) {
	if a.manifest.ResultOperation == nil {
		return RequestSpec{}, fmt.Errorf("protocol %s has no result operation", a.manifest.Metadata.ID)
	}
	request := c.Request
	request.Model = c.Model
	return buildManifestOperation(*a.manifest.ResultOperation, a.manifest.Auth, request, c.TaskID)
}

func (a manifestAdapter) parse(payload map[string]any, c PollContext) CreateResult {
	response := a.manifest.Response
	env := map[string]any{"response": payload, "taskId": c.TaskID, "request": manifestRequestValues(c.Request)}
	id := manifestResponseString(response.TaskID, env)
	if id == "" {
		id = firstPathValue(payload, response.TaskIDPaths...)
	}
	if id == "" {
		id = c.TaskID
	}
	statusText := manifestResponseString(response.Status, env)
	if statusText == "" {
		statusText = firstPathValue(payload, response.StatusPaths...)
	}
	status := normalizeStatus(statusText)
	if status == "" {
		status = StatusPending
	}
	message := manifestResponseString(response.Message, env)
	if message == "" {
		message = firstPathValue(payload, response.MessagePaths...)
	}
	if manifestError(payload, response.ErrorPaths...) {
		status = StatusFailed
	}
	result := &Result{
		Text:      manifestResponseString(response.Text, env),
		Reasoning: manifestResponseString(response.Reasoning, env),
	}
	if result.Text == "" {
		result.Text = firstPathValue(payload, response.TextPaths...)
	}
	if result.Reasoning == "" {
		result.Reasoning = firstPathValue(payload, response.ReasoningPaths...)
	}
	result.Images = manifestResponseMedia(response.Images, env, "image", response.ResultEphemeral)
	result.Videos = manifestResponseMedia(response.Videos, env, "video", response.ResultEphemeral)
	result.Audios = manifestResponseMedia(response.Audios, env, "audio", response.ResultEphemeral)
	if response.Usage != nil {
		if value, err := evaluateManifestValue(response.Usage, env); err == nil {
			result.Usage = manifestObject(value)
		}
	}
	paths := append([]string{}, a.manifest.Response.ResultURLPaths...)
	paths = append(paths, a.manifest.Response.ResultPaths...)
	for _, path := range paths {
		for _, value := range mediaPathValues(payload, path) {
			item := MediaReference{URL: value, Kind: a.manifest.Response.ResultKind, Ephemeral: a.manifest.Response.ResultEphemeral}
			switch a.manifest.Response.ResultKind {
			case "image":
				result.Images = append(result.Images, item)
			case "audio":
				result.Audios = append(result.Audios, item)
			default:
				result.Videos = append(result.Videos, item)
			}
		}
	}
	if status == StatusPending && (result.Text != "" || len(result.Images) > 0 || len(result.Videos) > 0 || len(result.Audios) > 0) {
		status = StatusSucceeded
	}
	if result.Text == "" && result.Reasoning == "" && len(result.Images) == 0 && len(result.Videos) == 0 && len(result.Audios) == 0 {
		result = nil
	}
	return CreateResult{TaskID: id, Status: status, Result: result, Message: message}
}

func validateManifestRequest(rules []ManifestValidation, request GenerationRequest) error {
	if len(rules) == 0 {
		return nil
	}
	env := map[string]any{"request": manifestRequestValues(request)}
	for _, rule := range rules {
		value, err := evaluateManifestValue(rule.Assert, env)
		if err != nil {
			return fmt.Errorf("协议参数校验表达式错误：%w", err)
		}
		if !manifestTruthy(value) {
			return fmt.Errorf("%s", strings.TrimSpace(rule.Message))
		}
	}
	return nil
}

func manifestResponseString(template any, env map[string]any) string {
	if template == nil {
		return ""
	}
	value, err := evaluateManifestValue(template, env)
	if err != nil {
		return ""
	}
	items := manifestArray(value)
	parts := make([]string, 0, len(items))
	for _, item := range items {
		if text := strings.TrimSpace(manifestString(item)); text != "" {
			parts = append(parts, text)
		}
	}
	return strings.Join(parts, "")
}

func manifestResponseMedia(template any, env map[string]any, kind string, ephemeral bool) []MediaReference {
	if template == nil {
		return nil
	}
	value, err := evaluateManifestValue(template, env)
	if err != nil {
		return nil
	}
	return mediaReferencesFromManifestValue(value, kind, ephemeral)
}

func mediaReferencesFromManifestValue(value any, kind string, ephemeral bool) []MediaReference {
	result := make([]MediaReference, 0)
	for _, item := range manifestArray(value) {
		switch typed := item.(type) {
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed == "" {
				continue
			}
			reference := MediaReference{Kind: kind, Ephemeral: ephemeral}
			if strings.HasPrefix(trimmed, "data:") {
				reference.DataURL = trimmed
			} else {
				reference.URL = trimmed
			}
			result = append(result, reference)
		case map[string]any:
			reference := MediaReference{
				ID: manifestString(typed["id"]), URL: manifestString(typed["url"]), DataURL: manifestString(typed["dataUrl"]),
				Kind: defaultValue(manifestString(typed["kind"]), kind), Role: manifestString(typed["role"]), MIMEType: manifestString(typed["mimeType"]),
				Name: manifestString(typed["name"]), Order: manifestInt(typed["order"]), Weight: manifestFloat(typed["weight"]), Ephemeral: ephemeral || manifestTruthy(typed["ephemeral"]),
			}
			if reference.URL == "" {
				reference.URL = firstString(typed, "file_url", "fileUrl", "image_url", "imageUrl", "video_url", "videoUrl", "audio_url", "audioUrl", "uri")
			}
			if reference.DataURL == "" {
				reference.DataURL = firstString(typed, "data_url", "b64_json")
			}
			// OpenAI / Ark 等渠道常直接返回裸 b64_json；声明式结果下载要求 data URL。
			reference.DataURL = normalizeManifestInlineDataURL(reference.DataURL, reference.Kind, firstString(typed, "output_format", "mime_type", "mimeType"))
			if reference.URL != "" || reference.DataURL != "" {
				result = append(result, reference)
			}
		}
	}
	return result
}

func normalizeManifestInlineDataURL(value, kind, formatHint string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "data:") {
		return value
	}
	return "data:" + manifestInlineMediaMIME(kind, formatHint) + ";base64," + value
}

func manifestInlineMediaMIME(kind, formatHint string) string {
	hint := strings.ToLower(strings.TrimSpace(formatHint))
	switch hint {
	case "image/png", "image/jpeg", "image/webp", "image/gif", "audio/mpeg", "audio/wav", "audio/ogg", "video/mp4", "video/webm":
		return hint
	case "image/jpg":
		return "image/jpeg"
	case "audio/mp3":
		return "audio/mpeg"
	case "png":
		return "image/png"
	case "jpeg", "jpg":
		return "image/jpeg"
	case "webp":
		return "image/webp"
	case "gif":
		return "image/gif"
	case "mp3", "mpeg":
		return "audio/mpeg"
	case "wav":
		return "audio/wav"
	case "mp4":
		return "video/mp4"
	case "webm":
		return "video/webm"
	}
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "audio":
		return "audio/mpeg"
	case "video":
		return "video/mp4"
	default:
		return "image/png"
	}
}

var (
	manifestMDImageRegex   = regexp.MustCompile(`!\[[^\]]*\]\(([^)\s]+)\)`)
	manifestHTMLVideoRegex = regexp.MustCompile(`(?i)<video[^>]+src=['"]([^'"]+)['"]`)
)

func mediaPathValues(payload map[string]any, path string) []string {
	value := pathValue(payload, path)
	if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
		trimmed := strings.TrimSpace(text)
		if matches := manifestMDImageRegex.FindAllStringSubmatch(trimmed, -1); len(matches) > 0 {
			var res []string
			for _, m := range matches {
				if len(m) > 1 && m[1] != "" {
					res = append(res, m[1])
				}
			}
			if len(res) > 0 {
				return res
			}
		}
		if matches := manifestHTMLVideoRegex.FindAllStringSubmatch(trimmed, -1); len(matches) > 0 {
			var res []string
			for _, m := range matches {
				if len(m) > 1 && m[1] != "" {
					res = append(res, m[1])
				}
			}
			if len(res) > 0 {
				return res
			}
		}
		return []string{trimmed}
	}
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	values := make([]string, 0, len(items))
	for _, item := range items {
		switch typed := item.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				values = append(values, strings.TrimSpace(typed))
			}
		case map[string]any:
			if url := firstString(typed, "url", "file_url", "fileUrl", "video_url", "videoUrl", "image_url", "imageUrl"); url != "" {
				values = append(values, url)
			}
		}
	}
	return values
}
