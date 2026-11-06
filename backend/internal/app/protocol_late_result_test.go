package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"yingce/backend/internal/protocol"
)

func lateResultAdapter(t *testing.T, detached bool) protocol.Adapter {
	t.Helper()
	detachedField := ""
	if detached {
		detachedField = `"detachedPolling":true,`
	}
	adapter, err := protocol.LoadManifest([]byte(`{
		"apiVersion":"yingce.plugin/v1",
		"id":"test-late-result-wait","version":"1.0.0","name":"Test Late Result Wait","author":"Test","documentation":"# Test",
		"contributes":{"providers":[{"id":"test-late-result-wait","label":"Test Late Result Wait","capabilities":["video"],"scopes":["canvas"],` + detachedField + `"create":{"method":"POST","path":"/tasks"},"poll":{"method":"GET","path":"/tasks/{{taskId}}"},"response":{"taskIdPaths":["id"],"statusPaths":["status"],"resultPaths":["video_url"],"resultKind":"video"}}]}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	return adapter
}

// 上游一直报告完成却不给媒体地址时，宽限期过后按“没有媒体地址”失败，不能一直轮询到总时限。
func TestDeclarativeProtocolLateResultGivesUpAfterGrace(t *testing.T) {
	allowLoopbackProviderTest(t)
	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/tasks/task-never" {
			polls.Add(1)
		}
		_, _ = w.Write([]byte(`{"id":"task-never","status":"completed","video_url":""}`))
	}))
	defer server.Close()

	_, err := runProtocolAdapterTaskWithPolicy(context.Background(), canvasGenerationInput{
		Mode: "video", Config: providerConfig{BaseURL: server.URL + "/v1", InterfaceType: "test-late-result-wait"},
	}, lateResultAdapter(t, false), fastVideoPollPolicy())
	if err == nil || !strings.Contains(err.Error(), "没有返回") {
		t.Fatalf("permanently empty completed result must fail, got %v", err)
	}
	if got := polls.Load(); got != protocolLateResultMaxPolls+1 {
		t.Fatalf("poll calls = %d, want %d", got, protocolLateResultMaxPolls+1)
	}
}

// 分离式任务回查时遇到“已完成但没有媒体”，在本次 worker 内继续查，不退回调度重新计时。
func TestDetachedProtocolWaitsForLateResultInsideWorker(t *testing.T) {
	allowLoopbackProviderTest(t)
	var polls atomic.Int32
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/tasks/task-detached":
			w.Header().Set("Content-Type", "application/json")
			if polls.Add(1) == 1 {
				_, _ = w.Write([]byte(`{"id":"task-detached","status":"completed","video_url":""}`))
				return
			}
			_, _ = w.Write([]byte(`{"id":"task-detached","status":"completed","video_url":"` + server.URL + `/media.mp4"}`))
		case "/media.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	ctx := context.WithValue(context.Background(), providerAnalyticsKey{}, providerAnalyticsContext{ProviderRequestID: "task-detached"})
	result, err := runProtocolAdapterTaskWithPolicy(ctx, canvasGenerationInput{
		Mode: "video", Config: providerConfig{BaseURL: server.URL + "/v1", InterfaceType: "test-late-result-wait"},
	}, lateResultAdapter(t, true), fastVideoPollPolicy())
	var pending providerStatePendingError
	if errors.As(err, &pending) {
		t.Fatalf("late result must not be returned to the scheduler: %v", err)
	}
	if err != nil || result["mode"] != "video" || polls.Load() != 2 {
		t.Fatalf("result = %#v, err = %v, polls = %d", result, err, polls.Load())
	}
}

// 独立结果接口先返回空清单、稍后才有媒体时，与内联结果同样在宽限期内等待，不在第一次空清单时判失败。
func TestProtocolResultManifestWaitsForLateMedia(t *testing.T) {
	allowLoopbackProviderTest(t)
	raw := []byte(`{"apiVersion":"yingce.plugin/v2","id":"example-late-manifest","version":"1.0.0","name":"Example","author":"Test","documentation":"# Example","contributes":{"providers":[{"id":"example-late-manifest","label":"Example","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/jobs"},"poll":{"method":"GET","path":"/jobs/{{taskId}}"},"result":{"method":"GET","path":"/jobs/{{taskId}}/outputs"},"response":{"taskIdPaths":["job_id"],"statusPaths":["status"],"videos":{"$map":{"from":{"$ref":"response.outputs"},"as":"output","in":{"url":{"$ref":"output.url"}}}}}}]}}`)
	adapters, err := protocol.LoadInstalledProviders(raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	var manifests, downloads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/jobs":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"job_id":"job-late","status":"queued"}`))
		case "/v1/jobs/job-late":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"job_id":"job-late","status":"completed"}`))
		case "/v1/jobs/job-late/outputs":
			w.Header().Set("Content-Type", "application/json")
			if manifests.Add(1) == 1 {
				_, _ = w.Write([]byte(`{"job_id":"job-late","outputs":[]}`))
				return
			}
			_, _ = w.Write([]byte(`{"job_id":"job-late","outputs":[{"url":"media/result.mp4"}]}`))
		case "/v1/jobs/job-late/media/result.mp4":
			downloads.Add(1)
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video bytes"))
		default:
			t.Errorf("unexpected upstream request: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	result, err := runProtocolAdapterTaskWithPolicy(context.Background(), canvasGenerationInput{
		Mode: "video", Config: providerConfig{BaseURL: server.URL, InterfaceType: "example-late-manifest"},
	}, adapters[0], fastVideoPollPolicy())
	if err != nil || result["mode"] != "video" || manifests.Load() != 2 || downloads.Load() != 1 {
		t.Fatalf("result = %#v, err = %v, manifests = %d, downloads = %d", result, err, manifests.Load(), downloads.Load())
	}
}
