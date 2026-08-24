package protocol

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
)

type builtinAdapter struct {
	info        Metadata
	create      func(GenerationRequest) (RequestSpec, error)
	parseCreate func(map[string]any) (CreateResult, error)
	poll        func(PollContext) (RequestSpec, error)
	parsePoll   func(PollContext, map[string]any) (PollResult, error)
	cancel      func(PollContext) (RequestSpec, error)
}

func (a builtinAdapter) Metadata() Metadata { return a.info }
func (a builtinAdapter) BuildCreate(_ context.Context, c RequestContext) (RequestSpec, error) {
	if a.create == nil {
		return RequestSpec{}, unavailable(a.info)
	}
	return a.create(c.Request)
}
func (a builtinAdapter) ParseCreate(_ context.Context, body []byte) (CreateResult, error) {
	if a.parseCreate == nil {
		return CreateResult{}, unavailable(a.info)
	}
	payload, err := decodeObject(body)
	if err != nil {
		return CreateResult{}, err
	}
	return a.parseCreate(payload)
}
func (a builtinAdapter) BuildPoll(_ context.Context, c PollContext) (RequestSpec, error) {
	if a.poll == nil {
		return RequestSpec{}, unavailable(a.info)
	}
	return a.poll(c)
}
func (a builtinAdapter) ParsePoll(_ context.Context, c PollContext, body []byte) (PollResult, error) {
	if a.parsePoll == nil {
		return PollResult{}, unavailable(a.info)
	}
	payload, err := decodeObject(body)
	if err != nil {
		return PollResult{}, err
	}
	return a.parsePoll(c, payload)
}
func (a builtinAdapter) BuildCancel(_ context.Context, c PollContext) (RequestSpec, error) {
	if a.cancel == nil {
		return RequestSpec{}, fmt.Errorf("protocol %s does not support cancellation", a.info.ID)
	}
	return a.cancel(c)
}

var builtinRegistry *Registry
var builtinRegistryMu sync.Mutex

// Builtins returns the immutable process-wide registry of shipped protocol plugins.
// The registry itself is safe for reads and can be extended by an installer during startup.
func Builtins() *Registry {
	builtinRegistryMu.Lock()
	defer builtinRegistryMu.Unlock()
	if builtinRegistry != nil {
		return builtinRegistry
	}
	registry, err := NewRegistry(
		openAIChatAdapter(), openAIResponsesAdapter(), claudeAdapter(),
		openAIImagesAdapter(), grokImagesAdapter(), arkImagesAdapter(), jimengImagesAdapter(), geminiImagesAdapter(),
		openAIVideosAdapter(), newAPIChannel1Adapter(), newAPIVideosAdapter(), xAIVideosAdapter(), arkVideosAdapter(), jimengVideosAdapter(), geminiVeoAdapter(), novitaVideosAdapter(), miniMaxVideosAdapter(),
		openAIAudioAdapter(), asyncAudioAdapter(), agnesAdapter(),
	)
	if err != nil {
		panic(err)
	}
	builtinRegistry = registry
	return registry
}

func allSurfaces() []Surface {
	return []Surface{SurfaceAdminSystemChannel, SurfaceUserCustomChannel, SurfaceCanvas, SurfaceCreation, SurfaceAgent}
}

func metadata(id, name, vendor string, capability Capability, create, poll, contentType string) Metadata {
	return Metadata{ID: id, Version: "1.0.0", Name: name, Vendor: vendor, Categories: []Capability{capability}, Scopes: allSurfaces(), Create: create, Poll: poll, ContentType: contentType, Enabled: true, Installable: true}
}

func mediaParams() []Parameter {
	return []Parameter{{Name: "model", Type: "string", Required: true, Mapping: "model"}, {Name: "prompt", Type: "string", Required: true, Mapping: "prompt"}, {Name: "images", Type: "media[]", Mapping: "provider-specific"}, {Name: "imageCount", Type: "integer", Mapping: "provider-specific"}, {Name: "aspectRatio", Type: "string", Mapping: "provider-specific"}, {Name: "resolution", Type: "string", Mapping: "provider-specific"}, {Name: "quality", Type: "string", Mapping: "provider-specific"}}
}

func videoParams() []Parameter {
	return []Parameter{
		{Name: "model", Type: "string", Required: true, Mapping: "model", Description: "上游模型标识。"},
		{Name: "prompt", Type: "string", Required: true, Mapping: "prompt", Description: "视频生成提示词。"},
		{Name: "images", Type: "media[]", Mapping: "provider-specific", Description: "参考图片，由协议适配器转换为上游要求的 URL、Data URL 或 multipart 文件。"},
		{Name: "videos", Type: "media[]", Mapping: "provider-specific", Description: "参考视频；仅在上游协议支持时发送。"},
		{Name: "audios", Type: "media[]", Mapping: "provider-specific", Description: "参考音频或声音；仅在上游协议支持时发送。"},
		{Name: "duration", Type: "integer", Mapping: "provider-specific", Description: "视频时长，单位由上游协议决定。"},
		{Name: "aspectRatio", Type: "string", Mapping: "provider-specific", Description: "画幅比例或上游尺寸字段。"},
		{Name: "resolution", Type: "string", Mapping: "provider-specific", Description: "输出分辨率档位。"},
		{Name: "generateAudio", Type: "boolean", Mapping: "provider-specific", Description: "是否同时生成音频。"},
		{Name: "watermark", Type: "boolean", Mapping: "provider-specific", Description: "是否添加水印。"},
	}
}

