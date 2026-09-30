package app

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestGeminiCacheUsableRejectsInvalidResourceName(t *testing.T) {
	future := time.Now().Add(time.Minute)
	for _, tc := range []struct {
		name     string
		resource string
		want     bool
	}{
		{name: "valid", resource: "cachedContents/cache-1", want: true},
		{name: "missing prefix", resource: "cache-1", want: false},
		{name: "path traversal", resource: "cachedContents/../cache-1", want: false},
		{name: "query", resource: "cachedContents/cache-1?x=1", want: false},
		{name: "empty", resource: "", want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := geminiCacheUsable(&model.CloudAgentGeminiCache{ResourceName: tc.resource, ExpireTime: future})
			if got != tc.want {
				t.Fatalf("geminiCacheUsable(%q) = %v, want %v", tc.resource, got, tc.want)
			}
		})
	}
}

func TestProviderRequestIsBillable(t *testing.T) {
	for _, tc := range []struct {
		method string
		kind   string
		want   bool
	}{
		{method: http.MethodPost, kind: "create", want: true},
		{method: http.MethodPost, kind: "cache-create", want: false},
		{method: http.MethodDelete, kind: "cache-delete", want: false},
		{method: http.MethodPost, kind: "cancel", want: false},
		{method: http.MethodGet, kind: "poll", want: false},
	} {
		t.Run(tc.method+"/"+tc.kind, func(t *testing.T) {
			if got := providerRequestIsBillable(tc.method, tc.kind); got != tc.want {
				t.Fatalf("providerRequestIsBillable(%q, %q) = %v, want %v", tc.method, tc.kind, got, tc.want)
			}
		})
	}
}

func TestPrepareOfficialGeminiAgentCacheCreatesAndReusesStablePrefix(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var mu sync.Mutex
	cacheCreates := 0
	modelRequests := 0
	server := newIPv4TestServer(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1beta/cachedContents":
			if r.Method != http.MethodPost {
				t.Fatalf("cache method = %s, want POST", r.Method)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode cache body: %v", err)
			}
			if body["systemInstruction"] == nil || body["tools"] == nil || body["toolConfig"] == nil {
				t.Fatalf("cache body lost stable prefix: %#v", body)
			}
			mu.Lock()
			cacheCreates++
			mu.Unlock()
			_, _ = w.Write([]byte(`{"name":"cachedContents/cache-1","expireTime":"2099-01-01T00:00:00Z"}`))
		case "/v1beta/models/gemini-test:generateContent":
			if r.Method != http.MethodPost {
				t.Fatalf("model method = %s, want POST", r.Method)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode model body: %v", err)
			}
			if body["cachedContent"] != "cachedContents/cache-1" {
				t.Errorf("cachedContent = %#v", body["cachedContent"])
			}
			if _, ok := body["systemInstruction"]; ok {
				t.Error("cached model request still contains systemInstruction")
			}
			if _, ok := body["tools"]; ok {
				t.Error("cached model request still contains tools")
			}
			if _, ok := body["toolConfig"]; ok {
				t.Error("cached model request still contains toolConfig")
			}
			mu.Lock()
			modelRequests++
			mu.Unlock()
			_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	db, err := gorm.Open(sqlite.Open("file:gemini-cache-test?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.ApiCallLog{}, &model.CloudAgentGeminiCache{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	ctx := context.WithValue(context.Background(), providerAnalyticsKey{}, providerAnalyticsContext{Service: svc, UserID: "user-1"})
	input := canvasGenerationInput{Config: providerConfig{
		InterfaceType: officialGeminiAgentInterface,
		APIFormat:     "gemini",
		BaseURL:       server.URL,
		APIKey:        "secret-key-must-not-be-persisted",
		Model:         "gemini-test",
	}}
	stableInstruction := strings.Repeat("stable system instruction ", 1000)
	spec := protocol.RequestSpec{
		Method:      http.MethodPost,
		Path:        "/v1beta/models/gemini-test:generateContent",
		ContentType: "application/json",
		Body: map[string]any{
			"systemInstruction": map[string]any{"parts": []any{map[string]any{"text": stableInstruction}}},
			"tools":             []any{map[string]any{"functionDeclarations": []any{map[string]any{"name": "canvas_get_state"}}}},
			"toolConfig":        map[string]any{"functionCallingConfig": map[string]any{"mode": "AUTO"}},
			"contents":          []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": "hello"}}}},
		},
	}
	// Build the request through the shipped plugin, so the fixture cannot
	// silently diverge from its versioned endpoint or body mapping.
	manifest, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "google-gemini-generate-content", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := protocol.LoadManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	agentAdapter, ok := adapter.(protocol.AgentAdapter)
	if !ok {
		t.Fatal("official Gemini plugin does not support Agent requests")
	}
	spec, err = agentAdapter.BuildAgent(ctx, protocol.AgentRequestContext{BaseURL: server.URL, Model: input.Config.Model, Request: map[string]any{"gemini": spec.Body}})
	if err != nil {
		t.Fatal(err)
	}

	prepared, used, err := prepareOfficialGeminiAgentCache(ctx, input, spec)
	if err != nil {
		t.Fatalf("prepareOfficialGeminiAgentCache() error = %v", err)
	}
	if !used {
		t.Fatal("prepareOfficialGeminiAgentCache() did not use cache")
	}
	preparedBody := protocolBodyObject(prepared.Body)
	if preparedBody["cachedContent"] != "cachedContents/cache-1" {
		t.Fatalf("prepared cachedContent = %#v", preparedBody["cachedContent"])
	}
	if protocolBodyObject(spec.Body)["systemInstruction"] == nil {
		t.Fatal("prepare mutated the original request spec")
	}
	if _, err := executeProtocolRequest(ctx, input.Config, prepared); err != nil {
		t.Fatalf("executeProtocolRequest() error = %v", err)
	}

	reused, used, err := prepareOfficialGeminiAgentCache(ctx, input, spec)
	if err != nil {
		t.Fatalf("reuse prepare error = %v", err)
	}
	if !used || protocolBodyObject(reused.Body)["cachedContent"] != "cachedContents/cache-1" {
		t.Fatalf("reuse result = %#v, used=%v", reused.Body, used)
	}
	mu.Lock()
	defer mu.Unlock()
	if cacheCreates != 1 {
		t.Fatalf("cache create count = %d, want 1", cacheCreates)
	}
	if modelRequests != 1 {
		t.Fatalf("model request count = %d, want 1", modelRequests)
	}
}

func newIPv4TestServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen tcp4: %v", err)
	}
	server := httptest.NewUnstartedServer(handler)
	server.Listener = listener
	server.Start()
	return server
}
