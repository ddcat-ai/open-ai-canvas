package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

const testReferenceImageDataURL = "data:image/png;base64,aGVsbG8="
const testGeminiReferenceImageDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="

func TestProviderRequestErrorDetails(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code string
		text string
	}{
		{name: "cancelled", err: context.Canceled, code: "request_cancelled", text: "任务取消，中断上游请求"},
		{name: "timeout", err: context.DeadlineExceeded, code: "upstream_timeout", text: "等待上游响应超时"},
		{name: "network error", err: errors.New("dial tcp: connection refused"), text: "dial tcp: connection refused"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, text := providerRequestErrorDetails(tt.err)
			if code != tt.code || text != tt.text {
				t.Fatalf("providerRequestErrorDetails() = (%q, %q), want (%q, %q)", code, text, tt.code, tt.text)
			}
		})
	}
}

func TestChannelAPIURLNormalizesConfiguredVersionPrefix(t *testing.T) {
	tests := []struct {
		name string
		base string
		path string
		want string
	}{
		{name: "host", base: "http://provider.test:8000", path: "/chat/completions", want: "http://provider.test:8000/v1/chat/completions"},
		{name: "host slash", base: "http://provider.test:8000/", path: "/chat/completions", want: "http://provider.test:8000/v1/chat/completions"},
		{name: "v1", base: "http://provider.test:8000/v1", path: "/chat/completions", want: "http://provider.test:8000/v1/chat/completions"},
		{name: "v1 slash", base: "http://provider.test:8000/v1/", path: "/chat/completions", want: "http://provider.test:8000/v1/chat/completions"},
		{name: "path carries v1beta", base: "http://provider.test:8000", path: "/v1beta/models/model", want: "http://provider.test:8000/v1beta/models/model"},
		{name: "same v1beta is not duplicated", base: "http://provider.test:8000/v1beta", path: "/v1beta/models/model", want: "http://provider.test:8000/v1beta/models/model"},
		{name: "path carries v2", base: "http://provider.test:8000/v1", path: "/v2/tasks", want: "http://provider.test:8000/v2/tasks"},
		{name: "ark v3", base: "https://ark.example.com/api/v3", path: "/images/generations", want: "https://ark.example.com/api/v3/images/generations"},
		{name: "path carries ark v3", base: "https://ark.example.com", path: "/api/v3/images/generations", want: "https://ark.example.com/api/v3/images/generations"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ChannelAPIURL(tt.base, tt.path); got != tt.want {
				t.Fatalf("ChannelAPIURL(%q, %q) = %q, want %q", tt.base, tt.path, got, tt.want)
			}
		})
	}
}

func TestChannelAPIURLForProtocolUsesGeminiDefault(t *testing.T) {
	if got := ChannelAPIURLForProtocol("https://generativelanguage.googleapis.com", "/models/gemini:generateContent", model.ChannelInterfaceGeminiVeo); got != "https://generativelanguage.googleapis.com/v1beta/models/gemini:generateContent" {
		t.Fatalf("Gemini URL = %q", got)
	}
}

func TestSystemChannelIDFromBaseURLSupportsShortAndLegacyProxyPaths(t *testing.T) {
	for _, test := range []struct{ base, want string }{
		{base: "/api/channel-1", want: "channel-1"},
		{base: "/api/ai/system/channel-2", want: "channel-2"},
		{base: "https://canvas.example.com/api/channel-3", want: "channel-3"},
	} {
		if got := systemChannelIDFromBaseURL(test.base); got != test.want {
			t.Fatalf("systemChannelIDFromBaseURL(%q) = %q, want %q", test.base, got, test.want)
		}
	}
}

func TestWriteMediaPartSanitizesFilenameAndSetsMimeType(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writeMediaPart(writer, "image", providerMedia{ID: "image-1", Name: "提示词\n带换行.png", Type: "image/png", DataURL: testReferenceImageDataURL}); err != nil {
		t.Fatalf("writeMediaPart() error = %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("multipart.Writer.Close() error = %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "http://example.test", bytes.NewReader(body.Bytes()))
	request.Header.Set("Content-Type", writer.FormDataContentType())
	if err := request.ParseMultipartForm(1 << 20); err != nil {
		t.Fatalf("ParseMultipartForm() error = %v", err)
	}
	files := request.MultipartForm.File["image"]
	if len(files) != 1 {
		t.Fatalf("image files = %d, want 1", len(files))
	}
	file := files[0]
	if file.Filename != "reference-image-1.png" || strings.ContainsAny(file.Filename, "\r\n") {
		t.Fatalf("filename = %q", file.Filename)
	}
	if got := file.Header.Get("Content-Type"); got != "image/png" {
		t.Fatalf("part Content-Type = %q, want image/png", got)
	}
	opened, err := file.Open()
	if err != nil {
		t.Fatalf("file.Open() error = %v", err)
	}
	defer opened.Close()
	data, err := io.ReadAll(opened)
	if err != nil {
		t.Fatalf("io.ReadAll() error = %v", err)
	}
	if string(data) != "hello" {
		t.Fatalf("file data = %q, want hello", data)
	}
}

func TestParseTextEventStreamSupportsResponsesAndChat(t *testing.T) {
	responses := []byte(`event: response.output_text.delta
data: {"delta":"{\"title\":\"分镜\""}

event: response.output_text.delta
data: {"delta":"}"}

data: [DONE]

`)
	if got, err := parseTextEventStream(responses, "responses"); err != nil || got != `{"title":"分镜"}` {
		t.Fatalf("Responses stream = %q, err = %v", got, err)
	}

	chat := []byte(`data: {"choices":[{"delta":{"content":"第一镜"}}]}

data: {"choices":[{"delta":{"content":"：远景"}}]}

data: [DONE]

`)
	if got, err := parseTextEventStream(chat, "chat-completion"); err != nil || got != "第一镜：远景" {
		t.Fatalf("Chat stream = %q, err = %v", got, err)
	}

	claude := []byte(`event: content_block_delta
data: {"delta":{"type":"text_delta","text":"第一镜"}}

event: content_block_delta
data: {"delta":{"type":"text_delta","text":"：远景"}}

`)
	if got, err := parseTextEventStream(claude, "claude-api"); err != nil || got != "第一镜：远景" {
		t.Fatalf("Claude stream = %q, err = %v", got, err)
	}
}

func TestParseAgentToolPayloadSupportsChatCompletions(t *testing.T) {
	result, err := parseAgentToolPayload(map[string]interface{}{
		"choices": []interface{}{map[string]interface{}{
			"message": map[string]interface{}{
				"content": "准备读取画布",
				"tool_calls": []interface{}{map[string]interface{}{
					"id":       "call-1",
					"function": map[string]interface{}{"name": "canvas_get_state", "arguments": `{}`},
				}},
			},
		}},
	}, "chat-completion")
	if err != nil {
		t.Fatalf("parseAgentToolPayload() error = %v", err)
	}
	if result["text"] != "准备读取画布" {
		t.Fatalf("text = %v", result["text"])
	}
	calls, _ := result["toolCalls"].([]interface{})
	if len(calls) != 1 {
		t.Fatalf("toolCalls = %#v", result["toolCalls"])
	}
	call, _ := calls[0].(map[string]interface{})
	function, _ := call["function"].(map[string]interface{})
	if call["id"] != "call-1" || function["name"] != "canvas_get_state" || function["arguments"] != `{}` {
		t.Fatalf("tool call = %#v", call)
	}
}

func TestParseAgentToolPayloadSupportsResponses(t *testing.T) {
	result, err := parseAgentToolPayload(map[string]interface{}{
		"output": []interface{}{
			map[string]interface{}{"type": "reasoning", "summary": []interface{}{map[string]interface{}{"type": "summary_text", "text": "先读取画布，再决定操作"}}},
			map[string]interface{}{"type": "message", "content": []interface{}{map[string]interface{}{"type": "output_text", "text": "开始操作"}}},
			map[string]interface{}{"type": "function_call", "call_id": "call-2", "name": "canvas_apply_ops", "arguments": `{"ops":[]}`},
		},
	}, "responses")
	if err != nil {
		t.Fatalf("parseAgentToolPayload() error = %v", err)
	}
	if result["text"] != "开始操作" {
		t.Fatalf("text = %v", result["text"])
	}
	if result["reasoning"] != "先读取画布，再决定操作" {
		t.Fatalf("reasoning = %v", result["reasoning"])
	}
	calls, _ := result["toolCalls"].([]interface{})
	if len(calls) != 1 {
		t.Fatalf("toolCalls = %#v", result["toolCalls"])
	}
	call, _ := calls[0].(map[string]interface{})
	function, _ := call["function"].(map[string]interface{})
	if call["id"] != "call-2" || function["name"] != "canvas_apply_ops" || function["arguments"] != `{"ops":[]}` {
		t.Fatalf("tool call = %#v", call)
	}
}

func TestParseAgentToolPayloadSupportsClaude(t *testing.T) {
	result, err := parseAgentToolPayload(map[string]interface{}{
		"content": []interface{}{
			map[string]interface{}{"type": "text", "text": "开始操作"},
			map[string]interface{}{"type": "tool_use", "id": "call-3", "name": "canvas_get_state", "input": map[string]interface{}{}},
		},
	}, "claude-api")
	if err != nil {
		t.Fatalf("parseAgentToolPayload() error = %v", err)
	}
	if result["text"] != "开始操作" {
		t.Fatalf("text = %v", result["text"])
	}
	calls, _ := result["toolCalls"].([]interface{})
	if len(calls) != 1 {
		t.Fatalf("toolCalls = %#v", result["toolCalls"])
	}
	call, _ := calls[0].(map[string]interface{})
	function, _ := call["function"].(map[string]interface{})
	if call["id"] != "call-3" || function["name"] != "canvas_get_state" || function["arguments"] != "{}" {
		t.Fatalf("tool call = %#v", call)
	}
}

func TestClaudeAgentBodyMapsOpenAIStyleTools(t *testing.T) {
	body := claudeAgentBody(map[string]interface{}{
		"messages": []interface{}{
			map[string]interface{}{"role": "system", "content": "You are concise."},
			map[string]interface{}{"role": "user", "content": "读取画布"},
			map[string]interface{}{"role": "assistant", "content": nil, "tool_calls": []interface{}{map[string]interface{}{
				"id": "call-4", "function": map[string]interface{}{"name": "canvas_get_state", "arguments": `{}`},
			}}},
			map[string]interface{}{"role": "tool", "tool_call_id": "call-4", "content": `{"nodes":[]}`},
		},
		"tools": []interface{}{map[string]interface{}{"type": "function", "function": map[string]interface{}{
			"name": "canvas_get_state", "description": "读取画布", "parameters": map[string]interface{}{"type": "object"},
		}}},
		"tool_choice": "required",
	})
	if body["system"] != "You are concise." || body["max_tokens"] != 4096 {
		t.Fatalf("body = %#v", body)
	}
	messages, _ := body["messages"].([]interface{})
	if len(messages) != 3 {
		t.Fatalf("messages = %#v", messages)
	}
	tools, _ := body["tools"].([]interface{})
	tool, _ := tools[0].(map[string]interface{})
	if tool["name"] != "canvas_get_state" || body["tool_choice"].(map[string]interface{})["type"] != "any" {
		t.Fatalf("tools/choice = %#v / %#v", body["tools"], body["tool_choice"])
	}
}

func TestRunAgentToolTaskFallsBackToolChoice(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var choices []interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		choice, exists := body["tool_choice"]
		if exists {
			choices = append(choices, choice)
		} else {
			choices = append(choices, nil)
		}
		w.Header().Set("Content-Type", "application/json")
		if len(choices) < 3 {
			_, _ = w.Write([]byte(`{"error":{"message":"tool_choice is incompatible with thinking mode"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"完成","tool_calls":[]}}]}`))
	}))
	defer server.Close()

	config := providerConfig{BaseURL: server.URL, APIKey: "key", Model: "thinking-model"}
	result, err := runAgentToolTask(context.Background(), canvasGenerationInput{
		Config:        config,
		AgentRequests: &agentToolRequests{ChatCompletion: map[string]interface{}{"messages": []interface{}{}, "tool_choice": "required"}},
	})
	if err != nil {
		t.Fatalf("runAgentToolTask() error = %v", err)
	}
	if result["text"] != "完成" {
		t.Fatalf("text = %v", result["text"])
	}
	if len(choices) != 3 || choices[0] != "required" || choices[1] != "auto" || choices[2] != nil {
		t.Fatalf("tool choices = %#v", choices)
	}
}

