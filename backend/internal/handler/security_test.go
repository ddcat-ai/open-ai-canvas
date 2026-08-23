package handler

import (
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestAuthorizeSystemProxyAllowsConfiguredGenerationModel(t *testing.T) {
	channel := &model.ModelChannel{APIFormat: "openai", ModelsJSON: `["gpt-image-1"]`}
	body := []byte(`{"model":"gpt-image-1","prompt":"test"}`)
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceOpenAIImage, http.MethodPost, "/images/generations", "application/json", body); err != nil {
		t.Fatalf("authorizeSystemProxy() error = %v", err)
	}
}

func TestAuthorizeSystemProxyAllowsGrokImageJSONEdits(t *testing.T) {
	channel := &model.ModelChannel{APIFormat: "openai", ModelsJSON: `["grok-imagine-image"]`}
	body := []byte(`{"model":"grok-imagine-image","prompt":"edit"}`)
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceGrokImage, http.MethodPost, "/images/edits", "application/json", body); err != nil {
		t.Fatalf("authorizeSystemProxy() error = %v", err)
	}
}

func TestAuthorizeCustomRelayAllowsModelsAndAgentEndpoints(t *testing.T) {
	tests := []struct {
		method      string
		target      string
		apiFormat   string
		contentType string
	}{
		{method: http.MethodGet, target: "https://api.example.com/v1/models", apiFormat: "openai"},
		{method: http.MethodPost, target: "https://api.example.com/v1/responses", apiFormat: "openai", contentType: "application/json"},
		{method: http.MethodPost, target: "https://api.example.com/v1/chat/completions", apiFormat: "openai", contentType: "application/json; charset=utf-8"},
		{method: http.MethodPost, target: "https://api.anthropic.com/v1/messages", apiFormat: "claude", contentType: "application/json"},
		{method: http.MethodPost, target: "https://api.example.com/v1/audio/speech", apiFormat: "openai", contentType: "application/json"},
		{method: http.MethodPost, target: "https://api.example.com/v1/images/edits", apiFormat: "openai", contentType: "multipart/form-data; boundary=test"},
		{method: http.MethodPost, target: "https://api.example.com/v1/images/edits", apiFormat: "openai", contentType: "application/json"},
		{method: http.MethodPost, target: "https://api.example.com/v1/videos", apiFormat: "openai", contentType: "application/json"},
		{method: http.MethodPost, target: "https://api.example.com/v1/videos", apiFormat: "openai", contentType: "multipart/form-data; boundary=test"},
		{method: http.MethodGet, target: "https://api.example.com/v1/videos/task-1/content", apiFormat: "openai"},
		{method: http.MethodPost, target: "https://api.example.com/v1/video/generations", apiFormat: "openai", contentType: "application/json"},
		{method: http.MethodGet, target: "https://api.example.com/v1/video/generations/task-1", apiFormat: "openai"},
		{method: http.MethodPost, target: "https://api.x.ai/v1/videos/generations", apiFormat: "openai", contentType: "application/json"},
		{method: http.MethodGet, target: "https://api.x.ai/v1/videos/request-1", apiFormat: "openai"},
		{method: http.MethodPost, target: "https://api.novita.ai/v3/video/create", apiFormat: "openai", contentType: "application/json"},
		{method: http.MethodGet, target: "https://api.novita.ai/v3/async/task-result?task_id=task-1", apiFormat: "openai"},
		{method: http.MethodPost, target: "https://ark.cn-beijing.volces.com/api/v3/images/generations", apiFormat: "openai", contentType: "application/json"},
		{method: http.MethodPost, target: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks", apiFormat: "openai", contentType: "application/json"},
		{method: http.MethodGet, target: "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/task-1", apiFormat: "openai"},
		{method: http.MethodPost, target: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse", apiFormat: "gemini", contentType: "application/json"},
		{method: http.MethodPost, target: "https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-preview:predictLongRunning", apiFormat: "gemini", contentType: "application/json"},
		{method: http.MethodGet, target: "https://generativelanguage.googleapis.com/v1beta/operations/operation-1", apiFormat: "gemini"},
	}
	for _, test := range tests {
		target, err := url.Parse(test.target)
		if err != nil {
			t.Fatal(err)
		}
		if err := authorizeCustomRelay(test.method, target, test.apiFormat, test.contentType); err != nil {
			t.Fatalf("authorizeCustomRelay(%s %s) error = %v", test.method, test.target, err)
		}
	}
}

func TestAuthorizeCustomRelayRejectsArbitraryRequestsAndCredentialQueries(t *testing.T) {
	tests := []struct {
		method      string
		target      string
		apiFormat   string
		contentType string
	}{
		{method: http.MethodDelete, target: "https://api.example.com/v1/models", apiFormat: "openai"},
		{method: http.MethodGet, target: "https://api.example.com/account", apiFormat: "openai"},
		{method: http.MethodGet, target: "https://api.example.com/v1/models?api_key=secret", apiFormat: "openai"},
		{method: http.MethodPost, target: "https://api.example.com/v1/responses", apiFormat: "openai", contentType: "text/plain"},
		{method: http.MethodPost, target: "https://api.anthropic.com/v1/messages", apiFormat: "claude", contentType: "text/plain"},
		{method: http.MethodGet, target: "https://api.anthropic.com/v1/messages", apiFormat: "claude"},
		{method: http.MethodPost, target: "https://api.example.com/v1/account", apiFormat: "openai", contentType: "multipart/form-data; boundary=test"},
		{method: http.MethodPost, target: "https://api.example.com/v1/../account/chat/completions", apiFormat: "openai", contentType: "application/json"},
		{method: http.MethodPost, target: "https://api.example.com/v1/models/gemini:streamGenerateContent?alt=sse&token=secret", apiFormat: "gemini", contentType: "application/json"},
		{method: http.MethodGet, target: "https://api.novita.ai/v3/async/task-result?task_id=task-1&api_key=secret", apiFormat: "openai"},
		{method: http.MethodGet, target: "https://api.novita.ai/v3/async/task-result", apiFormat: "openai"},
	}
	for _, test := range tests {
		target, err := url.Parse(test.target)
		if err != nil {
			t.Fatal(err)
		}
		if err := authorizeCustomRelay(test.method, target, test.apiFormat, test.contentType); err == nil {
			t.Fatalf("authorizeCustomRelay(%s %s) should fail", test.method, test.target)
		}
	}
}

func TestAuthorizeSystemProxyRejectsArbitraryPathAndModel(t *testing.T) {
	channel := &model.ModelChannel{APIFormat: "openai", ModelsJSON: `["gpt-image-1"]`}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceOpenAIImage, http.MethodDelete, "/account", "application/json", nil); err == nil {
		t.Fatal("expected arbitrary path to be rejected")
	}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceOpenAIImage, http.MethodPost, "/images/generations", "application/json", []byte(`{"model":"unapproved"}`)); err == nil {
		t.Fatal("expected unapproved model to be rejected")
	}
}

