package main

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T, upstream *url.URL) http.Handler {
	t.Helper()
	root := t.TempDir()
	for name, content := range map[string]string{"index.html": "<html>SPA</html>", "assets/app.js": "console.log('ok')", "welcome/hero.svg": "<svg/>"} {
		target := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	h, err := newGateway(root, 33123, upstream)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.Close() })
	return h
}
func request(h http.Handler, method, p, host, origin string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "http://127.0.0.1:33123"+p, nil)
	r.Host = host
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestStaticFallbackAndMissingAssets(t *testing.T) {
	upstream, _ := url.Parse("http://127.0.0.1:1")
	h := fixture(t, upstream)
	for _, tc := range []struct {
		p      string
		status int
		body   string
	}{
		{"/", 200, "SPA"}, {"/projects/123", 200, "SPA"}, {"/assets", 200, "SPA"}, {"/assets/", 200, "SPA"},
		{"/canvas/", 200, "SPA"}, {"/welcome", 200, "SPA"}, {"/inspirations", 200, "SPA"},
		{"/assets/app.js", 200, "console.log"}, {"/welcome/hero.svg", 200, "<svg"},
		{"/assets/missing.js", 404, "404"}, {"/missing.png", 404, "404"},
		{"/../secret", 404, "404"}, {"/%2e%2e/secret", 404, "404"}, {"/.settings-key", 404, "404"},
	} {
		t.Run(tc.p, func(t *testing.T) {
			w := request(h, "GET", tc.p, "127.0.0.1:33123", "")
			if w.Code != tc.status || !strings.Contains(w.Body.String(), tc.body) {
				t.Fatalf("%d %s", w.Code, w.Body)
			}
		})
	}
	if w := request(h, "POST", "/project", "127.0.0.1:33123", ""); w.Code != 405 {
		t.Fatal(w.Code)
	}
	if w := request(h, "HEAD", "/", "127.0.0.1:33123", ""); w.Body.Len() != 0 {
		t.Fatal("HEAD body")
	}
}
func TestHostOriginBoundaries(t *testing.T) {
	u, _ := url.Parse("http://127.0.0.1:1")
	h := fixture(t, u)
	for _, host := range []string{"localhost:33123", "127.0.0.1", "127.0.0.1:33124", "127.0.0.1.evil:33123", "[::1]:33123", "evil.test:33123", "127.1:33123", "127.0.0.1:033123"} {
		if w := request(h, "GET", "/api/health/ready", host, ""); w.Code != 403 {
			t.Fatalf("accepted %q: %d", host, w.Code)
		}
	}
	for _, origin := range []string{"null", "https://127.0.0.1:33123", "http://evil.test", "http://127.0.0.1:33123/"} {
		if w := request(h, "POST", "/api/tasks", "127.0.0.1:33123", origin); w.Code != 403 {
			t.Fatalf("accepted origin %q", origin)
		}
	}
	if w := request(h, "GET", "/", "127.0.0.1:33123", "http://127.0.0.1:33123"); w.Code != 200 {
		t.Fatal(w.Code)
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:33123/", nil)
	r.Header.Set("Sec-Fetch-Site", "cross-site")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal(w.Code)
	}
}
func TestAPIHealthErrorsCookiesAndOAuth(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Forwarded-Host") != "127.0.0.1:33123" || r.Header.Get("Forwarded") != "" {
			t.Error("untrusted forwarded header")
		}
		w.Header().Add("Set-Cookie", "session=test; Path=/; HttpOnly; SameSite=Lax")
		w.WriteHeader(503)
		fmt.Fprintf(w, "%s?%s", r.URL.Path, r.URL.RawQuery)
	}))
	defer backend.Close()
	u, _ := url.Parse(backend.URL)
	h := fixture(t, u)
	for _, p := range []string{"/api/health/ready", "/api/assets/123?download=1", "/oauth/linuxdo/callback?code=test"} {
		w := request(h, "GET", p, "127.0.0.1:33123", "")
		if w.Code != 503 || !strings.Contains(w.Body.String(), strings.Split(p, "?")[0]) || w.Header().Get("Set-Cookie") == "" {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
	}
	backend.Close()
	w := request(h, "GET", "/api/health/ready", "127.0.0.1:33123", "")
	if w.Code != 502 || !strings.Contains(w.Body.String(), "runtime_backend_unavailable") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}
func TestStreamingFlushAndCancellation(t *testing.T) {
	cancelled := make(chan struct{})
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "id: 1\ndata: first\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(cancelled)
	}))
	defer backend.Close()
	u, _ := url.Parse(backend.URL)
	h := fixture(t, u)
	gateway := httptest.NewServer(h)
	defer gateway.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", gateway.URL+"/api/tasks/1/text-events", nil)
	req.Host = "127.0.0.1:33123"
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(resp.Body).ReadString('\n')
	if err != nil || line != "id: 1\n" {
		t.Fatalf("first event not flushed: %q %v", line, err)
	}
	resp.Body.Close()
	cancel()
	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("upstream cancellation missing")
	}
}
func TestSymlinkCannotEscapeStaticRoot(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	os.WriteFile(filepath.Join(root, "index.html"), []byte("SPA"), 0600)
	os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("SECRET"), 0600)
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	u, _ := url.Parse("http://127.0.0.1:1")
	h, err := newGateway(root, 33123, u)
	if err != nil {
		t.Fatal(err)
	}
	defer h.Close()
	w := request(h, "GET", "/escape/secret.txt", "127.0.0.1:33123", "")
	if w.Code != 404 || strings.Contains(w.Body.String(), "SECRET") {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}
func TestBackendEnvIgnoresAmbientServices(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://must-not-use")
	t.Setenv("YINGCE_AGENT_URL", "http://remote")
	t.Setenv("NODE_OPTIONS", "--inspect=0.0.0.0")
	t.Setenv("YINGCE_RUNTIME_SHUTDOWN_TOKEN", "ambient-token-must-not-leak")
	t.Setenv("YINGCE_BACKEND_SHUTDOWN_TOKEN", "ambient-backend-token-must-not-leak")
	env := strings.Join(backendEnv("/data", "127.0.0.1:1234", 33123, "/release/runtime"), "\n")
	for _, bad := range []string{"DATABASE_URL=", "YINGCE_AGENT_URL=", "NODE_OPTIONS=", "YINGCE_RUNTIME_SHUTDOWN_TOKEN=", "YINGCE_BACKEND_SHUTDOWN_TOKEN="} {
		if strings.Contains(env, bad) {
			t.Fatal("ambient config leaked:", bad)
		}
	}
	for _, required := range []string{"CANVAS_DATABASE_DRIVER=sqlite", "CANVAS_BACKEND_ADDR=127.0.0.1:1234", "CANVAS_BACKEND_DATA_DIR=/data", "CANVAS_CORS_ORIGINS=http://127.0.0.1:33123"} {
		if !strings.Contains(env, required) {
			t.Fatal("missing", required)
		}
	}
}