func openAIChatAdapter() Adapter {
	info := metadata("chat-completion", "OpenAI Chat Completions", "OpenAI", CapabilityText, "POST /v1/chat/completions", "", "application/json")
	info.Parameters = []Parameter{
		{Name: "model", Type: "string", Required: true, Mapping: "model", Description: "上游模型标识。"},
		{Name: "prompt", Type: "string", Required: true, Mapping: "messages[0].content", Description: "默认转换为一条 user message；extra.messages 可替换完整消息数组。"},
		{Name: "stream", Type: "boolean", Mapping: "stream", Description: "是否请求流式响应。"},
	}
	return builtinAdapter{info: info,
		create: func(r GenerationRequest) (RequestSpec, error) {
			body := map[string]any{"model": r.Model, "messages": []any{map[string]any{"role": "user", "content": r.Prompt}}}
			mergeExtra(body, r.Extra, "messages", "temperature", "top_p", "max_tokens", "stream", "tools", "response_format")
			return jsonSpec(http.MethodPost, "/v1/chat/completions", body), nil
		},
		parseCreate: parseChatResponse,
	}
}

func openAIResponsesAdapter() Adapter {
	info := metadata("openai-response", "OpenAI Responses", "OpenAI", CapabilityText, "POST /v1/responses", "", "application/json")
	info.Parameters = []Parameter{
		{Name: "model", Type: "string", Required: true, Mapping: "model", Description: "上游模型标识。"},
		{Name: "prompt", Type: "string", Required: true, Mapping: "input", Description: "默认作为 input 字符串；extra.input 可提供结构化输入。"},
		{Name: "stream", Type: "boolean", Mapping: "stream", Description: "是否请求流式响应。"},
	}
	return builtinAdapter{info: info,
		create: func(r GenerationRequest) (RequestSpec, error) {
			input := any(r.Prompt)
			body := map[string]any{"model": r.Model, "input": input}
			mergeExtra(body, r.Extra, "input", "instructions", "temperature", "top_p", "max_output_tokens", "stream", "tools", "text")
			return jsonSpec(http.MethodPost, "/v1/responses", body), nil
		},
		parseCreate: parseResponsesResponse,
	}
}

func claudeAdapter() Adapter {
	info := metadata("claude-api", "Claude API", "Anthropic", CapabilityText, "POST /v1/messages", "", "application/json")
	info.Parameters = []Parameter{
		{Name: "model", Type: "string", Required: true, Mapping: "model", Description: "Anthropic 模型标识。"},
		{Name: "prompt", Type: "string", Required: true, Mapping: "messages[0].content", Description: "默认转换为一条 user message；extra.messages 可替换完整消息数组。"},
		{Name: "stream", Type: "boolean", Mapping: "stream", Description: "是否请求流式响应。"},
	}
	info.LegacyAliases = []string{"anthropic-messages", "claude-messages"}
	return builtinAdapter{info: info,
		create: func(r GenerationRequest) (RequestSpec, error) {
			body := map[string]any{"model": r.Model, "max_tokens": 4096, "messages": []any{map[string]any{"role": "user", "content": r.Prompt}}}
			mergeExtra(body, r.Extra, "max_tokens", "system", "messages", "temperature", "top_p", "top_k", "tools", "tool_choice", "stream")
			spec := jsonSpec(http.MethodPost, "/v1/messages", body)
			spec.Headers = map[string]string{"anthropic-version": "2023-06-01"}
			return spec, nil
		},
		parseCreate: parseClaudeResponse,
	}
}

func openAIImagesAdapter() Adapter {
	info := metadata("openai-image", "OpenAI Images", "OpenAI", CapabilityImage, "POST /v1/images/generations", "", "application/json or multipart/form-data")
	info.Parameters = mediaParams()
	return builtinAdapter{info: info,
		create: func(r GenerationRequest) (RequestSpec, error) {
			body := map[string]any{"model": r.Model, "prompt": r.Prompt}
			if r.ImageCount > 0 {
				body["n"] = r.ImageCount
			}
			copyIf(body, "size", r.AspectRatio)
			copyIf(body, "quality", r.Quality)
			mergeExtra(body, r.Extra, "size", "quality", "background", "response_format", "output_format", "style", "n")
			return jsonSpec(http.MethodPost, "/v1/images/generations", body), nil
		},
		parseCreate: parseImageResponse,
	}
}

func grokImagesAdapter() Adapter {
	info := metadata("grok-image", "Grok Images", "xAI", CapabilityImage, "POST /v1/images/generations", "", "application/json")
	info.Parameters = mediaParams()
	return builtinAdapter{info: info,
		create: func(r GenerationRequest) (RequestSpec, error) {
			body := map[string]any{"model": r.Model, "prompt": r.Prompt, "aspect_ratio": defaultValue(r.AspectRatio, "1:1"), "resolution": defaultValue(r.Quality, "2k")}
			if len(r.Images) > 0 {
				body["image"] = mediaValue(r.Images[0])
			}
			return jsonSpec(http.MethodPost, "/v1/images/generations", body), nil
		},
		parseCreate: parseImageResponse,
	}
}

