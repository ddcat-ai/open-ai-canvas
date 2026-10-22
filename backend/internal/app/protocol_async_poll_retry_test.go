package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/protocol"
)

// asyncImageRetryServer 模拟非视频声明式异步任务：轮询依次返回 failures 中的故障，之后成功。
func asyncImageRetryServer(t *testing.T, failures []string) (*httptest.Server, *int, *int) {
	t.Helper()
	var mu sync.Mutex
	createCalls, pollCalls := 0, 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Connection", "close")
		switch r.URL.Path {
		case "/v1/tasks":
			mu.Lock()
			createCalls++
			mu.Unlock()
			_, _ = w.Write([]byte(`{"id":"provider-task-1","status":"pending"}`))
		case "/v1/tasks/provider-task-1":
			mu.Lock()
			pollCalls++
			attempt := pollCalls
			mu.Unlock()
			if attempt <= len(failures) {
				switch failures[attempt-1] {
				case "reset":
					resetConnection(t, w)
				case "503":
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = w.Write([]byte(`{"message":"busy"}`))
				case "404":
					w.WriteHeader(http.StatusNotFound)
					_, _ = w.Write([]byte(`{"message":"no such task"}`))
				}
				return
			}
			_, _ = w.Write([]byte(`{"id":"provider-task-1","status":"succeeded","image_url":"` + server.URL + `/media.png"}`))
		case "/media.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(mediaTestPNG(t))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server, &createCalls, &pollCalls
}

func runAsyncImageRetryTask(t *testing.T, server *httptest.Server) (map[string]interface{}, error) {
	t.Helper()
	adapter, err := protocol.LoadManifest([]byte(`{
		"apiVersion":"yingce.plugin/v1",
		"id":"test-async-image-retry","version":"1.0.0","name":"Test Async Image Retry","author":"Test","documentation":"# Test",
		"contributes":{"providers":[{"id":"test-async-image-retry","label":"Test Async Image Retry","capabilities":["image"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","fields":{"model":"request.model"}},"poll":{"method":"GET","path":"/tasks/{{taskId}}"},"response":{"taskIdPaths":["id"],"statusPaths":["status"],"resultPaths":["image_url"],"resultKind":"image"}}]}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	policy := declarativeProtocolPollPolicy("image")
	policy.Interval = time.Millisecond
	policy.Sleep = func(context.Context, time.Duration) error { return nil }
	config := providerConfig{BaseURL: server.URL + "/v1", APIKey: "key", Model: "image-model", InterfaceType: "test-async-image-retry"}
	return runProtocolAdapterTaskWithPolicy(context.Background(), canvasGenerationInput{Mode: "image", Prompt: "a picture", Config: config}, adapter, policy)
}

func TestAsyncImagePollStaysFailFastByDefault(t *testing.T) {
	allowLoopbackProviderTest(t)
	t.Setenv(asyncPollTransientRetriesEnv, "")
	server, createCalls, pollCalls := asyncImageRetryServer(t, []string{"reset"})
	if _, err := runAsyncImageRetryTask(t, server); err == nil {
		t.Fatal("默认设置下图片轮询遇到连接重置应立即失败（保持现有 fail-fast）")
	}
	if *createCalls != 1 || *pollCalls != 1 {
		t.Fatalf("create = %d, poll = %d, want 1/1", *createCalls, *pollCalls)
	}
}

func TestAsyncImagePollRetriesTransientErrorsWhenEnabled(t *testing.T) {
	allowLoopbackProviderTest(t)
	t.Setenv(asyncPollTransientRetriesEnv, "3")
	server, createCalls, pollCalls := asyncImageRetryServer(t, []string{"reset", "503"})
	result, err := runAsyncImageRetryTask(t, server)
	if err != nil {
		t.Fatalf("开启后连接重置与 503 应继续轮询原任务：%v", err)
	}
	if result["mode"] != "image" || *createCalls != 1 || *pollCalls != 3 {
		t.Fatalf("result mode = %v, create = %d, poll = %d, want image/1/3", result["mode"], *createCalls, *pollCalls)
	}
}

func TestAsyncImagePollRetryLimitAndNotFoundStillFailFast(t *testing.T) {
	allowLoopbackProviderTest(t)
	t.Setenv(asyncPollTransientRetriesEnv, "1")
	server, _, pollCalls := asyncImageRetryServer(t, []string{"503", "503"})
	if _, err := runAsyncImageRetryTask(t, server); err == nil || *pollCalls != 2 {
		t.Fatalf("超过重试上限应失败：err = %v, poll = %d, want error after 2 polls", err, *pollCalls)
	}

	t.Setenv(asyncPollTransientRetriesEnv, "3")
	server, _, pollCalls = asyncImageRetryServer(t, []string{"404"})
	if _, err := runAsyncImageRetryTask(t, server); err == nil || *pollCalls != 1 {
		t.Fatalf("查无任务仍应第一次就失败：err = %v, poll = %d", err, *pollCalls)
	}
}

func TestAsyncPollTransientRetriesSetting(t *testing.T) {
	for value, want := range map[string]int{"": 0, "0": 0, "-2": 0, "abc": 0, "2": 2, " 4 ": 4, "99": 10} {
		t.Setenv(asyncPollTransientRetriesEnv, value)
		if got := declarativeProtocolPollPolicy("image").TransientRetryLimit; got != want {
			t.Errorf("%q => %d, want %d", value, got, want)
		}
	}
	t.Setenv(asyncPollTransientRetriesEnv, "5")
	if declarativeProtocolPollPolicy("video").TransientRetryLimit != 0 {
		t.Error("视频策略不受该设置影响")
	}
}
