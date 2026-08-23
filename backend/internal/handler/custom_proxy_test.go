package handler

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
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
		if r.Header.Get("User-Agent") != "Custom Relay Agent" {
			t.Errorf("User-Agent = %q", r.Header.Get("User-Agent"))
		}
		if r.Header.Get("X-Gateway-Tenant") != "tenant-a" {
			t.Errorf("X-Gateway-Tenant = %q", r.Header.Get("X-Gateway-Tenant"))
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
	markDesktopLocalRelayTestRequest(request, upstream.URL)
	request.Header.Set(service.CustomRelayHeadersHeader, base64.StdEncoding.EncodeToString([]byte(`[{"name":"User-Agent","value":"Custom Relay Agent"},{"name":"X-Gateway-Tenant","value":"tenant-a"}]`)))
	request.Header.Set("Cookie", "browser=session")
	request.Header.Set("Origin", "https://canvas.example.com")
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request

	proxyCustomRelayRequestWithCapabilities(context, defaultCustomRelayTestPolicy(), true)
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

func TestCustomRelayReturnsVideoContent(t *testing.T) {
	gin.SetMode(gin.TestMode)
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write([]byte("video-content"))
	}))
	defer upstream.Close()
	useCustomRelayTestClient(t, upstream.Client())
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")

	request := httptest.NewRequest(http.MethodGet, "/api/ai/custom", nil)
	request.Header.Set("Authorization", "Bearer test-key")
	request.Header.Set("X-Canvas-Upstream-URL", upstream.URL+"/v1/videos/task-1/content")
	request.Header.Set("X-Canvas-Upstream-Format", "openai")
	markDesktopLocalRelayTestRequest(request, upstream.URL)
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request

	proxyCustomRelayRequestWithCapabilities(context, defaultCustomRelayTestPolicy(), true)
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "video/mp4" || response.Body.String() != "video-content" {
		t.Fatalf("status = %d, content-type = %q, body = %q", response.Code, response.Header().Get("Content-Type"), response.Body.String())
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
	markDesktopLocalRelayTestRequest(request, upstream.URL)
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request

	proxyCustomRelayRequestWithCapabilities(context, defaultCustomRelayTestPolicy(), true)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestCustomRelayConvertsClaudeAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const apiKey = "claude-secret-key"
	upstream := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Header.Get("x-api-key") != apiKey {
			t.Errorf("x-api-key = %q", r.Header.Get("x-api-key"))
		}
		if r.Header.Get("Authorization") != "" {
			t.Errorf("Authorization should not be forwarded, got %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Errorf("anthropic-version = %q", r.Header.Get("anthropic-version"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"content":[{"type":"text","text":"claude relay works"}]}`)
	}))
	defer upstream.Close()
	useCustomRelayTestClient(t, upstream.Client())
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")

	request := httptest.NewRequest(http.MethodPost, "/api/ai/custom", strings.NewReader(`{"model":"claude-test","messages":[]}`))
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Canvas-Upstream-URL", upstream.URL+"/v1/messages")
	request.Header.Set("X-Canvas-Upstream-Format", "claude")
	markDesktopLocalRelayTestRequest(request, upstream.URL)
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request

	proxyCustomRelayRequestWithCapabilities(context, defaultCustomRelayTestPolicy(), true)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "claude relay works") {
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
		proxyCustomRelayRequestWithCapabilities(context, defaultCustomRelayTestPolicy(), true)
	}))
	defer proxy.Close()
	request, _ := http.NewRequest(http.MethodPost, proxy.URL, strings.NewReader(`{"model":"test"}`))
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("X-Canvas-Upstream-URL", upstream.URL+"/v1/responses")
	request.Header.Set("X-Canvas-Upstream-Format", "openai")
	markDesktopLocalRelayTestRequest(request, upstream.URL)
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
	customRelayClient = func(time.Duration, *url.URL, bool, bool) *http.Client {
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
	markDesktopLocalRelayTestRequest(request, "https://127.0.0.1")
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request

	proxyCustomRelayRequestWithCapabilities(context, defaultCustomRelayTestPolicy(), true)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
	if connected {
		t.Fatal("oversized request should not create an upstream client")
	}
}