func TestPostStreamingTextSetsStreamHeaders(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Accept"); got != "text/event-stream" {
			t.Errorf("Accept = %q", got)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request body: %v", err)
		}
		if stream, ok := body["stream"].(bool); !ok || !stream {
			t.Errorf("stream body field = %#v", body["stream"])
		}
		w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
		_, _ = w.Write([]byte(`data: {"choices":[{"delta":{"content":"流式分镜"}}]}

data: [DONE]

`))
	}))
	defer server.Close()

	got, err := postStreamingText(context.Background(), providerConfig{BaseURL: server.URL, APIKey: "test-key"}, "/chat/completions", map[string]interface{}{"model": "test-model"}, "chat-completion")
	if err != nil || got != "流式分镜" {
		t.Fatalf("postStreamingText() = %q, err = %v", got, err)
	}
}

func TestProviderHTTPErrorWarnsAboutUncertain524Billing(t *testing.T) {
	message := (providerHTTPError{StatusCode: 524, Status: "524 A Timeout Occurred"}).Error()
	if !strings.Contains(message, "可能仍在服务端执行并产生费用") || !strings.Contains(message, "请勿立即重试") {
		t.Fatalf("providerHTTPError.Error() = %q", message)
	}
}

func TestProviderHTTPErrorDoesNotExposeResponseBody(t *testing.T) {
	message := (providerHTTPError{
		StatusCode: http.StatusBadGateway,
		Status:     "502 Bad Gateway",
		Body:       `{"error":{"message":"api-key=secret"}}`,
	}).Error()
	if strings.Contains(message, "api-key") || strings.Contains(message, "secret") || strings.Contains(message, `{"error"`) {
		t.Fatalf("providerHTTPError exposed upstream response body: %q", message)
	}
	if !strings.Contains(message, "HTTP 502") {
		t.Fatalf("providerHTTPError.Error() = %q", message)
	}
}

func TestProviderPayloadErrorMessageUsesSafeActionableCategories(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{name: "moderation", raw: "request blocked by content policy: prompt=private", want: "安全审核"},
		{name: "quota", raw: "insufficient quota for api-key=secret", want: "额度不足"},
		{name: "model access", raw: "model not found for tenant secret-id", want: "模型不存在"},
		{name: "unknown", raw: "trace_id=private internal stack", want: "模型服务返回失败"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			message := providerPayloadErrorMessage(tt.raw)
			if !strings.Contains(message, tt.want) {
				t.Fatalf("providerPayloadErrorMessage() = %q, want category %q", message, tt.want)
			}
			if strings.Contains(message, "secret") || strings.Contains(message, "private") {
				t.Fatalf("provider payload detail leaked: %q", message)
			}
		})
	}
}

func TestNormalizeNewAPIChannel2ResolutionPreservesDeclaredTiers(t *testing.T) {
	tests := map[string]string{
		"1440": "1440p",
		"2k":   "1440p",
		"4K":   "2160p",
		"768p": "768p",
	}
	for input, want := range tests {
		t.Run(input, func(t *testing.T) {
			if got := normalizeNewAPIChannel2Resolution(input, "custom-video-model"); got != want {
				t.Fatalf("normalizeNewAPIChannel2Resolution(%q) = %q, want %q", input, got, want)
			}
		})
	}
}

func TestVolcengineArkImageBodyUsesJSONReferencesAndDownscalesSize(t *testing.T) {
	body, err := volcengineArkImageBody(canvasGenerationInput{
		Prompt: "combine the references",
		Config: providerConfig{Model: "doubao-seedream-test", Size: "3840x2160", SystemPrompt: "keep the subject"},
		ReferenceImages: []providerMedia{
			{URL: "https://example.com/first.png"},
			{DataURL: testReferenceImageDataURL},
		},
	})
	if err != nil {
		t.Fatalf("volcengineArkImageBody() error = %v", err)
	}
	images, ok := body["image"].([]string)
	if !ok || len(images) != 2 || images[0] != "https://example.com/first.png" || images[1] != testReferenceImageDataURL {
		t.Fatalf("image = %#v", body["image"])
	}
	if body["prompt"] != "keep the subject\n\ncombine the references" {
		t.Fatalf("prompt = %q", body["prompt"])
	}
	if watermark, ok := body["watermark"].(bool); !ok || watermark {
		t.Fatalf("watermark = %#v, want false", body["watermark"])
	}
	if responseFormat, _ := body["response_format"].(string); responseFormat != "b64_json" {
		t.Fatalf("response_format = %#v, want b64_json", body["response_format"])
	}
	size, _ := body["size"].(string)
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		t.Fatalf("size = %q", size)
	}
	width, _ := strconv.Atoi(parts[0])
	height, _ := strconv.Atoi(parts[1])
	if width%2 != 0 || height%2 != 0 || int64(width)*int64(height) < volcengineArkImageMinPixels || int64(width)*int64(height) > volcengineArkImageMaxPixels {
		t.Fatalf("downscaled size = %q", size)
	}
}

func TestVolcengineArkImageBodyUpscalesPresetBelowMinimumPixels(t *testing.T) {
	body, err := volcengineArkImageBody(canvasGenerationInput{
		Prompt: "vertical image",
		Config: providerConfig{Model: "doubao-seedream-test", Size: "9:16"},
	})
	if err != nil {
		t.Fatalf("volcengineArkImageBody() error = %v", err)
	}
	size, _ := body["size"].(string)
	parts := strings.Split(size, "x")
	if len(parts) != 2 {
		t.Fatalf("size = %q", size)
	}
	width, _ := strconv.Atoi(parts[0])
	height, _ := strconv.Atoi(parts[1])
	pixels := int64(width) * int64(height)
	if width%2 != 0 || height%2 != 0 || pixels < volcengineArkImageMinPixels || pixels > volcengineArkImageMaxPixels {
		t.Fatalf("normalized size = %q", size)
	}
}

func TestVolcengineArkImageDataURLsDownloadsRemoteResult(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	imageBytes := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(imageBytes)
	}))
	defer server.Close()

	images, err := volcengineArkImageDataURLs(context.Background(), providerConfig{}, imageResponse{
		Data: []map[string]interface{}{{"url": server.URL + "/generated.png"}},
	})
	if err != nil {
		t.Fatalf("volcengineArkImageDataURLs() error = %v", err)
	}
	if len(images) != 1 || !strings.HasPrefix(images[0]["dataUrl"], "data:image/png;base64,") {
		t.Fatalf("images = %#v", images)
	}

	svc := newResourceTestService(t)
	stored, err := svc.persistGeneratedMediaResult("user-1", map[string]interface{}{"mode": "image", "images": images})
	if err != nil {
		t.Fatalf("persistGeneratedMediaResult() error = %v", err)
	}
	storedImages, ok := stored["images"].([]interface{})
	if !ok || len(storedImages) != 1 {
		t.Fatalf("stored images = %#v", stored["images"])
	}
	storedImage, ok := storedImages[0].(map[string]interface{})
	if !ok || !strings.HasPrefix(stringField(storedImage, "storageKey"), "resource:") || !strings.HasPrefix(stringField(storedImage, "dataUrl"), "/api/resources/") {
		t.Fatalf("stored image = %#v", storedImages[0])
	}
}