func TestProxyRequestModelReadsMultipartField(t *testing.T) {
	var body strings.Builder
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("model", "gpt-image-1")
	_ = writer.Close()
	if got := proxyRequestModel(writer.FormDataContentType(), []byte(body.String())); got != "gpt-image-1" {
		t.Fatalf("proxyRequestModel() = %q", got)
	}
}

func TestAuthorizeSystemProxyRestrictsModelProtocol(t *testing.T) {
	body := []byte(`{"model":"gpt-4.1"}`)
	channel := &model.ModelChannel{APIFormat: "openai", ModelsJSON: `["gpt-4.1"]`}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceChatCompletion, http.MethodPost, "/chat/completions", "application/json", body); err != nil {
		t.Fatalf("authorizeSystemProxy() error = %v", err)
	}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceChatCompletion, http.MethodPost, "/responses", "application/json", body); err == nil {
		t.Fatal("authorizeSystemProxy() error = nil for mismatched interface")
	}
}

func TestAuthorizeSystemProxyMiniMaxVideoCreateAndPoll(t *testing.T) {
	channel := &model.ModelChannel{APIFormat: "openai", ModelsJSON: `["MiniMax-H3"]`}
	createBody := []byte(`{"model":"MiniMax-H3","content":[{"type":"text","text":"test"}]}`)
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceMiniMaxVideo, http.MethodPost, "/v2/video_generation", "application/json", createBody); err != nil {
		t.Fatalf("MiniMax create should be allowed: %v", err)
	}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceMiniMaxVideo, http.MethodGet, "/v2/query/video_generation/task-1", "", nil); err != nil {
		t.Fatalf("MiniMax poll should be allowed: %v", err)
	}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceMiniMaxVideo, http.MethodGet, "/v2/account", "", nil); err == nil {
		t.Fatal("arbitrary MiniMax GET should be rejected")
	}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceMiniMaxVideo, http.MethodPost, "/v2/video_generation", "text/plain", createBody); err == nil {
		t.Fatal("MiniMax non-JSON create should be rejected")
	}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceMiniMaxVideo, http.MethodPost, "/v2/video_generation", "application/json", []byte(`{"model":"unapproved"}`)); err == nil {
		t.Fatal("unapproved MiniMax model should be rejected")
	}
}

func TestAuthorizeSystemProxyVolcengineArkImageOnlyAllowsGenerations(t *testing.T) {
	body := []byte(`{"model":"doubao-seedream-test"}`)
	channel := &model.ModelChannel{APIFormat: "openai", ModelsJSON: `["doubao-seedream-test"]`}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceVolcengineArkImage, http.MethodPost, "/images/generations", "application/json", body); err != nil {
		t.Fatalf("authorizeSystemProxy() error = %v", err)
	}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceVolcengineArkImage, http.MethodPost, "/images/edits", "application/json", body); err == nil {
		t.Fatal("authorizeSystemProxy() error = nil for unsupported Ark image edits path")
	}
}

func TestAuthorizeSystemProxyBlocksBackendOnlyVideoInterfaces(t *testing.T) {
	body := []byte(`{"model":"grok-image-video"}`)
	for _, interfaceType := range []model.ChannelInterfaceType{model.ChannelInterfaceNewAPIChannel2, model.ChannelInterfaceXAIVideo, model.ChannelInterfaceVolcengineJiMengImage, model.ChannelInterfaceVolcengineJiMengVideo} {
		channel := &model.ModelChannel{APIFormat: "openai", ModelsJSON: `["grok-image-video"]`}
		if err := authorizeSystemProxy(channel, interfaceType, http.MethodPost, "/video/generations", "application/json", body); err == nil {
			t.Fatalf("authorizeSystemProxy() error = nil for backend-only interface %q", interfaceType)
		}
	}
}