func arkImagesAdapter() Adapter {
	info := metadata("volcengine-ark-image", "火山方舟图片", "Volcengine Ark", CapabilityImage, "POST /api/v3/images/generations", "", "application/json")
	info.Parameters = mediaParams()
	return builtinAdapter{info: info,
		create: func(r GenerationRequest) (RequestSpec, error) {
			body := map[string]any{"model": r.Model, "prompt": r.Prompt}
			if size := strings.TrimSpace(r.AspectRatio); size != "" {
				body["size"] = size
			}
			if len(r.Images) > 0 {
				body["image"] = mediaValues(r.Images)
			}
			mergeExtra(body, r.Extra, "size", "sequential_image_generation", "sequential_image_generation_options", "watermark")
			return jsonSpec(http.MethodPost, "/api/v3/images/generations", body), nil
		},
		parseCreate: parseImageResponse,
	}
}

func jimengImagesAdapter() Adapter {
	info := metadata("volcengine-jimeng-image", "即梦官方图片", "Volcengine Jimeng", CapabilityImage, "POST CVSync2AsyncSubmitTask", "POST CVSync2AsyncGetResult", "application/json + AK/SK signature")
	info.Parameters = mediaParams()
	return builtinAdapter{info: info,
		create: func(r GenerationRequest) (RequestSpec, error) {
			body := map[string]any{"req_key": r.Model, "prompt": r.Prompt}
			if len(r.Images) > 0 {
				body["image_urls"] = mediaValues(r.Images)
			}
			mergeExtra(body, r.Extra, "req_key", "prompt", "image_urls", "seed", "width", "height")
			return jsonSpec(http.MethodPost, "/CVSync2AsyncSubmitTask", body), nil
		},
		parseCreate: parseJiMengCreate,
		poll: func(c PollContext) (RequestSpec, error) {
			return jsonSpec(http.MethodPost, "/CVSync2AsyncGetResult", map[string]any{"req_key": c.Model, "task_id": c.TaskID}), nil
		},
		parsePoll: parseJiMengPoll,
	}
}

func geminiImagesAdapter() Adapter {
	info := metadata("gemini-image", "Gemini Images", "Google", CapabilityImage, "POST /v1beta/models/{model}:generateContent", "", "application/json")
	info.Parameters = mediaParams()
	return builtinAdapter{info: info,
		create: func(r GenerationRequest) (RequestSpec, error) {
			parts := []any{map[string]any{"text": r.Prompt}}
			for _, image := range r.Images {
				if image.DataURL != "" {
					parts = append(parts, map[string]any{"inline_data": map[string]any{"mime_type": dataMIME(image.DataURL), "data": dataPayload(image.DataURL)}})
				} else if image.URL != "" {
					parts = append(parts, map[string]any{"file_data": map[string]any{"file_uri": image.URL}})
				}
			}
			body := map[string]any{"contents": []any{map[string]any{"role": "user", "parts": parts}}}
			if r.AspectRatio != "" || r.Quality != "" {
				body["generationConfig"] = map[string]any{"imageConfig": compactMap(map[string]any{"aspectRatio": r.AspectRatio, "imageSize": r.Quality})}
			}
			mergeExtra(body, r.Extra, "generationConfig", "safetySettings", "systemInstruction")
			return jsonSpec(http.MethodPost, "/v1beta/models/"+url.PathEscape(r.Model)+":generateContent", body), nil
		},
		parseCreate: parseGeminiImageResponse,
	}
}

func openAIVideosAdapter() Adapter {
	info := metadata("newapi", "OpenAI Videos", "OpenAI compatible", CapabilityVideo, "POST /v1/videos", "GET /v1/videos/{task_id}", "multipart/form-data")
	info.LegacyAliases = []string{"openai-video", "openai-videos"}
	info.Parameters = openAIVideoParams()
	return videoAdapter(info, func(r GenerationRequest) (RequestSpec, error) {
		body := map[string]any{"model": r.Model, "prompt": r.Prompt}
		if r.Duration > 0 {
			body["seconds"] = strconv.Itoa(r.Duration)
		}
		if r.AspectRatio != "" {
			body["size"] = r.AspectRatio
		}
		if len(r.Images) > 0 {
			body["input_reference"] = mediaValues(r.Images)
		}
		return RequestSpec{Method: http.MethodPost, Path: "/v1/videos", ContentType: "multipart/form-data", Body: body}, nil
	})
}

func openAIVideoParams() []Parameter {
	return []Parameter{
		{Name: "model", Type: "string", Required: true, Mapping: "model", Description: "Sora 等视频模型标识。"},
		{Name: "prompt", Type: "string", Required: true, Mapping: "prompt", Description: "视频生成提示词。"},
		{Name: "images", Type: "media[]", Mapping: "input_reference", Description: "可选参考图，作为 multipart 文件上传到 input_reference。"},
		{Name: "duration", Type: "integer", Mapping: "seconds", Description: "视频时长，单位为秒。"},
		{Name: "aspectRatio", Type: "string", Mapping: "size", Description: "视频尺寸，例如 1280x720；该协议使用 size 而不是独立的 aspect_ratio。"},
		{Name: "videos", Type: "media[]", Mapping: "unsupported", Description: "OpenAI Videos 当前适配器不发送参考视频。"},
		{Name: "audios", Type: "media[]", Mapping: "unsupported", Description: "OpenAI Videos 当前适配器不发送参考音频。"},
		{Name: "resolution", Type: "string", Mapping: "unsupported", Description: "分辨率通过 size 表达。"},
		{Name: "generateAudio", Type: "boolean", Mapping: "unsupported", Description: "当前适配器不额外发送该字段。"},
		{Name: "watermark", Type: "boolean", Mapping: "unsupported", Description: "当前适配器不额外发送该字段。"},
	}
}