func TestVolcengineArkImageRejectsMaskBeforeRequest(t *testing.T) {
	_, err := runImageTask(context.Background(), canvasGenerationInput{
		Prompt: "edit only the masked area",
		Config: providerConfig{InterfaceType: "volcengine-ark-image"},
		Mask:   &providerMedia{DataURL: testReferenceImageDataURL},
	})
	if err == nil || !strings.Contains(err.Error(), "不支持蒙版") {
		t.Fatalf("runImageTask() error = %v", err)
	}
}

func TestRunGeminiImageTaskUsesInlineDataAndImageConfig(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/models/gemini-test:generateContent" {
			t.Errorf("path = %q, want /v1beta/models/gemini-test:generateContent", r.URL.Path)
		}
		if got := r.Header.Get("x-goog-api-key"); got != "test-key" {
			t.Errorf("x-goog-api-key = %q, want test-key", got)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		contents, ok := body["contents"].([]interface{})
		if !ok || len(contents) != 1 {
			t.Fatalf("contents = %#v", body["contents"])
		}
		content, _ := contents[0].(map[string]interface{})
		parts, ok := content["parts"].([]interface{})
		if !ok || len(parts) != 2 {
			t.Fatalf("parts = %#v", content["parts"])
		}
		textPart, _ := parts[0].(map[string]interface{})
		if textPart["text"] != "edit this image" {
			t.Errorf("text part = %#v", textPart)
		}
		imagePart, _ := parts[1].(map[string]interface{})
		inlineData, _ := imagePart["inlineData"].(map[string]interface{})
		if inlineData["mimeType"] != "image/png" || inlineData["data"] != "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" {
			t.Errorf("inlineData = %#v", inlineData)
		}
		generationConfig, _ := body["generationConfig"].(map[string]interface{})
		modalities, _ := generationConfig["responseModalities"].([]interface{})
		if !reflect.DeepEqual(modalities, []interface{}{"TEXT", "IMAGE"}) {
			t.Errorf("responseModalities = %#v", modalities)
		}
		imageConfig, _ := generationConfig["imageConfig"].(map[string]interface{})
		if imageConfig["aspectRatio"] != "16:9" || imageConfig["imageSize"] != "4K" {
			t.Errorf("imageConfig = %#v", imageConfig)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aGVsbG8="}}]}}]}`))
	}))
	defer server.Close()

	result, err := runImageTask(context.Background(), canvasGenerationInput{
		Prompt:          "edit this image",
		Config:          providerConfig{BaseURL: server.URL, APIKey: "test-key", APIFormat: "gemini", Model: "gemini-test", InterfaceType: "gemini-image", Size: "16:9", Quality: "high"},
		ReferenceImages: []providerMedia{{DataURL: testGeminiReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatalf("runImageTask() error = %v", err)
	}
	images, _ := result["images"].([]map[string]string)
	if len(images) != 1 || images[0]["dataUrl"] != testReferenceImageDataURL {
		t.Fatalf("images = %#v", result["images"])
	}
}

func TestRunGeminiImageTaskRejectsInvalidReferenceBeforeRequest(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		http.Error(w, "unexpected upstream request", http.StatusInternalServerError)
	}))
	defer server.Close()

	_, err := runImageTask(context.Background(), canvasGenerationInput{
		Prompt:          "edit this image",
		Config:          providerConfig{BaseURL: server.URL, APIKey: "test-key", APIFormat: "gemini", Model: "gemini-test", InterfaceType: "gemini-image"},
		ReferenceImages: []providerMedia{{DataURL: "data:text/plain;base64,aGVsbG8="}},
	})
	if err == nil || !strings.Contains(err.Error(), "读取 Gemini Images 参考图失败") || !strings.Contains(err.Error(), "MIME 类型无效") {
		t.Fatalf("runImageTask() error = %v", err)
	}
	if called {
		t.Fatal("invalid reference image must be rejected before upstream request")
	}
}

