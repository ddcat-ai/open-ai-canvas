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
	if err := authorizeSystemProxy(channel, http.MethodPost, "/images/generations", "application/json", body); err != nil {
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
		{method: http.MethodPost, target: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse", apiFormat: "gemini", contentType: "application/json"},
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
		{method: http.MethodPost, target: "https://api.example.com/v1/../account/chat/completions", apiFormat: "openai", contentType: "application/json"},
		{method: http.MethodPost, target: "https://api.example.com/v1/models/gemini:streamGenerateContent?alt=sse&token=secret", apiFormat: "gemini", contentType: "application/json"},
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
	if err := authorizeSystemProxy(channel, http.MethodDelete, "/account", "application/json", nil); err == nil {
		t.Fatal("expected arbitrary path to be rejected")
	}
	if err := authorizeSystemProxy(channel, http.MethodPost, "/images/generations", "application/json", []byte(`{"model":"unapproved"}`)); err == nil {
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

func TestAuthorizeSystemProxyRestrictsConfiguredInterfaceType(t *testing.T) {
	body := []byte(`{"model":"gpt-4.1"}`)
	channel := &model.ModelChannel{APIFormat: "openai", InterfaceType: model.ChannelInterfaceChatCompletion, ModelsJSON: `["gpt-4.1"]`}
	if err := authorizeSystemProxy(channel, http.MethodPost, "/chat/completions", "application/json", body); err != nil {
		t.Fatalf("authorizeSystemProxy() error = %v", err)
	}
	if err := authorizeSystemProxy(channel, http.MethodPost, "/responses", "application/json", body); err == nil {
		t.Fatal("authorizeSystemProxy() error = nil for mismatched interface")
	}
}

func TestAuthorizeSystemProxyBlocksBackendOnlyVideoInterfaces(t *testing.T) {
	body := []byte(`{"model":"grok-image-video"}`)
	for _, interfaceType := range []model.ChannelInterfaceType{model.ChannelInterfaceNewAPIChannel2, model.ChannelInterfaceXAIVideo} {
		channel := &model.ModelChannel{APIFormat: "openai", InterfaceType: interfaceType, ModelsJSON: `["grok-image-video"]`}
		if err := authorizeSystemProxy(channel, http.MethodPost, "/video/generations", "application/json", body); err == nil {
			t.Fatalf("authorizeSystemProxy() error = nil for backend-only interface %q", interfaceType)
		}
	}
}
