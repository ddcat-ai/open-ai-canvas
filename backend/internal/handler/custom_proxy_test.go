package handler

import (
	"bufio"
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestCustomRelayForwardsOpenAIRequestWithoutBrowserHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const apiKey = "relay-secret-key"
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+apiKey {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		for _, name := range []string{"Cookie", "Origin", "Referer", "X-Canvas-Upstream-URL", "X-Forwarded-For"} {
			if value := r.Header.Get(name); value != "" {
				t.Errorf("upstream received %s = %q", name, value)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Set-Cookie", "upstream=unsafe")
		_, _ = io.WriteString(w, `{"data":[]}`)
	}))
	defer upstream.Close()
	useCustomRelayTestClient(t, upstream.Client())
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")

	request := httptest.NewRequest(http.MethodGet, "/api/ai/custom", nil)
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("X-Canvas-Upstream-URL", upstream.URL+"/v1/models")
	request.Header.Set("X-Canvas-Upstream-Format", "openai")
	request.Header.Set("Cookie", "browser=session")
	request.Header.Set("Origin", "https://canvas.example.com")
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request

	proxyCustomRelayRequest(context, defaultCustomRelayTestPolicy())
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if response.Header().Get("Set-Cookie") != "" {
		t.Fatal("upstream Set-Cookie should not be forwarded")
	}
	if strings.Contains(response.Body.String(), apiKey) {
		t.Fatal("response leaked API key")
	}
}

func TestCustomRelayConvertsGeminiAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const apiKey = "gemini-secret-key"
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != apiKey {
			t.Errorf("x-goog-api-key = %q", r.Header.Get("x-goog-api-key"))
		}
		if r.Header.Get("Authorization") != "" {
			t.Errorf("Authorization should not be forwarded, got %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"candidates":[]}`)
	}))
	defer upstream.Close()
	useCustomRelayTestClient(t, upstream.Client())
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")

	request := httptest.NewRequest(http.MethodPost, "/api/ai/custom", strings.NewReader(`{"contents":[]}`))
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Canvas-Upstream-URL", upstream.URL+"/v1beta/models/gemini-test:generateContent")
	request.Header.Set("X-Canvas-Upstream-Format", "gemini")
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request

	proxyCustomRelayRequest(context, defaultCustomRelayTestPolicy())
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestCustomRelayStreamsBeforeUpstreamCompletes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const apiKey = "stream-secret"
	release := make(chan struct{})
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: first\n\n")
		w.(http.Flusher).Flush()
		<-release
		_, _ = io.WriteString(w, "data: second\n\n")
	}))
	defer upstream.Close()
	useCustomRelayTestClient(t, upstream.Client())
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")

	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		context, _ := gin.CreateTestContext(w)
		context.Request = r
		proxyCustomRelayRequest(context, defaultCustomRelayTestPolicy())
	}))
	defer proxy.Close()
	request, _ := http.NewRequest(http.MethodPost, proxy.URL, strings.NewReader(`{"model":"test"}`))
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("X-Canvas-Upstream-URL", upstream.URL+"/v1/responses")
	request.Header.Set("X-Canvas-Upstream-Format", "openai")
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		close(release)
		t.Fatal(err)
	}
	reader := bufio.NewReader(response.Body)
	line, err := reader.ReadString('\n')
	if err != nil {
		close(release)
		_ = response.Body.Close()
		t.Fatal(err)
	}
	if line != "data: first\n" {
		close(release)
		_ = response.Body.Close()
		t.Fatalf("first streamed line = %q", line)
	}
	close(release)
	_ = response.Body.Close()
}

func TestRelayStreamRedactorHandlesSplitSecret(t *testing.T) {
	redactor := newRelayStreamRedactor("split-secret")
	output := append(redactor.Push([]byte("before split-"), false), redactor.Push([]byte("secret after"), true)...)
	if bytes.Contains(output, []byte("split-secret")) || !bytes.Contains(output, []byte("[REDACTED]")) {
		t.Fatalf("redacted output = %q", output)
	}
}

func TestCustomRelayRejectsOversizedDeclaredBodyBeforeConnecting(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	connected := false
	previous := customRelayClient
	customRelayClient = func(time.Duration) *http.Client {
		connected = true
		return http.DefaultClient
	}
	t.Cleanup(func() { customRelayClient = previous })

	request := httptest.NewRequest(http.MethodPost, "/api/ai/custom", strings.NewReader(`{"model":"test"}`))
	request.ContentLength = (defaultCustomRelayTestPolicy().CustomRelayRequestMB << 20) + 1
	request.Header.Set("Authorization", "Bearer test-key")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Canvas-Upstream-URL", "https://127.0.0.1/v1/responses")
	request.Header.Set("X-Canvas-Upstream-Format", "openai")
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request

	proxyCustomRelayRequest(context, defaultCustomRelayTestPolicy())
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if connected {
		t.Fatal("oversized request should not create an upstream client")
	}
}

func useCustomRelayTestClient(t *testing.T, client *http.Client) {
	t.Helper()
	previous := customRelayClient
	customRelayClient = func(time.Duration) *http.Client { return client }
	t.Cleanup(func() { customRelayClient = previous })
}

func defaultCustomRelayTestPolicy() service.RuntimeRequestPolicy {
	return service.RuntimeRequestPolicy{
		CustomRelayRequestMB: 32, CustomRelayResponseMB: 32, CustomRelayTimeoutMinutes: 10,
	}
}