func newAPIVideosAdapter() Adapter {
	info := metadata("newapi-channel-2", "NewAPI Video Generations", "NewAPI", CapabilityVideo, "POST /v1/video/generations", "GET /v1/video/generations/{task_id}", "application/json")
	info.LegacyAliases = []string{"newapi-video-generations"}
	info.Parameters = videoParams()
	return videoAdapter(info, func(r GenerationRequest) (RequestSpec, error) {
		body := map[string]any{"model": r.Model, "prompt": r.Prompt, "seconds": strconv.Itoa(defaultInt(r.Duration, 6)), "aspect_ratio": defaultValue(r.AspectRatio, "16:9")}
		copyIf(body, "resolution", r.Resolution)
		if r.GenerateAudio {
			body["generate_audio"] = true
		}
		if len(r.Images) > 0 {
			body["image_urls"] = mediaValues(r.Images)
		}
		if len(r.Videos) > 0 {
			body["video_urls"] = mediaValues(r.Videos)
		}
		if len(r.Audios) > 0 {
			body["audio_urls"] = mediaValues(r.Audios)
		}
		return jsonSpec(http.MethodPost, "/v1/video/generations", body), nil
	})
}

func newAPIChannel1Adapter() Adapter {
	info := metadata("newapi-channel-1", "NewAPI 媒体任务", "NewAPI", CapabilityVideo, "POST /v1/videos", "GET /v1/videos/{task_id}", "application/json")
	info.Parameters = videoParams()
	return videoAdapter(info, func(r GenerationRequest) (RequestSpec, error) {
		media := make([]map[string]string, 0, len(r.Images)+len(r.Videos)+len(r.Audios))
		for _, image := range r.Images {
			media = append(media, map[string]string{"type": "reference_image", "url": mediaValue(image)})
		}
		for _, video := range r.Videos {
			media = append(media, map[string]string{"type": "reference_video", "url": mediaValue(video)})
		}
		for _, audio := range r.Audios {
			media = append(media, map[string]string{"type": "reference_voice", "url": mediaValue(audio)})
		}
		input := map[string]any{"prompt": r.Prompt}
		if len(media) > 0 {
			input["media"] = media
		}
		parameters := map[string]any{"resolution": defaultValue(r.Resolution, "720P"), "ratio": defaultValue(r.AspectRatio, "16:9"), "duration": defaultInt(r.Duration, 5)}
		if r.Watermark {
			parameters["watermark"] = true
		}
		return jsonSpec(http.MethodPost, "/v1/videos", map[string]any{"model": r.Model, "input": input, "parameters": parameters}), nil
	})
}

func xAIVideosAdapter() Adapter {
	info := metadata("xai-video", "xAI 官方视频", "xAI", CapabilityVideo, "POST /v1/videos/generations", "GET /v1/videos/{request_id}", "application/json")
	info.Parameters = videoParams()
	return videoAdapter(info, func(r GenerationRequest) (RequestSpec, error) {
		body := map[string]any{"model": r.Model, "prompt": r.Prompt, "duration": defaultInt(r.Duration, 6), "aspect_ratio": defaultValue(r.AspectRatio, "16:9"), "resolution": defaultValue(r.Resolution, "720p")}
		if len(r.Images) == 1 {
			body["image"] = map[string]any{"url": mediaValue(r.Images[0])}
		} else if len(r.Images) > 1 {
			refs := make([]any, 0, len(r.Images))
			for _, image := range r.Images {
				refs = append(refs, map[string]any{"url": mediaValue(image)})
			}
			body["reference_images"] = refs
		}
		return jsonSpec(http.MethodPost, "/v1/videos/generations", body), nil
	})
}

func arkVideosAdapter() Adapter {
	info := metadata("volcengine-ark-video", "火山方舟视频", "Volcengine Ark", CapabilityVideo, "POST /api/v3/contents/generations/tasks", "GET /api/v3/contents/generations/tasks/{task_id}", "application/json")
	info.Parameters = videoParams()
	return videoAdapter(info, func(r GenerationRequest) (RequestSpec, error) {
		if len(r.Images) > 9 || len(r.Videos) > 3 || len(r.Audios) > 3 {
			return RequestSpec{}, fmt.Errorf("火山方舟全模态参考最多支持 9 张图片、3 个视频和 3 个音频")
		}
		if len(r.Audios) > 0 && len(r.Images) == 0 && len(r.Videos) == 0 {
			return RequestSpec{}, fmt.Errorf("火山方舟全模态参考不支持纯音频或文本+音频，请同时添加参考图片或参考视频")
		}
		content := []any{map[string]any{"type": "text", "text": r.Prompt}}
		for _, image := range r.Images {
			content = append(content, map[string]any{"type": "image_url", "image_url": map[string]any{"url": mediaValue(image)}, "role": "reference_image"})
		}
		for _, video := range r.Videos {
			content = append(content, map[string]any{"type": "video_url", "video_url": map[string]any{"url": mediaValue(video)}, "role": "reference_video"})
		}
		for _, audio := range r.Audios {
			content = append(content, map[string]any{"type": "audio_url", "audio_url": map[string]any{"url": mediaValue(audio)}, "role": "reference_audio"})
		}
		body := map[string]any{"model": r.Model, "content": content, "ratio": defaultValue(r.AspectRatio, "16:9"), "resolution": defaultValue(r.Resolution, "720p"), "duration": defaultInt(r.Duration, 5)}
		if r.GenerateAudio {
			body["generate_audio"] = true
		}
		if r.Watermark {
			body["watermark"] = true
		}
		return jsonSpec(http.MethodPost, "/api/v3/contents/generations/tasks", body), nil
	})
}