func TestRunImageTaskOmitsAutomaticQualityAndSize(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if _, exists := body["quality"]; exists {
			t.Errorf("quality = %#v, want omitted for auto", body["quality"])
		}
		if _, exists := body["size"]; exists {
			t.Errorf("size = %#v, want omitted for auto", body["size"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"aGVsbG8="}]}`))
	}))
	defer server.Close()

	profile := DefaultImageCapabilityConfig("openai-image", "gpt-image-2")
	profile.Size = ImageSizeConfig{Parameter: "size", Values: []string{"auto", "1024x1024"}, Default: "1024x1024", AllowCustom: false}
	profile.Quality = ImageQualityConfig{Supported: true, Values: []string{"auto", "low", "medium", "high"}, Default: "high"}
	_, err := runImageTask(context.Background(), canvasGenerationInput{
		Prompt:          "a product photo",
		Config:          providerConfig{BaseURL: server.URL, APIKey: "key", Model: "gpt-image-2", InterfaceType: "openai-image", Size: "auto", Quality: "auto"},
		ImageCapability: profile,
	})
	if err != nil {
		t.Fatalf("runImageTask() error = %v", err)
	}
}

func TestRunGrokImageTaskUsesJSONEditContract(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			t.Errorf("path = %q, want /v1/images/edits", r.URL.Path)
		}
		if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
			t.Errorf("Content-Type = %q, want application/json", contentType)
		}
		var body grokImageRequest
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if body.Model != "grok-imagine-image-quality" || body.N != 1 || body.ResponseFormat != "url" {
			t.Fatalf("request body = %#v", body)
		}
		if body.Image == nil || body.Image.URL != testReferenceImageDataURL {
			t.Fatalf("image = %#v", body.Image)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"url":"https://example.com/result.png"}]}`))
	}))
	defer server.Close()

	result, err := runImageTask(context.Background(), canvasGenerationInput{
		Mode:            "image",
		Prompt:          "edit the reference",
		Config:          providerConfig{BaseURL: server.URL, APIKey: "key", Model: "grok-imagine-image-quality", InterfaceType: "grok-image"},
		ReferenceImages: []providerMedia{{DataURL: testReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatalf("runImageTask() error = %v", err)
	}
	images, _ := result["images"].([]map[string]string)
	if len(images) != 1 || images[0]["dataUrl"] != "https://example.com/result.png" {
		t.Fatalf("images = %#v", result["images"])
	}
}

func TestGrokImageRequestBodyMapsAspectRatio(t *testing.T) {
	body, path, err := grokImageRequestBody(canvasGenerationInput{
		Prompt: "a cat",
		Config: providerConfig{Model: "grok-imagine-image", InterfaceType: "grok-image", Size: "9:16", Quality: "2k"},
	})
	if err != nil {
		t.Fatalf("grokImageRequestBody() error = %v", err)
	}
	if path != "/images/generations" {
		t.Fatalf("path = %q", path)
	}
	if body.AspectRatio != "9:16" || body.Resolution != "2k" {
		t.Fatalf("body = %#v", body)
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal body: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	// Grok 使用 aspect_ratio；测试锁定请求 JSON，防止非法 size 字段再次混入。
	if _, exists := payload["size"]; exists {
		t.Fatalf("request body must not contain size: %s", encoded)
	}
	if got := normalizeGrokImageAspectRatio("1280x720"); got != "16:9" {
		t.Fatalf("normalize 1280x720 = %q", got)
	}
	if got := normalizeGrokImageAspectRatio("720x1280"); got != "9:16" {
		t.Fatalf("normalize 720x1280 = %q", got)
	}
}

func TestNormalizeGrokImageAspectRatioPixelSizes(t *testing.T) {
	// 像素尺寸路径必须覆盖 2:3 / 3:2 / 1:2 / 2:1：修复前 768x1152 会被 w>h 兜底错标成 9:16、
	// 1152x768 错标成 16:9，xAI 按错比例裁切生成图。
	cases := []struct {
		size string
		want string
	}{
		{"768x1152", "2:3"},  // 1280x1920 同族：竖图 2:3
		{"1280x1920", "2:3"}, // 审查复现用例
		{"1152x768", "3:2"},
		{"1920x1280", "3:2"},
		{"540x1080", "1:2"},
		{"1080x540", "2:1"},
		{"1280x720", "16:9"},
		{"720x1280", "9:16"},
		{"800x800", "1:1"},
	}
	for _, tc := range cases {
		if got := normalizeGrokImageAspectRatio(tc.size); got != tc.want {
			t.Errorf("normalizeGrokImageAspectRatio(%q) = %q, want %q", tc.size, got, tc.want)
		}
	}
	// 冒号字符串路径回归：2:3 等比值字符串应原样透传。
	for _, size := range []string{"2:3", "3:2", "1:2", "2:1"} {
		if got := normalizeGrokImageAspectRatio(size); got != size {
			t.Errorf("normalizeGrokImageAspectRatio(%q) = %q, want passthrough %q", size, got, size)
		}
	}
}

func TestNormalizeGrokImageResolution(t *testing.T) {
	if got := normalizeGrokImageResolution("1k"); got != "1k" {
		t.Fatalf("1k = %q", got)
	}
	if got := normalizeGrokImageResolution("high"); got != "2k" {
		t.Fatalf("high = %q", got)
	}
	if got := normalizeGrokImageResolution("auto"); got != "" {
		t.Fatalf("auto = %q", got)
	}
}

func TestGrokImageRequestBodyRejectsMaskAndMultipleReferences(t *testing.T) {
	if _, _, err := grokImageRequestBody(canvasGenerationInput{Config: providerConfig{InterfaceType: "grok-image"}, Mask: &providerMedia{DataURL: testReferenceImageDataURL}}); err == nil || !strings.Contains(err.Error(), "不支持蒙版") {
		t.Fatalf("mask error = %v", err)
	}
	if _, _, err := grokImageRequestBody(canvasGenerationInput{Config: providerConfig{InterfaceType: "grok-image"}, ReferenceImages: []providerMedia{{DataURL: testReferenceImageDataURL}, {DataURL: testReferenceImageDataURL}}}); err == nil || !strings.Contains(err.Error(), "只支持 1 张") {
		t.Fatalf("multiple reference error = %v", err)
	}
}

func TestGrokImageRequestBodyPrefersPublicURL(t *testing.T) {
	body, path, err := grokImageRequestBody(canvasGenerationInput{
		Config:          providerConfig{Model: "grok-imagine-image", InterfaceType: "grok-image"},
		ReferenceImages: []providerMedia{{URL: "https://example.com/reference.png", DataURL: testReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatalf("grokImageRequestBody() error = %v", err)
	}
	if path != "/images/edits" || body.Image == nil || body.Image.URL != "https://example.com/reference.png" {
		t.Fatalf("path = %q, image = %#v", path, body.Image)
	}
}

func TestNormalizePixelSizeConvertsCanvasAspectRatios(t *testing.T) {
	tests := map[string]string{
		"1:1":  "1024x1024",
		"3:2":  "1536x1024",
		"2:3":  "1024x1536",
		"4:3":  "1360x1024",
		"3:4":  "1024x1360",
		"16:9": "1824x1024",
		"9:16": "1024x1824",
		"21:9": "2352x1008",
	}
	for input, want := range tests {
		t.Run(input, func(t *testing.T) {
			if got := normalizePixelSize(input); got != want {
				t.Fatalf("normalizePixelSize(%q) = %q, want %q", input, got, want)
			}
		})
	}
}

func TestDoBinaryRejectsOversizedProviderResponse(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Length", strconv.FormatInt(maxProviderResponseBytes+1, 10))
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	_, _, err := getExternalBinary(context.Background(), server.URL)
	if err == nil || !strings.Contains(err.Error(), "超过 64MB") {
		t.Fatalf("getExternalBinary() error = %v", err)
	}
}

func TestTextResponseInputIncludesReferenceMedia(t *testing.T) {
	input := canvasGenerationInput{
		Prompt: "describe this image",
		Config: providerConfig{SystemPrompt: "answer in Chinese"},
		ReferenceImages: []providerMedia{
			{ID: "image-1", Name: "image.png", Type: "image/png", DataURL: testReferenceImageDataURL},
		},
		ReferenceVideos: []providerMedia{
			{ID: "video-1", Name: "video.mp4", Type: "video/mp4", URL: "https://example.com/reference.mp4"},
		},
	}

	value, err := textResponseInput(input)
	if err != nil {
		t.Fatalf("textResponseInput() error = %v", err)
	}
	messages, ok := value.([]map[string]interface{})
	if !ok {
		t.Fatalf("textResponseInput() = %T, want []map[string]interface{}", value)
	}
	if len(messages) != 2 {
		t.Fatalf("len(messages) = %d, want 2", len(messages))
	}
	if messages[0]["role"] != "system" || messages[0]["content"] != "answer in Chinese" {
		t.Fatalf("system message = %#v", messages[0])
	}
	content, ok := messages[1]["content"].([]map[string]interface{})
	if !ok {
		t.Fatalf("user content = %T, want []map[string]interface{}", messages[1]["content"])
	}
	if len(content) != 3 {
		t.Fatalf("len(content) = %d, want 3", len(content))
	}
	if content[0]["type"] != "input_text" || content[0]["text"] != "describe this image" {
		t.Fatalf("text content = %#v", content[0])
	}
	if content[1]["type"] != "input_image" || content[1]["image_url"] != testReferenceImageDataURL {
		t.Fatalf("image content = %#v", content[1])
	}
	if content[2]["type"] != "input_video" || content[2]["video_url"] != "https://example.com/reference.mp4" {
		t.Fatalf("video content = %#v", content[2])
	}
}

func TestTextChatContentIncludesReferenceMedia(t *testing.T) {
	input := canvasGenerationInput{
		Prompt: "describe this image",
		ReferenceImages: []providerMedia{
			{ID: "image-1", Name: "image.png", Type: "image/png", DataURL: testReferenceImageDataURL},
		},
		ReferenceVideos: []providerMedia{
			{ID: "video-1", Name: "video.mp4", Type: "video/mp4", URL: "https://example.com/reference.mp4"},
		},
	}

	value, err := textChatContent(input)
	if err != nil {
		t.Fatalf("textChatContent() error = %v", err)
	}
	content, ok := value.([]map[string]interface{})
	if !ok {
		t.Fatalf("textChatContent() = %T, want []map[string]interface{}", value)
	}
	if len(content) != 3 {
		t.Fatalf("len(content) = %d, want 3", len(content))
	}
	if content[0]["type"] != "text" || content[0]["text"] != "describe this image" {
		t.Fatalf("text content = %#v", content[0])
	}
	imageURL, ok := content[1]["image_url"].(map[string]interface{})
	if !ok {
		t.Fatalf("image_url = %T, want map[string]interface{}", content[1]["image_url"])
	}
	if content[1]["type"] != "image_url" || imageURL["url"] != testReferenceImageDataURL {
		t.Fatalf("image content = %#v", content[1])
	}
	videoURL, ok := content[2]["video_url"].(map[string]interface{})
	if !ok {
		t.Fatalf("video_url = %T, want map[string]interface{}", content[2]["video_url"])
	}
	if content[2]["type"] != "video_url" || videoURL["url"] != "https://example.com/reference.mp4" {
		t.Fatalf("video content = %#v", content[2])
	}
}

func TestTextReferenceImageRejectsInternalAssetURL(t *testing.T) {
	_, err := textResponseInput(canvasGenerationInput{
		Prompt: "describe this image",
		ReferenceImages: []providerMedia{
			{ID: "image-1", Name: "image.png", URL: "asset://local-image"},
		},
	})
	if err == nil {
		t.Fatal("textResponseInput() error = nil, want error")
	}
}

func TestSeedanceVideosBodyUsesVideosEndpointFields(t *testing.T) {
	body, err := seedanceVideosRequestBody(canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{
			Model:              "seedance-2.0-mini-480p",
			Size:               "9:16",
			VideoSeconds:       "8",
			VideoGenerateAudio: "true",
		},
		ReferenceImages: []providerMedia{
			{ID: "image-1", DataURL: testReferenceImageDataURL},
			{ID: "image-2", DataURL: "data:image/png;base64,d29ybGQ="},
		},
		ReferenceVideos: []providerMedia{{ID: "video-1", URL: "https://example.com/ref.mp4"}},
		ReferenceAudios: []providerMedia{{ID: "audio-1", DataURL: "data:audio/mpeg;base64,AAAA"}},
	})
	if err != nil {
		t.Fatalf("seedanceVideosBody() error = %v", err)
	}
	if body.Model != "seedance-2.0-mini-480p" {
		t.Fatalf("model = %#v", body.Model)
	}
	if body.AspectRatio != "9:16" || body.Duration != 8 {
		t.Fatalf("size fields = %#v %#v", body.AspectRatio, body.Duration)
	}
	if body.GenerateAudio == nil || !*body.GenerateAudio {
		t.Fatalf("generate_audio = %#v, want true", body.GenerateAudio)
	}
	if body.ImageURL != testReferenceImageDataURL {
		t.Fatalf("image_url = %#v", body.ImageURL)
	}
	if len(body.ReferenceImageURLs) != 1 || body.ReferenceImageURLs[0] != "data:image/png;base64,d29ybGQ=" {
		t.Fatalf("reference_image_urls = %#v", body.ReferenceImageURLs)
	}
	if len(body.ReferenceVideos) != 1 || body.ReferenceVideos[0] != "https://example.com/ref.mp4" {
		t.Fatalf("reference_videos = %#v", body.ReferenceVideos)
	}
	if len(body.ReferenceAudios) != 1 || body.ReferenceAudios[0] != "data:audio/mpeg;base64,AAAA" {
		t.Fatalf("reference_audios = %#v", body.ReferenceAudios)
	}
}

func TestSeedanceVideosBodyHonorsGenerateAudio(t *testing.T) {
	for _, test := range []struct {
		name  string
		value string
		want  bool
	}{
		{name: "default enabled", want: true},
		{name: "explicit enabled", value: "true", want: true},
		{name: "explicit disabled", value: "false", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			body, err := seedanceVideosRequestBody(canvasGenerationInput{
				Prompt: "make it move",
				Config: providerConfig{
					Model:              "seedance-2.0-mini-480p",
					VideoGenerateAudio: test.value,
				},
			})
			if err != nil {
				t.Fatalf("seedanceVideosBody() error = %v", err)
			}
			if body.GenerateAudio == nil || *body.GenerateAudio != test.want {
				t.Fatalf("generate_audio = %#v, want %v", body.GenerateAudio, test.want)
			}
		})
	}
}

func TestSeedanceVideosBodyUsesOrderedFrameImageURLsWhenConfigured(t *testing.T) {
	body, err := seedanceVideosRequestBody(canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{Model: "seedance-2.0-mini-480p"},
		ReferenceImages: []providerMedia{
			{ID: "character", DataURL: "data:image/png;base64,Y2hhcmFjdGVy"},
			{ID: "end-frame", DataURL: "data:image/png;base64,d29ybGQ="},
			{ID: "front-frame", DataURL: testReferenceImageDataURL},
		},
		Metadata: map[string]interface{}{"videoStartFrameNodeId": "front-frame", "videoEndFrameNodeId": "end-frame"},
	})
	if err != nil {
		t.Fatalf("seedanceVideosBody() error = %v", err)
	}
	imageURLs := body.ImageURLs
	if len(imageURLs) != 3 {
		t.Fatalf("image_urls = %#v", imageURLs)
	}
	want := []string{testReferenceImageDataURL, "data:image/png;base64,d29ybGQ=", "data:image/png;base64,Y2hhcmFjdGVy"}
	for index := range want {
		if imageURLs[index] != want[index] {
			t.Fatalf("image_urls = %#v, want %#v", imageURLs, want)
		}
	}
	if body.ImageURL != "" || body.ReferenceImageURLs != nil {
		t.Fatalf("unexpected legacy image fields in body: %#v", body)
	}
	if body.Prompt != "make it move" {
		t.Fatalf("prompt = %#v", body.Prompt)
	}
}

func TestRunVideoTaskUsesNewAPIForAnyVideoModel(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Errorf("parse create body: %v", err)
			}
			if r.FormValue("model") != "custom-video-v1" || r.FormValue("prompt") != "make it move" {
				t.Errorf("create form = %#v", r.MultipartForm.Value)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"video-1","status":"queued"}`))
		case "GET /v1/videos/video-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"video-1","status":"completed"}`))
		case "GET /v1/videos/video-1/content":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "custom-video-v1"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
	want := "POST /v1/videos,GET /v1/videos/video-1,GET /v1/videos/video-1/content"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunVideoTaskSendsOnlyDeclaredResolutionName(t *testing.T) {
	tests := []struct {
		name           string
		resolutions    []string
		quality        string
		withoutProfile bool
		want           string
	}{
		{name: "catalog omits resolution capability", quality: "720"},
		{name: "auto never invents 720p", resolutions: []string{"720p", "1080p"}, quality: "auto"},
		{name: "legacy auto never invents 720p", quality: "auto", withoutProfile: true},
		{name: "missing profile explicit 720 never invents resolution", quality: "720", withoutProfile: true},
		{name: "declared HD resolution", resolutions: []string{"1080p"}, quality: "1080", want: "1080p"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
			var got string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.Method + " " + r.URL.Path {
				case "POST /v1/videos":
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Fatalf("ParseMultipartForm() error = %v", err)
					}
					got = r.FormValue("resolution_name")
					_, _ = w.Write([]byte(`{"id":"video-resolution","status":"queued"}`))
				case "GET /v1/videos/video-resolution":
					_, _ = w.Write([]byte(`{"id":"video-resolution","status":"completed"}`))
				case "GET /v1/videos/video-resolution/content":
					w.Header().Set("Content-Type", "video/mp4")
					_, _ = w.Write([]byte("video"))
				default:
					http.NotFound(w, r)
				}
			}))
			defer server.Close()

			profile := DefaultModelCapabilityConfigForModel("newapi", "public-video").Video
			profile.Resolutions = test.resolutions
			profile.DefaultResolution = ""
			if test.withoutProfile {
				profile = nil
			}
			_, err := runVideoTask(context.Background(), canvasGenerationInput{
				Prompt:          "synthetic prompt",
				Config:          providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "public-video", VideoSeconds: "8", Size: "16:9", VQuality: test.quality},
				VideoCapability: profile,
			})
			if err != nil {
				t.Fatalf("runVideoTask() error = %v", err)
			}
			if got != test.want {
				t.Fatalf("resolution_name = %q; want %q", got, test.want)
			}
		})
	}
}

