package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGeminiProviderCancellationAndConfirmation(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != "test-key" {
			t.Errorf("missing Gemini API key")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1beta/operations/video-1:cancel":
			requests++
			_ = json.NewEncoder(w).Encode(map[string]any{})
		case r.Method == http.MethodGet && r.URL.Path == "/v1beta/operations/video-1":
			_ = json.NewEncoder(w).Encode(map[string]any{"done": true, "error": map[string]any{"code": 1, "message": "Operation cancelled"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	config := providerConfig{InterfaceType: "gemini-veo", BaseURL: server.URL, APIKey: "test-key"}
	if err := cancelProviderTask(context.Background(), config, "operations/video-1"); err != nil {
		t.Fatal(err)
	}
	outcome, _, err := queryProviderCancellation(context.Background(), config, "operations/video-1")
	if err != nil {
		t.Fatal(err)
	}
	if requests != 1 || outcome != providerCancellationConfirmed {
		t.Fatalf("unexpected Gemini cancellation result: requests=%d outcome=%s", requests, outcome)
	}
}

func TestVolcengineArkProviderCancellationUsesDelete(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete || r.URL.Path != "/api/v3/contents/generations/tasks/task-1" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("missing Ark bearer token")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	config := providerConfig{InterfaceType: "volcengine-ark-video", BaseURL: server.URL + "/api/v3", APIKey: "test-key"}
	if err := cancelProviderTask(context.Background(), config, "task-1"); err != nil {
		t.Fatal(err)
	}
}
