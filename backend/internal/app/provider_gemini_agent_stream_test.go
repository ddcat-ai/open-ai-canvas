package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGeminiAgentStreaming(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, scenario := range []string{"stream", "json_fallback", "disabled", "cancel", "unfinished", "provider_error"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			var calls atomic.Int32
			deltaReceived := make(chan struct{}, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				suffix := ":streamGenerateContent"
				if scenario == "disabled" {
					suffix = ":generateContent"
				}
				if r.URL.Path != "/v1beta/models/gemini-test"+suffix {
					t.Errorf("unexpected endpoint: %s", r.URL.Path)
				}
				if scenario != "disabled" && (r.URL.Query().Get("alt") != "sse" || r.Header.Get("Accept") != "text/event-stream") {
					t.Error("native Gemini SSE framing was not requested")
				}
				if r.Header.Get("x-goog-api-key") != "test-key" {
					t.Error("plugin authentication lost")
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if body["contents"] == nil || body["stream"] != nil {
					t.Errorf("not a native Gemini request: %#v", body)
				}
				if scenario == "json_fallback" || scenario == "disabled" {
					w.Header().Set("Content-Type", "application/json")
					if scenario == "json_fallback" {
						// A gateway may return JSON despite alt=sse. Thought parts must
						// remain private and every visible text part must survive.
						fmt.Fprint(w, `{"candidates":[{"content":{"parts":[{"thought":true,"text":"private reasoning"},{"text":"hello "},{"functionCall":{"name":"creation_media_read","args":{"referenceId":"image-1"}},"thoughtSignature":"signature-one"},{"text":"world"},{"functionCall":{"name":"creation_media_read","args":{"referenceId":"image-2"}},"thoughtSignature":"signature-two"}]}}]}`)
					} else {
						fmt.Fprint(w, `{"candidates":[{"content":{"parts":[{"text":"hello world"},{"functionCall":{"name":"creation_media_read","args":{"referenceId":"image-1"}},"thoughtSignature":"signature-one"},{"functionCall":{"name":"creation_media_read","args":{"referenceId":"image-2"}},"thoughtSignature":"signature-two"}]}}]}`)
					}
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"candidates\":[{\"index\":0,\"content\":{\"parts\":[{\"text\":\"hello \"}]}}]}\n\n")
				w.(http.Flusher).Flush()
				select {
				case <-deltaReceived:
				case <-time.After(time.Second):
					t.Error("first delta was buffered until upstream completed")
				}
				if scenario == "cancel" {
					<-r.Context().Done()
					return
				}
				if scenario == "unfinished" {
					return
				}
				if scenario == "provider_error" {
					fmt.Fprint(w, "data: {\"error\":{\"code\":503,\"message\":\"model unavailable\"}}\n\n")
					return
				}
				fmt.Fprint(w, "data: {\"candidates\":[{\"index\":0,\"content\":{\"parts\":[{\"text\":\"world\"},{\"functionCall\":{\"name\":\"creation_media_read\",\"args\":{\"referenceId\":\"image-1\"}},\"thoughtSignature\":\"signature-one\"},{\"functionCall\":{\"name\":\"creation_media_read\",\"args\":{\"referenceId\":\"image-2\"}},\"thoughtSignature\":\"signature-two\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":100,\"candidatesTokenCount\":12,\"cachedContentTokenCount\":50}}\n\n")
			}))
			defer server.Close()
			var deltas strings.Builder
			input := canvasGenerationInput{
				Mode: "text", StreamText: scenario != "disabled",
				Config: providerConfig{InterfaceType: officialGeminiAgentInterface, APIFormat: "gemini", BaseURL: server.URL, Model: "gemini-test", APIKey: "test-key"},
				AgentRequests: &agentToolRequests{Gemini: map[string]any{
					"contents": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": "inspect"}}}},
				}},
				OnTextDelta: func(delta string) {
					deltas.WriteString(delta)
					select {
					case deltaReceived <- struct{}{}:
					default:
					}
					if scenario == "cancel" {
						cancel()
					}
				},
			}
			result, err := runAgentToolTask(withProtocolRegistry(ctx, loadOfficialFallbackRegistry()), input)
			if calls.Load() != 1 {
				t.Fatalf("calls = %d; must not resubmit on stream errors", calls.Load())
			}
			switch scenario {
			case "cancel":
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("cancellation lost: %v", err)
				}
			case "unfinished", "provider_error":
				if err == nil {
					t.Fatalf("partial/error response accepted: %#v", result)
				}
				if scenario == "unfinished" && (!errors.Is(err, io.ErrUnexpectedEOF) || !billingFailureUncertain(err)) {
					t.Fatalf("truncated stream must keep its uncertain billing boundary: %v", err)
				}
			default:
				if err != nil || result["text"] != "hello world" {
					t.Fatalf("result=%#v err=%v", result, err)
				}
				toolCalls := interfaceSlice(result["toolCalls"])
				if len(toolCalls) != 2 {
					t.Fatalf("tool calls lost: %#v", result)
				}
				first, second := toolCalls[0].(map[string]any), toolCalls[1].(map[string]any)
				if first["id"] == second["id"] || first["thoughtSignature"] != "signature-one" || second["thoughtSignature"] != "signature-two" {
					t.Fatalf("tool identity/signature lost: %#v", toolCalls)
				}
				if scenario != "disabled" && deltas.String() != "hello world" {
					t.Fatalf("deltas = %q", deltas.String())
				}
			}
		})
	}
}