func TestRunVideoTaskUsesNestedURLBeforeResultURL(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"task_id":"video-1","status":"queued"}}`))
		case "GET /v1/videos/video-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":"success","data":{"task_id":"video-1","status":"SUCCESS","result_url":"` + server.URL + `/v1/videos/video-1/content","data":{"status":"completed","url":"` + server.URL + `/files/video.mp4"}}}`))
		case "GET /files/video.mp4":
			if authorization := r.Header.Get("Authorization"); authorization != "Bearer test-key" {
				t.Errorf("file Authorization = %q, want Bearer test-key", authorization)
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		case "GET /v1/videos/video-1/content":
			http.Error(w, "forbidden", http.StatusForbidden)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "grok-imagine-video-1.5-1080p", VideoSeconds: "15"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
	want := "POST /v1/videos,GET /v1/videos/video-1,GET /files/video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunVideoTaskUsesJSONForGrokVideo(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", contentType)
			}
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if body["model"] != "grok-video" || body["prompt"] != "make it move" {
				t.Errorf("request body = %#v", body)
			}
			if body["image"] != testReferenceImageDataURL {
				t.Errorf("image = %#v", body["image"])
			}
			images, ok := body["images"].([]interface{})
			if !ok || len(images) != 1 || images[0] != testReferenceImageDataURL {
				t.Errorf("images = %#v", body["images"])
			}
			_, _ = w.Write([]byte(`{"id":"video-1","status":"queued"}`))
		case "GET /v1/videos/video-1":
			_, _ = w.Write([]byte(`{"id":"video-1","status":"completed"}`))
		case "GET /v1/videos/video-1/content":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt:          "make it move",
		Config:          providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "grok-video", VideoSeconds: "10"},
		ReferenceImages: []providerMedia{{ID: "image-1", DataURL: testReferenceImageDataURL}},
		Metadata:        map[string]interface{}{"videoEditOperation": "image_to_video"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
}

func TestRunVideoTaskUsesXAIVideoGenerationEndpoint(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos/generations":
			if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", contentType)
			}
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if body["model"] != "grok-imagine-video-1.5" || body["prompt"] != "make it move" {
				t.Errorf("request body = %#v", body)
			}
			if body["duration"] != float64(10) || body["aspect_ratio"] != "1:1" || body["resolution"] != "720p" {
				t.Errorf("xAI settings = %#v", body)
			}
			for _, legacyField := range []string{"seconds", "size", "images"} {
				if _, exists := body[legacyField]; exists {
					t.Errorf("request body includes legacy field %q: %#v", legacyField, body)
				}
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"request_id":"video-1"}`))
		case "GET /v1/videos/video-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"done","video":{"url":"` + server.URL + `/files/video.mp4"}}`))
		case "GET /files/video.mp4":
			if authorization := r.Header.Get("Authorization"); authorization != "Bearer test-key" {
				t.Errorf("file Authorization = %q, want Bearer test-key", authorization)
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{
			BaseURL:       server.URL + "/v1",
			APIKey:        "test-key",
			Model:         "grok-imagine-video-1.5",
			InterfaceType: "xai-video",
			VideoSeconds:  "10",
			Size:          "1:1",
			VQuality:      "720",
		},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
	want := "POST /v1/videos/generations,GET /v1/videos/video-1,GET /files/video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunVideoTaskXAIVideoUsesContentEndpointForLoopbackResultURL(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos/generations":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"request_id":"video-loopback"}`))
		case "GET /v1/videos/video-loopback":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"done","video":{"url":"http://127.0.0.2:1/unreachable.mp4"}}`))
		case "GET /v1/videos/video-loopback/content":
			if authorization := r.Header.Get("Authorization"); authorization != "Bearer test-key" {
				t.Errorf("content Authorization = %q, want Bearer test-key", authorization)
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{
			BaseURL:       server.URL + "/v1",
			APIKey:        "test-key",
			Model:         "grok-imagine-video",
			InterfaceType: "xai-video",
		},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
	want := "POST /v1/videos/generations,GET /v1/videos/video-loopback,GET /v1/videos/video-loopback/content"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestXAIVideoBodyWithoutStartFramePutsAllImagesIntoReferenceImages(t *testing.T) {
	body, err := xaiVideoRequestBody(canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{
			Model:         "grok-imagine-video-1.5",
			InterfaceType: "xai-video",
			VideoSeconds:  "20",
			Size:          "1024x1792",
			VQuality:      "1080",
		},
		ReferenceImages: []providerMedia{
			{ID: "image-1", DataURL: testReferenceImageDataURL},
			{ID: "image-2", DataURL: testReferenceImageDataURL},
		},
		Metadata: map[string]interface{}{"videoEditOperation": "image_to_video"},
	})
	if err != nil {
		t.Fatalf("xaiVideoRequestBody() error = %v", err)
	}
	if body.Duration != 20 || body.AspectRatio != "9:16" || body.Resolution != "1080p" {
		t.Fatalf("xAI settings = %#v", body)
	}
	if body.Image != nil {
		t.Fatalf("image should be nil without start frame, got %#v", body.Image)
	}
	if len(body.ReferenceImages) != 2 || body.ReferenceImages[0].URL != testReferenceImageDataURL || body.ReferenceImages[1].URL != testReferenceImageDataURL {
		t.Fatalf("reference_images = %#v", body.ReferenceImages)
	}
}

func TestXAIVideoBodyWithStartFrameKeepsOfficialImageShape(t *testing.T) {
	body, err := xaiVideoRequestBody(canvasGenerationInput{
		Config: providerConfig{Model: "grok-imagine-video-1.5", InterfaceType: "xai-video"},
		ReferenceImages: []providerMedia{
			{ID: "image-1", DataURL: testReferenceImageDataURL},
		},
		Metadata: map[string]interface{}{"videoEditOperation": "image_to_video", "videoStartFrameNodeId": "image-1"},
	})
	if err != nil {
		t.Fatalf("xaiVideoRequestBody() error = %v", err)
	}
	if body.Image == nil || body.Image.URL != testReferenceImageDataURL {
		t.Fatalf("image = %#v", body.Image)
	}
	if len(body.ReferenceImages) != 0 {
		t.Fatalf("reference_images = %#v", body.ReferenceImages)
	}
}

