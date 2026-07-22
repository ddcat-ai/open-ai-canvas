package handler

import (
	"mime/multipart"
	"net/http"
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