func jimengVideosAdapter() Adapter {
	info := metadata("volcengine-jimeng-video", "即梦官方视频", "Volcengine Jimeng", CapabilityVideo, "POST CVSync2AsyncSubmitTask", "POST CVSync2AsyncGetResult", "application/json + AK/SK signature")
	info.Parameters = videoParams()
	return videoAdapterWithPoll(info, func(r GenerationRequest) (RequestSpec, error) {
		body := map[string]any{"req_key": r.Model, "prompt": r.Prompt}
		if len(r.Images) > 0 {
			body["image_urls"] = mediaValues(r.Images)
		}
		mergeExtra(body, r.Extra, "req_key", "prompt", "image_urls", "duration", "ratio", "resolution")
		return jsonSpec(http.MethodPost, "/CVSync2AsyncSubmitTask", body), nil
	}, func(c PollContext) (RequestSpec, error) {
		return jsonSpec(http.MethodPost, "/CVSync2AsyncGetResult", map[string]any{"req_key": c.Model, "task_id": c.TaskID}), nil
	})
}

func geminiVeoAdapter() Adapter {
	info := metadata("gemini-veo", "Gemini Veo", "Google", CapabilityVideo, "POST /v1beta/models/{model}:predictLongRunning", "GET /v1beta/{operation_name}", "application/json")
	info.Parameters = videoParams()
	create := func(r GenerationRequest) (RequestSpec, error) {
		instance := map[string]any{"prompt": r.Prompt}
		if len(r.Images) > 0 {
			image := r.Images[0]
			instance["image"] = map[string]any{"inlineData": map[string]any{"mimeType": dataMIME(image.DataURL), "data": dataPayload(image.DataURL)}}
		}
		body := map[string]any{"instances": []any{instance}, "parameters": compactMap(map[string]any{"aspectRatio": r.AspectRatio, "durationSeconds": r.Duration, "resolution": r.Resolution, "generateAudio": r.GenerateAudio})}
		return jsonSpec(http.MethodPost, "/v1beta/models/"+url.PathEscape(r.Model)+":predictLongRunning", body), nil
	}
	poll := func(c PollContext) (RequestSpec, error) {
		operation := strings.TrimPrefix(c.TaskID, "/")
		if !strings.HasPrefix(operation, "operations/") {
			operation = "operations/" + operation
		}
		return RequestSpec{Method: http.MethodGet, Path: "/v1beta/" + operation}, nil
	}
	return builtinAdapter{info: info, create: create, parseCreate: parseGeminiVeoCreate, poll: poll, parsePoll: parseGeminiVeoPoll}
}

func novitaVideosAdapter() Adapter {
	info := metadata("novita-video", "Novita 视频", "Novita", CapabilityVideo, "POST /v3/video/create", "GET /v3/async/task-result?task_id={id}", "application/json")
	info.Parameters = videoParams()
	return videoAdapter(info, func(r GenerationRequest) (RequestSpec, error) {
		body := map[string]any{"model_name": r.Model, "prompt": r.Prompt, "duration": defaultInt(r.Duration, 5), "aspect_ratio": defaultValue(r.AspectRatio, "16:9")}
		if len(r.Images) > 0 {
			body["image_url"] = mediaValue(r.Images[0])
		}
		return jsonSpec(http.MethodPost, "/v3/video/create", body), nil
	})
}

func miniMaxVideosAdapter() Adapter {
	info := metadata("minimax-video", "MiniMax 视频", "MiniMax", CapabilityVideo, "POST /v2/video_generation", "GET /v2/query/video_generation/{task_id}", "application/json")
	info.Parameters = videoParams()
	return videoAdapter(info, func(r GenerationRequest) (RequestSpec, error) {
		content := []any{map[string]any{"type": "text", "text": r.Prompt}}
		for _, image := range r.Images {
			content = append(content, map[string]any{"type": "image_url", "image_url": map[string]any{"url": mediaValue(image)}, "role": "reference_image"})
		}
		body := map[string]any{"model": r.Model, "prompt": r.Prompt, "duration": defaultInt(r.Duration, 6), "content": content}
		mergeExtra(body, r.Extra, "model", "prompt", "duration", "content", "resolution", "aspect_ratio")
		return jsonSpec(http.MethodPost, "/v2/video_generation", body), nil
	})
}