func TestXAIVideoBodyWithStartFrameRejectsMultipleImages(t *testing.T) {
	_, err := xaiVideoRequestBody(canvasGenerationInput{
		Config: providerConfig{Model: "grok-imagine-video-1.5", InterfaceType: "xai-video"},
		ReferenceImages: []providerMedia{
			{ID: "image-1", DataURL: testReferenceImageDataURL},
			{ID: "image-2", DataURL: testReferenceImageDataURL},
		},
		Metadata: map[string]interface{}{"videoEditOperation": "image_to_video", "videoStartFrameNodeId": "image-1"},
	})
	if err == nil || !strings.Contains(err.Error(), "只支持 1 张起始图") {
		t.Fatalf("xaiVideoRequestBody() error = %v", err)
	}
}

func TestXAIVideoBodyWithMissingStartFrameImageErrors(t *testing.T) {
	_, err := xaiVideoRequestBody(canvasGenerationInput{
		Config: providerConfig{Model: "grok-imagine-video-1.5", InterfaceType: "xai-video"},
		ReferenceImages: []providerMedia{
			{ID: "image-2", DataURL: testReferenceImageDataURL},
		},
		Metadata: map[string]interface{}{"videoEditOperation": "image_to_video", "videoStartFrameNodeId": "image-1"},
	})
	if err == nil || !strings.Contains(err.Error(), "首帧参考图未包含") {
		t.Fatalf("xaiVideoRequestBody() error = %v", err)
	}
}

func TestNewAPIVideoPromptKeepsTextOnlyPromptUnchanged(t *testing.T) {
	input := canvasGenerationInput{
		Prompt: "make it move",
	}
	if prompt := newAPIVideoPromptText(input); prompt != "make it move" {
		t.Fatalf("prompt = %q", prompt)
	}
}

func TestVideoProviderPromptsKeepReferencePromptUnchanged(t *testing.T) {
	input := canvasGenerationInput{
		Prompt:          "镜头缓慢前推，人物走向门口",
		ReferenceImages: []providerMedia{{ID: "image-1", DataURL: testReferenceImageDataURL}},
		Metadata:        map[string]interface{}{"videoEditOperation": "image_to_video"},
	}
	for name, prompt := range map[string]string{
		"newapi":           newAPIVideoPromptText(input),
		"seedance-content": seedancePromptText(input),
		"seedance-videos":  seedanceVideosPromptText(input),
	} {
		if prompt != input.Prompt {
			t.Fatalf("%s prompt = %q", name, prompt)
		}
	}
}

func TestNewAPIVideoOmitsImagesForTextToVideoOperation(t *testing.T) {
	input := canvasGenerationInput{
		Prompt: "make it move with the described character",
		ReferenceImages: []providerMedia{
			{ID: "image-1", DataURL: testReferenceImageDataURL},
		},
		Metadata: map[string]interface{}{"videoEditOperation": "text_to_video"},
	}
	if shouldSendNewAPIVideoImages(input) {
		t.Fatal("shouldSendNewAPIVideoImages() = true, want false")
	}
	if prompt := newAPIVideoPromptText(input); strings.Contains(prompt, "@image1") {
		t.Fatalf("prompt = %q", prompt)
	}
}

func TestSeedanceVideosBodyRequiresImageForVideoOrAudioReferences(t *testing.T) {
	_, err := seedanceVideosRequestBody(canvasGenerationInput{
		Prompt:          "make it move",
		Config:          providerConfig{Model: "seedance-2.0-mini-480p"},
		ReferenceVideos: []providerMedia{{ID: "video-1", URL: "https://example.com/ref.mp4"}},
	})
	if err == nil {
		t.Fatal("seedanceVideosBody() error = nil, want error")
	}
}

func TestArkPlanConfigStaysSeparateFromSeedanceVideosEndpoint(t *testing.T) {
	config := providerConfig{BaseURL: "https://ark.cn-beijing.volces.com/api/plan/v3", Model: "seedance-2.0-pro"}
	if !isArkPlanVideoConfig(config) {
		t.Fatal("isArkPlanVideoConfig() = false, want true")
	}
	if !isSeedanceVideoConfig(config) {
		t.Fatal("isSeedanceVideoConfig() = false, want true")
	}
}

func TestVolcengineArkVideoProtocolUsesContentTaskAndDownloadsResult(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /api/v3/contents/generations/tasks":
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			content, _ := body["content"].([]interface{})
			if len(content) != 4 {
				t.Errorf("body = %#v", body)
				return
			}
			wantTypes := []string{"text", "image_url", "video_url", "audio_url"}
			wantRoles := []string{"", "reference_image", "reference_video", "reference_audio"}
			for index, item := range content {
				entry, _ := item.(map[string]interface{})
				if entry["type"] != wantTypes[index] || (wantRoles[index] != "" && entry["role"] != wantRoles[index]) {
					t.Errorf("content[%d] = %#v", index, entry)
				}
			}
			if body["model"] != "doubao-seedance-test" {
				t.Errorf("body = %#v", body)
			}
			_, _ = w.Write([]byte(`{"id":"ark-task-1","status":"running"}`))
		case "GET /api/v3/contents/generations/tasks/ark-task-1":
			_, _ = w.Write([]byte(`{"id":"ark-task-1","status":"succeeded","content":{"video_url":"` + server.URL + `/result.mp4"}}`))
		case "GET /result.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt:          "make it move",
		Config:          providerConfig{BaseURL: server.URL + "/api/v3", APIKey: "test-key", Model: "doubao-seedance-test", InterfaceType: "volcengine-ark-video"},
		ReferenceImages: []providerMedia{{ID: "start", URL: server.URL + "/reference.png"}},
		ReferenceVideos: []providerMedia{{ID: "motion", URL: server.URL + "/reference.mp4"}},
		ReferenceAudios: []providerMedia{{ID: "music", URL: server.URL + "/reference.mp3"}},
		Metadata:        map[string]interface{}{"videoStartFrameNodeId": "start"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video := result["video"].(map[string]interface{})
	if video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", video)
	}
	want := "POST /api/v3/contents/generations/tasks,GET /api/v3/contents/generations/tasks/ark-task-1,GET /result.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestNewAPIChannel1VideoBodyMapsFramesAndReferences(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()

	body, err := newAPIChannel1VideoBody(canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{Model: "seedance-2.0", Size: "9:16", VQuality: "1080", VideoSeconds: "15", VideoWatermark: "true"},
		ReferenceImages: []providerMedia{
			{ID: "first", URL: server.URL + "/first.png"},
			{ID: "last", URL: server.URL + "/last.png"},
			{ID: "character", URL: server.URL + "/character.png"},
		},
		ReferenceVideos: []providerMedia{{ID: "video", URL: server.URL + "/reference.mp4"}},
		ReferenceAudios: []providerMedia{{ID: "voice", URL: server.URL + "/voice.mp3"}},
		Metadata:        map[string]interface{}{"videoStartFrameNodeId": "first", "videoEndFrameNodeId": "last"},
	})
	if err != nil {
		t.Fatalf("newAPIChannel1VideoBody() error = %v", err)
	}
	input := body["input"].(map[string]interface{})
	media := input["media"].([]map[string]string)
	wantTypes := []string{"first_frame", "last_frame", "reference_image", "reference_video", "reference_voice"}
	if len(media) != len(wantTypes) {
		t.Fatalf("media = %#v", media)
	}
	for index, want := range wantTypes {
		if media[index]["type"] != want {
			t.Fatalf("media[%d].type = %q, want %q", index, media[index]["type"], want)
		}
	}
	parameters := body["parameters"].(map[string]interface{})
	if parameters["resolution"] != "1080P" || parameters["ratio"] != "9:16" || parameters["duration"] != 15 || parameters["watermark"] != true {
		t.Fatalf("parameters = %#v", parameters)
	}
}

func TestNewAPIChannel1VideoBodyRejectsInlineMedia(t *testing.T) {
	_, err := newAPIChannel1VideoBody(canvasGenerationInput{
		Prompt:          "make it move",
		Config:          providerConfig{Model: "seedance-2.0"},
		ReferenceImages: []providerMedia{{ID: "image", DataURL: testReferenceImageDataURL}},
	})
	if err == nil || !strings.Contains(err.Error(), "公网 HTTP(S) URL") {
		t.Fatalf("newAPIChannel1VideoBody() error = %v", err)
	}
}