func TestGeminiAgentJSONFallbackRejectsErrors(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, tc := range []struct {
		name, response, want string
	}{
		{"provider", `{"error":{"code":503,"message":"model unavailable"}}`, "model unavailable"},
		{"blocked_prompt", `{"promptFeedback":{"blockReason":"SAFETY"}}`, "SAFETY"},
		{"blocked_finish", `{"candidates":[{"content":{"parts":[{"text":"incomplete"}]},"finishReason":"SAFETY"}]}`, "SAFETY"},
		{"partial_tool", `{"candidates":[{"content":{"parts":[{"functionCall":{"name":"generate_media","partialArgs":[{"jsonPath":"$.prompt","stringValue":"unfinished"}]}}]}}]}`, "不完整"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprint(w, tc.response)
			}))
			defer server.Close()
			input := canvasGenerationInput{
				Mode: "text", StreamText: true,
				Config: providerConfig{InterfaceType: officialGeminiAgentInterface, APIFormat: "gemini", BaseURL: server.URL, Model: "gemini-test", APIKey: "test-key"},
				AgentRequests: &agentToolRequests{Gemini: map[string]any{
					"contents": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": "hello"}}}},
				}},
			}
			result, err := runAgentToolTask(withProtocolRegistry(context.Background(), loadOfficialFallbackRegistry()), input)
			if calls.Load() != 1 || err == nil || result != nil {
				t.Fatalf("invalid JSON fallback accepted or retried: calls=%d result=%#v err=%v", calls.Load(), result, err)
			}
			if tc.name == "provider" {
				var upstream providerPayloadError
				if !errors.As(err, &upstream) || upstream.raw != tc.want {
					t.Fatalf("upstream failure was replaced: %v", err)
				}
			} else if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error lost its actual cause: %v", err)
			}
		})
	}
}

