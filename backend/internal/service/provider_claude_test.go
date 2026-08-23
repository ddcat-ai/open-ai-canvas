package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestRunClaudeTextTaskUsesMessagesAndAPIKeyHeader(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("x-api-key") != "claude-key" || r.Header.Get("Authorization") != "" {
			t.Fatalf("auth headers = x-api-key %q authorization %q", r.Header.Get("x-api-key"), r.Header.Get("Authorization"))
		}
		if r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Fatalf("anthropic-version = %q", r.Header.Get("anthropic-version"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"claude works"}]}`))
	}))
	defer server.Close()

	config := providerConfig{
		BaseURL: server.URL + "/v1", APIKey: "claude-key", Model: "claude-test", APIFormat: "claude", InterfaceType: string(model.ChannelInterfaceClaudeAPI),
		AllowLocalChannel: true,
	}
	result, err := runTextTask(withProviderOutboundPolicy(context.Background(), config), canvasGenerationInput{Mode: "text", Prompt: "hello", Config: config})
	if err != nil {
		t.Fatal(err)
	}
	if result["text"] != "claude works" {
		t.Fatalf("result = %#v", result)
	}
}
