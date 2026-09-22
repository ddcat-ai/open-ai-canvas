package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestDeclarativeTextStreaming(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, wire := range []struct {
		id, path, event, response string
	}{
		{"chat-completion", "/v1/chat/completions", "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n", `{"choices":[{"message":{"content":"hello"}}]}`},
		{"openai-response", "/v1/responses", "event: response.output_text.delta\ndata: {\"delta\":\"hello\"}\n\n", `{"output_text":"hello"}`},
		{"claude-api", "/v1/messages", "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n", `{"content":[{"type":"text","text":"hello"}]}`},
	} {
		for _, scenario := range []string{"stream", "json_fallback", "stream_disabled", "http_524", "cancel"} {
			t.Run(wire.id+"/"+scenario, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				var calls atomic.Int32
				deltaReceived := make(chan struct{}, 1)
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					if r.URL.Path != wire.path {
						t.Errorf("path = %q, want %q", r.URL.Path, wire.path)
					}
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Errorf("decode request: %v", err)
						return
					}
					if body["model"] != "test-model" {
						t.Errorf("plugin model mapping lost: %#v", body)
					}
					stream, _ := body["stream"].(bool)
					if stream != (scenario != "stream_disabled") {
						t.Errorf("stream = %v for %s", body["stream"], scenario)
					}
					if stream {
						if r.Header.Get("Accept") != "text/event-stream" {
							t.Errorf("Accept = %q", r.Header.Get("Accept"))
						}
						if wire.id == "chat-completion" {
							options, _ := body["stream_options"].(map[string]any)
							if options["include_usage"] != true {
								t.Error("stream usage was not requested")
							}
						}
					}
					if scenario == "http_524" {
						w.WriteHeader(524)
						fmt.Fprint(w, "upstream HTTP 524")
						return
					}
					if scenario == "json_fallback" || scenario == "stream_disabled" {
						w.Header().Set("Content-Type", "application/json")
						fmt.Fprint(w, wire.response)
						return
					}
					w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
					fmt.Fprint(w, wire.event)
					w.(http.Flusher).Flush()
					// A delta must reach the caller before the upstream response ends.
					select {
					case <-deltaReceived:
					case <-time.After(3 * time.Second):
						t.Error("text was buffered until the response ended")
					}
					if scenario == "cancel" {
						<-r.Context().Done()
					}
				}))
				defer server.Close()
				var deltas strings.Builder
				input := canvasGenerationInput{
					Mode: "text", Prompt: "hello", StreamText: scenario != "stream_disabled",
					Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "test-model", InterfaceType: wire.id},
					OnTextDelta: func(delta string) {
						deltas.WriteString(delta)
						deltaReceived <- struct{}{}
						if scenario == "cancel" {
							cancel()
						}
					},
				}
				result, err := runTextTask(withProtocolRegistry(ctx, loadOfficialFallbackRegistry()), input)
				if calls.Load() != 1 {
					t.Fatalf("upstream calls = %d, want exactly one", calls.Load())
				}
				switch scenario {
				case "http_524":
					var upstream providerHTTPError
					if !errors.As(err, &upstream) || upstream.StatusCode != 524 || !billingFailureUncertain(err) {
						t.Fatalf("524 must remain an uncertain failure: %v", err)
					}
				case "cancel":
					if !errors.Is(err, context.Canceled) {
						t.Fatalf("expected cancellation, got %v", err)
					}
				default:
					if err != nil || result["text"] != "hello" {
						t.Fatalf("result = %#v, err = %v", result, err)
					}
					if scenario == "stream" && deltas.String() != "hello" {
						t.Fatalf("deltas = %q", deltas.String())
					}
				}
			})
		}
	}
}