func TestGeminiAgentStreamingCacheAndUsage(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, scenario := range []string{"optional_failure", "stale_recovered", "stale_repeated", "stale_rebuild_unavailable", "stream_error"} {
		t.Run(scenario, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "cache.db")), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, _ := db.DB()
			defer sqlDB.Close()
			if err := db.AutoMigrate(
				&model.SystemSetting{}, &model.ApiCallLog{}, &model.CloudAgentGeminiCache{}, &model.ModelPricing{},
				&model.Asset{}, &model.CanvasProject{}, &model.Task{}, &model.TaskLog{}, &model.Result{}, &model.TaskTextDelta{},
			); err != nil {
				t.Fatal(err)
			}
			svc := New(repository.New(db), t.TempDir())
			if err := db.Create(&model.ModelPricing{
				ID: "price", Model: "gemini-test", Capability: "text", Currency: "USD", PerRequestMicros: 7,
				InputPerMillionMicros: 2_000_000, OutputPerMillionMicros: 3_000_000, CachedPerMillionMicros: 1_000_000,
			}).Error; err != nil {
				t.Fatal(err)
			}
			var cacheCalls, modelCalls atomic.Int32
			stale := strings.HasPrefix(scenario, "stale_")
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case r.Method == http.MethodPost && r.URL.Path == "/v1beta/cachedContents":
					n := cacheCalls.Add(1)
					if scenario == "optional_failure" || (scenario == "stale_rebuild_unavailable" && n == 2) {
						w.WriteHeader(http.StatusServiceUnavailable)
						fmt.Fprint(w, `{"error":{"code":503,"message":"cache service unavailable"}}`)
						return
					}
					fmt.Fprintf(w, `{"name":"cachedContents/cache-%d","expireTime":"2099-01-01T00:00:00Z"}`, n)
				case r.Method == http.MethodDelete && r.URL.Path == "/v1beta/cachedContents/cache-1":
					fmt.Fprint(w, `{}`)
				case r.URL.Path == "/v1beta/models/gemini-test:streamGenerateContent":
					n := modelCalls.Add(1)
					if r.URL.Query().Get("alt") != "sse" {
						t.Error("cache path stopped using streaming endpoint")
					}
					var body map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Error(err)
						return
					}
					uncached := scenario == "optional_failure" || (scenario == "stale_rebuild_unavailable" && n == 2)
					if uncached {
						if body["cachedContent"] != nil || body["systemInstruction"] == nil || body["tools"] == nil || body["toolConfig"] == nil {
							t.Errorf("optional cache failure lost the original request: %#v", body)
						}
					} else if body["cachedContent"] != fmt.Sprintf("cachedContents/cache-%d", n) || body["systemInstruction"] != nil || body["tools"] != nil {
						t.Errorf("wrong cache identity/prefix after recovery: %#v", body)
					}
					if stale && (n == 1 || scenario == "stale_repeated") {
						w.WriteHeader(http.StatusNotFound)
						fmt.Fprintf(w, `{"error":{"code":404,"status":"NOT_FOUND","message":"%s not found"}}`, body["cachedContent"])
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(w, "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hello \"}]}}]}\n\n")
					w.(http.Flusher).Flush()
					if scenario == "stream_error" {
						// An error event after visible text is not a definite cached
						// request rejection and must never replay the model request.
						fmt.Fprint(w, "data: {\"error\":{\"code\":404,\"status\":\"NOT_FOUND\",\"message\":\"cachedContents/cache-1 not found\"}}\n\n")
						return
					}
					fmt.Fprint(w, "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"world\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":100,\"candidatesTokenCount\":12,\"cachedContentTokenCount\":50}}\n\n")
				default:
					t.Errorf("unexpected request: %s %s", r.Method, r.URL)
					http.NotFound(w, r)
				}
			}))
			defer server.Close()
			var deltas strings.Builder
			input := canvasGenerationInput{
				Mode: "text", StreamText: true, Metadata: map[string]any{"agentSurface": "creation"},
				Config: providerConfig{InterfaceType: officialGeminiAgentInterface, APIFormat: "gemini", BaseURL: server.URL, Model: "gemini-test", APIKey: "test-key"},
				AgentRequests: &agentToolRequests{Gemini: map[string]any{
					"systemInstruction": map[string]any{"parts": []any{map[string]any{"text": strings.Repeat("stable system instruction ", 1000)}}},
					"tools":             []any{map[string]any{"functionDeclarations": []any{map[string]any{"name": "creation_media_read"}}}},
					"toolConfig":        map[string]any{"functionCallingConfig": map[string]any{"mode": "AUTO"}},
					"contents":          []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": "hello"}}}},
				}},
				OnTextDelta: func(delta string) { deltas.WriteString(delta) },
			}
			ctx := context.WithValue(context.Background(), providerAnalyticsKey{}, providerAnalyticsContext{
				Service: svc, UserID: "user-1", Capability: "text", Model: "gemini-test",
			})
			result, err := runAgentToolTask(withProtocolRegistry(ctx, loadOfficialFallbackRegistry()), input)
			wantCalls := int32(1)
			if stale {
				wantCalls = 2
			}
			if modelCalls.Load() != wantCalls || cacheCalls.Load() != wantCalls {
				t.Fatalf("unexpected retry/cache count: model=%d cache=%d want=%d", modelCalls.Load(), cacheCalls.Load(), wantCalls)
			}
			if scenario == "stale_repeated" {
				var upstream providerHTTPError
				if !errors.As(err, &upstream) || upstream.StatusCode != http.StatusNotFound || deltas.Len() != 0 {
					t.Fatalf("must stop after one rebuild and preserve rejection: err=%v deltas=%q", err, deltas.String())
				}
				return
			}
			if scenario == "stream_error" {
				if err == nil || deltas.String() != "hello " {
					t.Fatalf("stream error retried or discarded partial text: err=%v deltas=%q", err, deltas.String())
				}
				return
			}
			if err != nil || result["text"] != "hello world" || deltas.String() != "hello world" {
				t.Fatalf("stream cache fallback/recovery failed: result=%#v err=%v deltas=%q", result, err, deltas.String())
			}
			var logs []model.ApiCallLog
			if err := db.Where("path = ? AND status = ?", "/v1beta/models/gemini-test:streamGenerateContent", model.ApiCallStatusSucceeded).Find(&logs).Error; err != nil {
				t.Fatal(err)
			}
			if len(logs) != 1 {
				t.Fatalf("successful streaming request was not recorded once: %#v", logs)
			}
			call := logs[0]
			if !call.UsageAvailable || call.InputTokens != 100 || call.OutputTokens != 12 || call.CachedTokens != 50 {
				t.Fatalf("SSE usage lost before EnrichAPICallLog/persistence: %#v", call)
			}
			if !call.Billable || !call.CostAvailable || call.EstimatedCostMicros != 193 {
				t.Fatalf("SSE accounting lost uncached/cached/output costs: %#v", call)
			}
			var cacheLogs []model.ApiCallLog
			if err := db.Where("request_kind IN ?", []string{"cache-create", "cache-delete"}).Find(&cacheLogs).Error; err != nil {
				t.Fatal(err)
			}
			if len(cacheLogs) == 0 {
				t.Fatal("cache management requests were not recorded")
			}
			for _, call := range cacheLogs {
				if call.Billable || call.EstimatedCostMicros != 0 {
					t.Fatalf("optional cache management became billable: %#v", call)
				}
			}
		})
	}
}