func openAIAudioAdapter() Adapter {
	info := metadata("openai-audio", "OpenAI Audio", "OpenAI", CapabilityAudio, "POST /v1/audio/speech", "", "application/json")
	return builtinAdapter{info: info, create: func(r GenerationRequest) (RequestSpec, error) {
		return jsonSpec(http.MethodPost, "/v1/audio/speech", map[string]any{"model": r.Model, "input": r.Prompt}), nil
	}, parseCreate: parseAudioResponse}
}

func asyncAudioAdapter() Adapter {
	info := metadata("async-audio", "异步音频任务", "OpenAI compatible", CapabilityAudio, "POST /v1/audio/tasks", "GET /v1/audio/tasks/{task_id}", "application/json")
	return asyncMediaAdapter(info, CapabilityAudio, func(r GenerationRequest) (RequestSpec, error) {
		return jsonSpec(http.MethodPost, "/v1/audio/tasks", map[string]any{"model": r.Model, "prompt": r.Prompt}), nil
	})
}

func agnesAdapter() Adapter {
	info := metadata("agnes-video", "Agnes", "Agnes", CapabilityVideo, "", "", "")
	info.Enabled = false
	info.Installable = false
	info.UnavailableReason = "未提供可验证的官方请求、鉴权、轮询和响应协议资料"
	return UnavailableAdapter{Info: info}
}

func videoAdapter(info Metadata, create func(GenerationRequest) (RequestSpec, error)) Adapter {
	return asyncMediaAdapterWithPoll(info, CapabilityVideo, create, func(c PollContext) (RequestSpec, error) {
		path := strings.TrimSpace(info.Poll)
		if index := strings.IndexByte(path, ' '); index > 0 {
			path = strings.TrimSpace(path[index+1:])
		}
		path = strings.Replace(path, "{task_id}", url.PathEscape(c.TaskID), 1)
		path = strings.Replace(path, "{request_id}", url.PathEscape(c.TaskID), 1)
		path = strings.Replace(path, "{id}", url.QueryEscape(c.TaskID), 1)
		return RequestSpec{Method: http.MethodGet, Path: path}, nil
	})
}

func videoAdapterWithPoll(info Metadata, create func(GenerationRequest) (RequestSpec, error), poll func(PollContext) (RequestSpec, error)) Adapter {
	return asyncMediaAdapterWithPoll(info, CapabilityVideo, create, poll)

}

func asyncMediaAdapter(info Metadata, capability Capability, create func(GenerationRequest) (RequestSpec, error)) Adapter {
	return asyncMediaAdapterWithPoll(info, capability, create, func(c PollContext) (RequestSpec, error) {
		path := strings.TrimSpace(info.Poll)
		if index := strings.IndexByte(path, ' '); index > 0 {
			path = strings.TrimSpace(path[index+1:])
		}
		path = strings.Replace(path, "{task_id}", url.PathEscape(c.TaskID), 1)
		return RequestSpec{Method: http.MethodGet, Path: path}, nil
	})
}

func asyncMediaAdapterWithPoll(info Metadata, capability Capability, create func(GenerationRequest) (RequestSpec, error), poll func(PollContext) (RequestSpec, error)) Adapter {
	return builtinAdapter{
		info: info, create: create, parseCreate: parseAsyncCreate, poll: poll,
		parsePoll: func(c PollContext, payload map[string]any) (PollResult, error) {
			return parseAsyncMediaPoll(c, payload, capability)
		},
	}
}

func jsonSpec(method, path string, body any) RequestSpec {
	return RequestSpec{Method: method, Path: path, ContentType: "application/json", Body: body}
}

func parseChatResponse(payload map[string]any) (CreateResult, error) {
	choices, _ := payload["choices"].([]any)
	if len(choices) == 0 {
		return CreateResult{}, fmt.Errorf("chat response has no choices")
	}
	choice, _ := choices[0].(map[string]any)
	message, _ := choice["message"].(map[string]any)
	return CreateResult{Status: StatusSucceeded, Result: &Result{Text: firstString(message, "content"), Usage: object(payload["usage"])}}, nil
}

func parseResponsesResponse(payload map[string]any) (CreateResult, error) {
	text := firstString(payload, "output_text", "text")
	if text == "" {
		if output, ok := payload["output"].([]any); ok {
			for _, item := range output {
				if m, ok := item.(map[string]any); ok {
					text = firstString(m, "text", "content")
					if text != "" {
						break
					}
				}
			}
		}
	}
	return CreateResult{Status: StatusSucceeded, Result: &Result{Text: text, Usage: object(payload["usage"])}}, nil
}

func parseClaudeResponse(payload map[string]any) (CreateResult, error) {
	content, _ := payload["content"].([]any)
	text := ""
	for _, item := range content {
		if m, ok := item.(map[string]any); ok && firstString(m, "type") == "text" {
			text += firstString(m, "text")
		}
	}
	return CreateResult{Status: StatusSucceeded, Result: &Result{Text: text, Usage: object(payload["usage"])}}, nil
}

func parseImageResponse(payload map[string]any) (CreateResult, error) {
	values, _ := payload["data"].([]any)
	images := make([]MediaReference, 0, len(values))
	for _, item := range values {
		media, _ := item.(map[string]any)
		if value := firstString(media, "url"); value != "" {
			images = append(images, MediaReference{URL: value, Kind: "image"})
			continue
		}
		if value := firstString(media, "b64_json", "data"); value != "" {
			if !strings.HasPrefix(value, "data:") {
				value = "data:image/png;base64," + value
			}
			images = append(images, MediaReference{DataURL: value, Kind: "image"})
		}
	}
	if len(images) == 0 {
		return CreateResult{}, fmt.Errorf("image response has no image data")
	}
	return CreateResult{Status: StatusSucceeded, Result: &Result{Images: images}}, nil
}

