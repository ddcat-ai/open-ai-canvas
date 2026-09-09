package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"infinite-canvas/backend/internal/protocol"
)

type agentStreamTestAdapter struct{}

func (agentStreamTestAdapter) BuildAgent(context.Context, protocol.AgentRequestContext) (protocol.RequestSpec, error) {
	return protocol.RequestSpec{Method: "POST", Path: "/chat/completions", ContentType: "application/json", Headers: map[string]string{"X-Plugin-Test": "retained"}, Body: map[string]interface{}{"model": "test"}}, nil
}
func (agentStreamTestAdapter) ParseAgent(context.Context, []byte) (protocol.AgentResult, error) {
	return protocol.AgentResult{Text: "JSON fallback"}, nil
}

func TestDeclarativeAgentEmitsBeforeUpstreamCompletes(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	received := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body["stream"] != true || r.Header.Get("Accept") != "text/event-stream" || r.Header.Get("X-Plugin-Test") != "retained" {
			t.Errorf("stream request contract not preserved")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"第一段\"}}]}\n\n")
		w.(http.Flusher).Flush()
		select {
		case first := <-received:
			if first != "第一段" {
				t.Errorf("first delta = %q", first)
			}
		case <-time.After(3 * time.Second):
			t.Error("first delta was buffered until completion")
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"第二段\"}}]}\n\ndata: [DONE]\n\n")
	}))
	defer server.Close()
	result, err := runDeclarativeAgentTask(context.Background(), canvasGenerationInput{Config: providerConfig{BaseURL: server.URL}, AgentRequests: &agentToolRequests{}, OnTextDelta: func(text string) { received <- text }}, agentStreamTestAdapter{})
	if err != nil || result["text"] != "第一段第二段" {
		t.Fatalf("result=%v error=%v", result, err)
	}
	if <-received != "第二段" {
		t.Fatal("missing second delta")
	}
}

func TestDeclarativeAgentRetainsJSONFallback(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, "{}")
	}))
	defer server.Close()
	result, err := runDeclarativeAgentTask(context.Background(), canvasGenerationInput{Config: providerConfig{BaseURL: server.URL}, AgentRequests: &agentToolRequests{}}, agentStreamTestAdapter{})
	if err != nil || result["text"] != "JSON fallback" {
		t.Fatalf("result=%v error=%v", result, err)
	}
}