func TestRunNewAPIChannel1VideoTaskDownloadsSucceededObject(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			if contentType := r.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "application/json") {
				t.Errorf("Content-Type = %q", contentType)
			}
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if body["model"] != "seedance-2.0" {
				t.Errorf("body = %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"channel-1-task","task_id":"channel-1-task","status":"RUNNING"}`))
		case "GET /v1/videos/channel-1-task":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"channel-1-task","status":"SUCCEEDED","object":"` + server.URL + `/video.mp4"}`))
		case "GET /video.mp4":
			if authorization := r.Header.Get("Authorization"); authorization != "" {
				t.Errorf("file Authorization = %q, want empty", authorization)
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runNewAPIChannel1VideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "seedance-2.0", InterfaceType: "newapi-channel-1"},
	})
	if err != nil {
		t.Fatalf("runNewAPIChannel1VideoTask() error = %v", err)
	}
	video := result["video"].(map[string]interface{})
	if video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", video)
	}
	want := "POST /v1/videos,GET /v1/videos/channel-1-task,GET /video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunNewAPIChannel2VideoTaskDownloadsTemporaryResult(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/video/generations":
			if auth := r.Header.Get("Authorization"); auth != "Bearer test-key" {
				t.Errorf("Authorization = %q", auth)
			}
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if body["model"] != "grok-image-video" || body["seconds"] != "15" || body["aspect_ratio"] != "9:16" || body["resolution"] != "720p" {
				t.Errorf("body = %#v", body)
			}
			images, ok := body["image_urls"].([]interface{})
			if !ok || len(images) != 2 || images[0] != testReferenceImageDataURL {
				t.Errorf("image_urls = %#v", body["image_urls"])
			}
			videos, _ := body["video_urls"].([]interface{})
			audios, _ := body["audio_urls"].([]interface{})
			if len(videos) != 1 || len(audios) != 1 || body["generate_audio"] != true {
				t.Errorf("multi-reference body = %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"grok-task","status":"queued"}`))
		case "GET /v1/video/generations/grok-task":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":"success","data":{"task_id":"grok-task","status":"SUCCESS","result_url":"` + server.URL + `/video.mp4"}}`))
		case "GET /video.mp4":
			if authorization := r.Header.Get("Authorization"); authorization != "Bearer test-key" {
				t.Errorf("file Authorization = %q, want Bearer test-key", authorization)
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	profile := DefaultModelCapabilityConfigForModel("newapi-channel-2", "grok-image-video").Video
	profile.Resolutions = []string{"720p"}
	profile.DefaultResolution = "720p"
	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "grok-image-video", InterfaceType: "newapi-channel-2", VideoSeconds: "15", Size: "720x1280", VQuality: "720"},
		ReferenceImages: []providerMedia{
			{ID: "image-1", DataURL: testReferenceImageDataURL},
			{ID: "image-2", DataURL: testReferenceImageDataURL},
		},
		ReferenceVideos: []providerMedia{{ID: "video-1", URL: server.URL + "/reference.mp4"}},
		ReferenceAudios: []providerMedia{{ID: "audio-1", URL: server.URL + "/reference.mp3"}},
		Metadata:        map[string]interface{}{"videoEditOperation": "image_to_video"},
		VideoCapability: profile,
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video := result["video"].(map[string]interface{})
	if video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", video)
	}
	want := "POST /v1/video/generations,GET /v1/video/generations/grok-task,GET /video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunNewAPIChannel2VideoTaskResumesOriginalProviderTaskWithoutAnotherPost(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 2)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "GET /v1/video/generations/existing-provider-task":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":"success","data":{"task_id":"existing-provider-task","status":"SUCCESS","result_url":"` + server.URL + `/video.mp4"}}`))
		case "GET /video.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	input := canvasGenerationInput{
		Mode:   "video",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "video-model", InterfaceType: string(model.ChannelInterfaceNewAPIChannel2)},
	}
	inputJSON, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	ctx := withProviderAnalytics(context.Background(), nil, model.Task{
		ID: "task-1", Type: "canvas_video", ProviderRequestID: "existing-provider-task", InputJSON: string(inputJSON),
	})
	result, err := runNewAPIChannel2VideoTask(ctx, input)
	if err != nil {
		t.Fatalf("runNewAPIChannel2VideoTask() error = %v", err)
	}
	if result["video"] == nil {
		t.Fatalf("result = %#v", result)
	}
	want := "GET /v1/video/generations/existing-provider-task,GET /video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunNewAPIChannel2VideoTaskReturnsTypedDeadlineWhenPollingWindowEnds(t *testing.T) {
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	ctx = withProviderAnalytics(ctx, nil, model.Task{ID: "task-1", Type: "canvas_video", ProviderRequestID: "existing-provider-task"})
	_, err := runNewAPIChannel2VideoTask(ctx, canvasGenerationInput{})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("runNewAPIChannel2VideoTask() error = %v, want context deadline exceeded", err)
	}
}

func TestRunGeminiVeoVideoTaskUsesLongRunningOperation(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		if r.Header.Get("x-goog-api-key") != "test-key" {
			t.Errorf("x-goog-api-key = %q", r.Header.Get("x-goog-api-key"))
		}
		switch r.Method + " " + r.URL.Path {
		case "POST /v1beta/models/veo-test:predictLongRunning":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"name":"operations/op-1"}`))
		case "GET /v1beta/operations/op-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"done":true,"response":{"generatedSamples":[{"video":{"uri":"` + server.URL + `/video.mp4"}}]}}`))
		case "GET /video.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", APIFormat: "gemini", Model: "veo-test", InterfaceType: "gemini-veo", VideoSeconds: "6", Size: "16:9", VQuality: "720"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video := result["video"].(map[string]interface{})
	if video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", video)
	}
	want := "POST /v1beta/models/veo-test:predictLongRunning,GET /v1beta/operations/op-1,GET /video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestNewAPIChannel2SingleImageModelsRequireOneReference(t *testing.T) {
	_, err := newAPIChannel2VideoRequestBody(canvasGenerationInput{Config: providerConfig{Model: "grok-video-1.5", VideoSeconds: "6"}})
	if err == nil {
		t.Fatal("newAPIChannel2VideoBody() error = nil")
	}
	if !strings.Contains(err.Error(), "当前 0 张") {
		t.Fatalf("newAPIChannel2VideoBody() error = %q", err)
	}
}

func TestNewAPIChannel2SendsOnlyDeclaredResolution(t *testing.T) {
	tests := []struct {
		name        string
		model       string
		quality     string
		resolutions []string
		want        string
	}{
		{name: "catalog omits resolution", model: "endpoint-video", quality: "720"},
		{name: "declared 2K alias", model: "declared-video", quality: "2K", resolutions: []string{"1440p"}, want: "1440p"},
		{name: "fixed grok 1080p model", model: "grok-video-1.5-1080p", quality: "720", want: "1080p"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel("newapi-channel-2", test.model).Video
			profile.Resolutions = test.resolutions
			profile.DefaultResolution = ""
			input := canvasGenerationInput{
				Config:          providerConfig{Model: test.model, VideoSeconds: "6", Size: "16:9", VQuality: test.quality},
				VideoCapability: profile,
			}
			if strings.HasPrefix(test.model, "grok-video-1.5") {
				input.ReferenceImages = []providerMedia{{ID: "image-1", DataURL: testReferenceImageDataURL}}
			}

			body, err := newAPIChannel2VideoRequestBody(input)
			if err != nil {
				t.Fatalf("newAPIChannel2VideoRequestBody() error = %v", err)
			}
			if body.Resolution != test.want {
				t.Fatalf("resolution = %q, want %q", body.Resolution, test.want)
			}
			mapped, err := requestAsMap(body)
			if err != nil {
				t.Fatalf("requestAsMap() error = %v", err)
			}
			_, hasResolution := mapped["resolution"]
			if hasResolution != (test.want != "") {
				t.Fatalf("resolution presence = %v, want %v; body = %#v", hasResolution, test.want != "", mapped)
			}
		})
	}
}

func TestNewAPIChannel2RejectsAudioWithoutReferenceVideo(t *testing.T) {
	_, err := newAPIChannel2VideoRequestBody(canvasGenerationInput{
		Config:          providerConfig{Model: "grok-image-video", VideoSeconds: "6"},
		ReferenceAudios: []providerMedia{{ID: "audio-1", URL: "https://example.com/reference.mp3"}},
	})
	if err == nil || !strings.Contains(err.Error(), "必须同时提供至少 1 个参考视频") {
		t.Fatalf("newAPIChannel2VideoRequestBody() error = %v", err)
	}
}

func TestNewAPIChannel2SingleImageModelUsesReferenceForStaleTextToVideoMetadata(t *testing.T) {
	body, err := newAPIChannel2VideoRequestBody(canvasGenerationInput{
		Config:          providerConfig{Model: "grok-video-1.5", VideoSeconds: "6"},
		ReferenceImages: []providerMedia{{ID: "image-1", DataURL: testReferenceImageDataURL}},
		Metadata:        map[string]interface{}{"videoEditOperation": "text_to_video"},
	})
	if err != nil {
		t.Fatalf("newAPIChannel2VideoBody() error = %v", err)
	}
	images := body.ImageURLs
	if len(images) != 1 || images[0] != testReferenceImageDataURL {
		t.Fatalf("image_urls = %#v", images)
	}
}

func TestNewAPIChannel2OrdersFramesBeforeReferenceImages(t *testing.T) {
	body, err := newAPIChannel2VideoRequestBody(canvasGenerationInput{
		Config: providerConfig{Model: "Seedance 2 Mini", VideoSeconds: "10"},
		ReferenceImages: []providerMedia{
			{ID: "character", DataURL: "data:image/png;base64,Y2hhcmFjdGVy"},
			{ID: "last-frame", DataURL: "data:image/png;base64,bGFzdA=="},
			{ID: "first-frame", DataURL: "data:image/png;base64,Zmlyc3Q="},
		},
		Metadata: map[string]interface{}{"videoStartFrameNodeId": "first-frame", "videoEndFrameNodeId": "last-frame", "videoEditOperation": "image_to_video"},
	})
	if err != nil {
		t.Fatalf("newAPIChannel2VideoBody() error = %v", err)
	}
	images := body.ImageURLs
	want := []string{"data:image/png;base64,Zmlyc3Q=", "data:image/png;base64,bGFzdA==", "data:image/png;base64,Y2hhcmFjdGVy"}
	if !reflect.DeepEqual(images, want) {
		t.Fatalf("image_urls = %#v, want %#v", images, want)
	}
}

func TestNewAPIChannel2RejectsMissingConfiguredFrame(t *testing.T) {
	_, err := newAPIChannel2VideoRequestBody(canvasGenerationInput{
		Config:          providerConfig{Model: "Seedance 2 Mini", VideoSeconds: "10"},
		ReferenceImages: []providerMedia{{ID: "character", DataURL: testReferenceImageDataURL}},
		Metadata:        map[string]interface{}{"videoStartFrameNodeId": "missing-frame", "videoEditOperation": "image_to_video"},
	})
	if err == nil || !strings.Contains(err.Error(), "首帧参考图未包含") {
		t.Fatalf("newAPIChannel2VideoBody() error = %v", err)
	}
}

