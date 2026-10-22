package app

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"syscall"
	"testing"
)

// resetConnection 读完请求后以 SO_LINGER=0 关闭连接，客户端读取响应时得到 ECONNRESET。
func resetConnection(t *testing.T, w http.ResponseWriter) {
	t.Helper()
	conn, _, err := w.(http.Hijacker).Hijack()
	if err != nil {
		t.Fatalf("hijack: %v", err)
	}
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.SetLinger(0)
	}
	_ = conn.Close()
}

func TestVideoPollContinuesAfterConnectionResetAndEOF(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var mu sync.Mutex
	var paths []string
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		paths = append(paths, r.Method+" "+r.URL.Path)
		mu.Unlock()
		// 每个请求都用新连接，避免 net/http 对复用连接上的 GET 自动重试，掩盖错误。
		w.Header().Set("Connection", "close")
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/videos":
			_, _ = w.Write([]byte(`{"id":"video-1","status":"queued"}`))
		case "GET /v1/videos/video-1":
			mu.Lock()
			polls++
			attempt := polls
			mu.Unlock()
			switch attempt {
			case 1:
				resetConnection(t, w)
			case 2:
				conn, _, _ := w.(http.Hijacker).Hijack()
				_ = conn.Close()
			default:
				_, _ = w.Write([]byte(`{"id":"video-1","status":"completed"}`))
			}
		case "GET /v1/videos/video-1/content":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runVideoTaskForTest(context.Background(), canvasGenerationInput{
		Prompt: "make it move",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "grok-video"},
	})
	if err != nil {
		t.Fatalf("runVideoTask() error = %v, want polling to continue after transient transport errors", err)
	}
	video, ok := result["video"].(map[string]interface{})
	if !ok || video["dataUrl"] != "data:video/mp4;base64,dmlkZW8=" {
		t.Fatalf("video = %#v", result["video"])
	}
	want := "POST /v1/videos,GET /v1/videos/video-1,GET /v1/videos/video-1,GET /v1/videos/video-1,GET /v1/videos/video-1/content"
	if got := strings.Join(paths, ","); got != want {
		t.Fatalf("paths = %q, want %q (one create, polls resumed on the same task)", got, want)
	}
}

func TestVideoPollClassifiesTransportInterruptions(t *testing.T) {
	transport := func(cause error) error {
		return &url.Error{Op: "Get", URL: "https://provider.example/v1/videos/1", Err: &net.OpError{Op: "read", Net: "tcp", Err: os.NewSyscallError("read", cause)}}
	}
	for name, err := range map[string]error{
		"reset":   transport(syscall.ECONNRESET),
		"aborted": transport(syscall.ECONNABORTED),
		"pipe":    transport(syscall.EPIPE),
		"eof":     &url.Error{Op: "Get", URL: "https://provider.example/v1/videos/1", Err: io.EOF},
	} {
		if retry, notFound := retryableVideoPollError(context.Background(), err); !retry || notFound {
			t.Errorf("%s: retry=%v notFound=%v, want transient", name, retry, notFound)
		}
	}
	for name, err := range map[string]error{
		"plain text":     errors.New("upstream: connection reset by peer"),
		"bare eof":       io.EOF,
		"http 400":       providerHTTPError{StatusCode: http.StatusBadRequest, Body: "connection reset by peer"},
		"media recovery": &mediaRecoveryError{stage: "download", retryable: true, cause: transport(syscall.ECONNRESET)},
	} {
		if retry, _ := retryableVideoPollError(context.Background(), err); retry {
			t.Errorf("%s: retry=true, want permanent", name)
		}
	}
}