func TestDesktopLocalCustomRelayRequiresServerCapabilityAcrossSupportedPaths(t *testing.T) {
	gin.SetMode(gin.TestMode)
	requests := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if strings.HasSuffix(r.URL.Path, "/content") {
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video-content"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer upstream.Close()
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "false")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "")

	tests := []struct {
		name        string
		method      string
		path        string
		contentType string
	}{
		{name: "models", method: http.MethodGet, path: "/v1/models"},
		{name: "text", method: http.MethodPost, path: "/v1/responses", contentType: "application/json"},
		{name: "image", method: http.MethodPost, path: "/v1/images/generations", contentType: "application/json"},
		{name: "video submit", method: http.MethodPost, path: "/v1/videos", contentType: "application/json"},
		{name: "audio", method: http.MethodPost, path: "/v1/audio/speech", contentType: "application/json"},
		{name: "video poll", method: http.MethodGet, path: "/v1/videos/task-1"},
		{name: "video download", method: http.MethodGet, path: "/v1/videos/task-1/content"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body := io.Reader(nil)
			if test.method == http.MethodPost {
				body = strings.NewReader(`{}`)
			}
			request := httptest.NewRequest(test.method, "/api/ai/custom", body)
			request.Header.Set("Authorization", "Bearer test-key")
			request.Header.Set("X-Canvas-Upstream-URL", upstream.URL+test.path)
			request.Header.Set("X-Canvas-Upstream-Format", "openai")
			request.Header.Set(service.LocalChannelRequestHeader, "1")
			request.Header.Set(service.LocalChannelBaseURLHeader, upstream.URL)
			if test.contentType != "" {
				request.Header.Set("Content-Type", test.contentType)
			}
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = request

			before := requests
			proxyCustomRelayRequestWithCapabilities(context, defaultCustomRelayTestPolicy(), false)
			if response.Code == http.StatusOK || requests != before {
				t.Fatalf("capability=false status=%d requests=%d->%d", response.Code, before, requests)
			}

			request = httptest.NewRequest(test.method, "/api/ai/custom", bodyForRelayMethod(test.method))
			request.Header.Set("Authorization", "Bearer test-key")
			request.Header.Set("X-Canvas-Upstream-URL", upstream.URL+test.path)
			request.Header.Set("X-Canvas-Upstream-Format", "openai")
			request.Header.Set(service.LocalChannelRequestHeader, "1")
			request.Header.Set(service.LocalChannelBaseURLHeader, upstream.URL)
			if test.contentType != "" {
				request.Header.Set("Content-Type", test.contentType)
			}
			response = httptest.NewRecorder()
			context, _ = gin.CreateTestContext(response)
			context.Request = request
			proxyCustomRelayRequestWithCapabilities(context, defaultCustomRelayTestPolicy(), true)
			if response.Code != http.StatusOK || requests != before+1 {
				t.Fatalf("capability=true status=%d body=%s requests=%d->%d", response.Code, response.Body.String(), before, requests)
			}
		})
	}
}

func TestDesktopLocalCustomRelayDoesNotFollowRedirects(t *testing.T) {
	gin.SetMode(gin.TestMode)
	reachedTarget := false
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		reachedTarget = true
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", target.URL+"/v1/models")
		w.WriteHeader(http.StatusFound)
	}))
	defer source.Close()
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "false")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "")

	request := httptest.NewRequest(http.MethodGet, "/api/ai/custom", nil)
	request.Header.Set("Authorization", "Bearer test-key")
	request.Header.Set("X-Canvas-Upstream-URL", source.URL+"/v1/models")
	request.Header.Set("X-Canvas-Upstream-Format", "openai")
	request.Header.Set(service.LocalChannelRequestHeader, "1")
	request.Header.Set(service.LocalChannelBaseURLHeader, source.URL)
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = request
	proxyCustomRelayRequestWithCapabilities(context, defaultCustomRelayTestPolicy(), true)
	if response.Code == http.StatusOK {
		t.Fatalf("redirect response status=%d body=%s", response.Code, response.Body.String())
	}
	if reachedTarget {
		t.Fatal("desktop local relay redirect target must not be reached")
	}
}

func bodyForRelayMethod(method string) io.Reader {
	if method == http.MethodPost {
		return strings.NewReader(`{}`)
	}
	return nil
}

func markDesktopLocalRelayTestRequest(request *http.Request, baseURL string) {
	request.Header.Set(service.LocalChannelRequestHeader, "1")
	request.Header.Set(service.LocalChannelBaseURLHeader, baseURL)
}

func useCustomRelayTestClient(t *testing.T, client *http.Client) {
	t.Helper()
	previous := customRelayClient
	customRelayClient = func(time.Duration, *url.URL, bool, bool) *http.Client { return client }
	t.Cleanup(func() { customRelayClient = previous })
}

func defaultCustomRelayTestPolicy() service.RuntimeRequestPolicy {
	return service.RuntimeRequestPolicy{
		CustomRelayRequestMB: 32, CustomRelayResponseMB: 32, CustomRelayTimeoutMinutes: 10,
	}
}