func TestValidateGenerationInterfaceRejectsMismatchedType(t *testing.T) {
	if err := validateGenerationInterface("video", "chat-completion"); err == nil {
		t.Fatal("validateGenerationInterface() error = nil")
	}
	if err := validateGenerationInterface("video", "newapi-channel-1"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
	if err := validateGenerationInterface("video", "newapi-channel-2"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
	if err := validateGenerationInterface("video", "xai-video"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
	if err := validateGenerationInterface("image", "grok-image"); err != nil {
		t.Fatalf("validateGenerationInterface() error = %v", err)
	}
}

func TestProcessTaskValidatesInterfaceBeforeHydratingMedia(t *testing.T) {
	input := canvasGenerationInput{
		Mode:            "video",
		Prompt:          "make it move",
		Config:          providerConfig{BaseURL: "https://8.8.8.8/v1", APIKey: "key", Model: "text-model", InterfaceType: "chat-completion"},
		ReferenceImages: []providerMedia{{StorageKey: "resource:missing"}},
	}
	raw, _ := json.Marshal(input)
	_, err := (&Service{}).processCanvasGenerationTask(context.Background(), "user-1", "", "video_generate", "", string(raw))
	if err == nil || !strings.Contains(err.Error(), "不支持video生成") {
		t.Fatalf("processCanvasGenerationTask() error = %v", err)
	}
}

func TestResolveGenerationStyleExecutionUsesValidatedPromptAssets(t *testing.T) {
	enabled := true
	profile := styleProfileDocument{
		Prompt:          "base style",
		ExecutionPolicy: "compatible-fallback",
		Assets: []styleProfileAsset{
			{ID: "prompt-1", Kind: "prompt", Title: "色彩约束", Provider: "builtin", Enabled: &enabled, Status: "validated", PromptFragment: "muted palette", TriggerWords: []string{"soft light"}},
			{ID: "lora-1", Kind: "lora", Title: "东方角色 LoRA", Provider: "liblib", Enabled: &enabled, Status: "validated", SourceID: "model-1"},
		},
	}
	prompt, status, warnings := resolveGenerationStyleExecution(profile, "image-model", "openai-image")
	if prompt != "base style\nmuted palette\nsoft light" {
		t.Fatalf("resolveGenerationStyleExecution() prompt = %q", prompt)
	}
	if status != "degraded" || len(warnings) != 1 || !strings.Contains(warnings[0], "LoRA") {
		t.Fatalf("resolveGenerationStyleExecution() status = %q, warnings = %#v", status, warnings)
	}
}

func TestResolveGenerationStyleExecutionStrictPolicyBlocksUnsupportedAsset(t *testing.T) {
	profile := styleProfileDocument{
		Prompt:          "base style",
		ExecutionPolicy: "strict-assets",
		Assets:          []styleProfileAsset{{ID: "reference-1", Kind: "reference", Title: "项目参考图", Provider: "project", Status: "validated", ReferenceResourceIDs: []string{"resource-1"}}},
	}
	_, status, warnings := resolveGenerationStyleExecution(profile, "image-model", "openai-image")
	if status != "blocked" || len(warnings) != 1 {
		t.Fatalf("resolveGenerationStyleExecution() status = %q, warnings = %#v", status, warnings)
	}
}

func TestResolveGenerationStyleExecutionSkipsPromptAssetForOtherModel(t *testing.T) {
	profile := styleProfileDocument{
		Prompt:          "base style",
		ExecutionPolicy: "compatible-fallback",
		Assets: []styleProfileAsset{{
			ID: "template-1", Kind: "template", Title: "专用模板", Provider: "workflow", Status: "validated",
			BaseModels: []string{"supported-model"}, PromptFragment: "must not be injected",
		}},
	}
	prompt, status, warnings := resolveGenerationStyleExecution(profile, "other-model", "openai-image")
	if prompt != "base style" || status != "degraded" || len(warnings) != 1 {
		t.Fatalf("resolveGenerationStyleExecution() prompt = %q, status = %q, warnings = %#v", prompt, status, warnings)
	}
}

func TestApplyGenerationStyleProfileRebuildsStaleClientPlanForResolvedModel(t *testing.T) {
	enabled := true
	profile := styleProfileDocument{
		SchemaVersion:   1,
		PresetID:        "style-1",
		Title:           "项目画风",
		Prompt:          "base style",
		ExecutionPolicy: "compatible-fallback",
		Source:          "user",
		Revision:        1,
		Assets: []styleProfileAsset{{
			ID: "template-1", Kind: "template", Title: "旧模型模板", Provider: "workflow", Enabled: &enabled, Status: "validated",
			BaseModels: []string{"client-model"}, PromptFragment: "client-only fragment",
		}},
	}
	clientPrompt, clientStatus, _ := resolveGenerationStyleExecution(profile, "client-model", "openai-image")
	input := canvasGenerationInput{
		Mode:   "image",
		Prompt: "portrait\n\n【项目画风执行规范】\n" + clientPrompt,
		Config: providerConfig{Model: "resolved-model", InterfaceType: "openai-image"},
		Metadata: map[string]interface{}{
			"styleProfileJson": mustStyleProfileJSON(profile),
			"styleExecutionPlan": styleExecutionPlanDocument{
				SchemaVersion: 1, ProfilePresetID: profile.PresetID, ProfileRevision: profile.Revision, Mode: "image",
				Model: "client-model", InterfaceType: "openai-image", Status: clientStatus, Prompt: clientPrompt,
			},
		},
	}

	if err := (&Service{}).applyGenerationStyleProfile("user-1", "", &input); err != nil {
		t.Fatalf("applyGenerationStyleProfile() error = %v", err)
	}
	if input.Prompt != "portrait\n\n【项目画风执行规范】\nbase style" {
		t.Fatalf("applyGenerationStyleProfile() prompt = %q", input.Prompt)
	}
}

func TestEquivalentStyleProfileJSONIgnoresObjectKeyOrder(t *testing.T) {
	equal, err := equivalentStyleProfileJSON(`{"schemaVersion":1,"presetId":"style-1","assets":[]}`, `{"assets":[],"presetId":"style-1","schemaVersion":1}`)
	if err != nil || !equal {
		t.Fatalf("equivalentStyleProfileJSON() equal = %v, err = %v", equal, err)
	}
}

func TestRunNovitaVideoTaskDownloadsSucceededVideo(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.String())
		switch r.Method + " " + r.URL.Path {
		case "POST /video/create":
			if auth := r.Header.Get("Authorization"); auth != "Bearer test-key" {
				t.Errorf("Authorization = %q", auth)
			}
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if body["model"] != "kling2.5_turbo_pro_t2v" || body["prompt"] != "make it move" || body["duration"] != "5" || body["aspect_ratio"] != "16:9" {
				t.Errorf("body = %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"novita-task-1"}`))
		case "GET /async/task-result":
			if r.URL.Query().Get("task_id") != "novita-task-1" {
				t.Errorf("task_id = %q", r.URL.Query().Get("task_id"))
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task":{"status":"TASK_STATUS_SUCCEED"},"videos":[{"video_url":"` + server.URL + `/video.mp4"}]}`))
		case "GET /video.mp4":
			if authorization := r.Header.Get("Authorization"); authorization != "" {
				t.Errorf("file Authorization = %q, want empty", authorization)
			}
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "kling2.5_turbo_pro_t2v", InterfaceType: "novita-video", VideoSeconds: "5", Size: "16:9"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video := result["video"].(map[string]interface{})
	if video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", video)
	}
	want := "POST /video/create,GET /async/task-result?task_id=novita-task-1,GET /video.mp4"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q", got, want)
	}
}

func TestRunNovitaVideoTaskReturnsFailureReason(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /video/create":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"novita-task-2"}`))
		case "GET /async/task-result":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task":{"status":"TASK_STATUS_FAILED","reason":"content violates policy"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, err := runVideoTask(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "kling2.5_turbo_pro_t2v", InterfaceType: "novita-video"},
	})
	if err == nil || !strings.Contains(err.Error(), "content violates policy") {
		t.Fatalf("runVideoTask() error = %v, want reason in message", err)
	}
}

func TestRunMiniMaxVideoTaskCreatesPollsAndDownloads(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	paths := make([]string, 0, 3)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.Method+" "+r.URL.Path)
		switch r.Method + " " + r.URL.Path {
		case "POST /v2/video_generation":
			if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
				t.Errorf("Authorization = %q", got)
			}
			var body miniMaxVideoRequest
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode request: %v", err)
			}
			if body.Model != "MiniMax-H3" || body.Resolution != "768P" || body.Duration != 5 || body.Ratio != "16:9" || len(body.Content) != 1 || body.Content[0].Text != "make it move" {
				t.Errorf("body = %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"minimax-task-1"}`))
		case "GET /v2/query/video_generation/minimax-task-1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task":{"id":"minimax-task-1","status":"succeeded","content":{"url":"` + server.URL + `/video.mp4"}}}`))
		case "GET /video.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTask(context.Background(), canvasGenerationInput{
		Mode:   "video",
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "MiniMax-H3", InterfaceType: "minimax-video", VideoSeconds: "5", VQuality: "720", Size: "16:9"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v", err)
	}
	video := result["video"].(map[string]interface{})
	if video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", video)
	}
	if got := strings.Join(paths, ","); got != "POST /v2/video_generation,GET /v2/query/video_generation/minimax-task-1,GET /video.mp4" {
		t.Fatalf("paths = %q", got)
	}
}

func TestRunMiniMaxVideoTaskReturnsFailureReason(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "POST /v2/video_generation":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task_id":"minimax-task-2"}`))
		case "GET /v2/query/video_generation/minimax-task-2":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"task":{"status":"failed","error":{"code":"1026","message":"content violates policy"}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, err := runVideoTask(context.Background(), canvasGenerationInput{
		Mode:   "video",
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "MiniMax-H3", InterfaceType: "minimax-video"},
	})
	if err == nil || !strings.Contains(err.Error(), "1026：content violates policy") {
		t.Fatalf("runVideoTask() error = %v", err)
	}
}