func parseGeminiImageResponse(payload map[string]any) (CreateResult, error) {
	images := make([]MediaReference, 0)
	if candidates, ok := payload["candidates"].([]any); ok {
		for _, candidate := range candidates {
			if c, ok := candidate.(map[string]any); ok {
				content, _ := c["content"].(map[string]any)
				parts, _ := content["parts"].([]any)
				for _, part := range parts {
					if p, ok := part.(map[string]any); ok {
						data, _ := p["inlineData"].(map[string]any)
						if data == nil {
							data, _ = p["inline_data"].(map[string]any)
						}
						if data != nil {
							images = append(images, MediaReference{DataURL: "data:" + firstString(data, "mimeType", "mime_type") + ";base64," + firstString(data, "data")})
						}
					}
				}
			}
		}
	}
	if len(images) == 0 {
		return CreateResult{}, fmt.Errorf("Gemini response has no inline image data")
	}
	return CreateResult{Status: StatusSucceeded, Result: &Result{Images: images}}, nil
}

func parseJiMengCreate(payload map[string]any) (CreateResult, error) {
	id := firstString(payload, "task_id", "taskId", "id")
	if data := object(payload["data"]); data != nil {
		id = defaultValue(firstString(data, "task_id", "taskId", "id"), id)
	}
	if id == "" {
		return CreateResult{}, fmt.Errorf("Jimeng response has no task id")
	}
	return CreateResult{TaskID: id, Status: StatusPending}, nil
}
func parseJiMengPoll(c PollContext, payload map[string]any) (PollResult, error) {
	return parseAsyncMediaPoll(c, payload, CapabilityImage)
}

func parseGeminiVeoCreate(payload map[string]any) (CreateResult, error) {
	id := firstString(payload, "name")
	if id == "" {
		return CreateResult{}, fmt.Errorf("Gemini Veo response has no operation name")
	}
	return CreateResult{TaskID: id, Status: StatusPending}, nil
}

func parseGeminiVeoPoll(c PollContext, payload map[string]any) (PollResult, error) {
	id := defaultValue(firstString(payload, "name"), c.TaskID)
	if failure := object(payload["error"]); failure != nil {
		message := firstString(failure, "message", "status")
		if message == "" {
			message = "Gemini Veo operation failed"
		}
		return PollResult{TaskID: id, Status: StatusFailed, Message: message}, nil
	}
	done, _ := payload["done"].(bool)
	if !done {
		return PollResult{TaskID: id, Status: StatusProcessing}, nil
	}
	response := object(payload["response"])
	videos := geminiVeoVideos(response)
	if len(videos) == 0 {
		return PollResult{TaskID: id, Status: StatusSucceeded}, nil
	}
	return PollResult{TaskID: id, Status: StatusSucceeded, Result: &Result{Videos: videos}}, nil
}

func geminiVeoVideos(response map[string]any) []MediaReference {
	if response == nil {
		return nil
	}
	containers := []map[string]any{response}
	for _, key := range []string{"generateVideoResponse", "generate_video_response"} {
		if nested := object(response[key]); nested != nil {
			containers = append(containers, nested)
		}
	}
	result := make([]MediaReference, 0)
	for _, container := range containers {
		for _, key := range []string{"generatedVideos", "generated_videos", "generatedSamples", "generated_samples", "videos"} {
			items, _ := container[key].([]any)
			for _, item := range items {
				entry := object(item)
				video := object(entry["video"])
				if video == nil {
					video = entry
				}
				if value := firstString(video, "uri", "url", "videoUri", "video_url"); value != "" {
					result = append(result, MediaReference{URL: value, Kind: string(CapabilityVideo)})
				}
			}
		}
	}
	return result
}

func parseAsyncCreate(payload map[string]any) (CreateResult, error) {
	id := firstString(payload, "id", "task_id", "taskId", "request_id")
	status := normalizeStatus(firstString(payload, "status", "state"))
	if task := object(payload["task"]); task != nil {
		id = defaultValue(firstString(task, "id", "task_id", "taskId", "request_id"), id)
		status = normalizeStatus(defaultValue(firstString(task, "status", "state"), string(status)))
	}
	if data := object(payload["data"]); data != nil {
		id = defaultValue(firstString(data, "id", "task_id", "taskId", "request_id"), id)
		status = normalizeStatus(defaultValue(firstString(data, "status", "state"), string(status)))
	}
	if id == "" {
		return CreateResult{}, fmt.Errorf("async response has no task id")
	}
	if status == "" {
		status = StatusPending
	}
	return CreateResult{TaskID: id, Status: status, Message: firstString(payload, "message", "error")}, nil
}

func parseAsyncMediaPoll(c PollContext, payload map[string]any, capability Capability) (PollResult, error) {
	if capability != CapabilityImage && capability != CapabilityVideo && capability != CapabilityAudio {
		return PollResult{}, fmt.Errorf("unsupported async media capability %q", capability)
	}
	status := normalizeStatus(firstString(payload, "status", "state", "task_status"))
	if task := object(payload["task"]); task != nil {
		status = normalizeStatus(defaultValue(firstString(task, "status", "state"), string(status)))
		payload = mergeMaps(task, payload)
	}
	if data := object(payload["data"]); data != nil {
		payload = mergeMaps(data, payload)
		status = normalizeStatus(defaultValue(firstString(data, "status", "state"), string(status)))
	}
	if status == "" {
		status = StatusProcessing
	}
	result := &Result{}
	resultKind := string(capability)
	references := mediaFromArray(payload[resultKind+"s"], capability)
	references = append(references, mediaFromArray(payload["data"], capability)...)
	if content := object(payload["content"]); content != nil {
		references = append(references, mediaFromArray([]any{content}, capability)...)
	}
	keys := []string{resultKind + "_url", resultKind + "Url", "result_url", "url"}
	if resultKind == "video" {
		keys = append(keys, "object")
	}
	if value := firstString(payload, keys...); value != "" {
		references = append(references, MediaReference{URL: value, Kind: resultKind})
	}
	switch capability {
	case CapabilityImage:
		result.Images = references
	case CapabilityAudio:
		result.Audios = references
	case CapabilityVideo:
		result.Videos = references
	}
	if status == StatusSucceeded && len(references) == 0 {
		result = nil
	}
	return PollResult{TaskID: defaultValue(firstString(payload, "id", "task_id", "taskId"), c.TaskID), Status: status, Result: result, Message: firstString(payload, "message", "error", "fail_reason")}, nil
}

func parseAudioResponse(payload map[string]any) (CreateResult, error) {
	value := firstString(payload, "url", "audio_url", "data")
	if value == "" {
		return CreateResult{}, fmt.Errorf("audio response has no result")
	}
	return CreateResult{Status: StatusSucceeded, Result: &Result{Audios: []MediaReference{{URL: value, Kind: "audio"}}}}, nil
}

func normalizeStatus(raw string) Status {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "queued", "pending", "created", "submitted", "in_queue", "task_status_queued":
		return StatusPending
	case "running", "processing", "in_progress", "executing", "task_status_running":
		return StatusProcessing
	case "succeeded", "success", "completed", "complete", "done", "task_status_succeed":
		return StatusSucceeded
	case "failed", "failure", "error", "cancelled", "canceled", "expired":
		return StatusFailed
	default:
		return ""
	}
}

func decodeObject(body []byte) (map[string]any, error) {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("protocol response is not JSON: %w", err)
	}
	return payload, nil
}
func object(value any) map[string]any { result, _ := value.(map[string]any); return result }
func mergeMaps(primary, fallback map[string]any) map[string]any {
	result := make(map[string]any, len(fallback)+len(primary))
	for k, v := range fallback {
		result[k] = v
	}
	for k, v := range primary {
		result[k] = v
	}
	return result
}
func firstString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := payload[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
func defaultValue(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
func defaultInt(value, fallback int) int {
	if value <= 0 {
		return fallback
	}
	return value
}
func copyIf(body map[string]any, key, value string) {
	if strings.TrimSpace(value) != "" {
		body[key] = value
	}
}
func mergeExtra(body map[string]any, extra map[string]any, keys ...string) {
	for _, key := range keys {
		if value, ok := extra[key]; ok {
			body[key] = value
		}
	}
}
func compactMap(body map[string]any) map[string]any {
	result := make(map[string]any)
	for key, value := range body {
		switch item := value.(type) {
		case string:
			if strings.TrimSpace(item) != "" {
				result[key] = value
			}
		case int:
			if item > 0 {
				result[key] = value
			}
		case bool:
			result[key] = value
		case nil:
		default:
			result[key] = item
		}
	}
	return result
}
func mediaValue(media MediaReference) string { return defaultValue(media.URL, media.DataURL) }
func mediaValues(values []MediaReference) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if item := mediaValue(value); item != "" {
			result = append(result, item)
		}
	}
	return result
}
func mediaFromArray(value any, capability Capability) []MediaReference {
	values, _ := value.([]any)
	result := make([]MediaReference, 0, len(values))
	kind := string(capability)
	for _, item := range values {
		if value, ok := item.(string); ok && strings.TrimSpace(value) != "" {
			result = append(result, MediaReference{URL: strings.TrimSpace(value), Kind: kind})
			continue
		}
		if m, ok := item.(map[string]any); ok {
			if capability == CapabilityImage {
				if value := firstString(m, "b64_json", "data"); value != "" {
					if !strings.HasPrefix(value, "data:") {
						value = "data:image/png;base64," + value
					}
					result = append(result, MediaReference{DataURL: value, Kind: kind})
					continue
				}
			}
			if value := firstString(m, "url", "image_url", "video_url", "audio_url"); value != "" {
				result = append(result, MediaReference{URL: value, Kind: kind})
			}
		}
	}
	return result
}
func dataMIME(value string) string {
	if index := strings.Index(value, ";"); strings.HasPrefix(value, "data:") && index > 5 {
		return strings.TrimPrefix(value[5:index], "")
	}
	return "application/octet-stream"
}
func dataPayload(value string) string {
	if index := strings.Index(value, ","); strings.HasPrefix(value, "data:") && index >= 0 {
		return value[index+1:]
	}
	return value
}
