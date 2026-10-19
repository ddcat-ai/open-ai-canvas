package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestDashscopeMiniMaxVideoRuntime(t *testing.T) {
	allowLoopbackProviderTest(t)
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := withProtocolRegistry(context.Background(), center.registrySnapshot())
	adapter, ok := declarativeProtocolAdapterForContext(ctx, "dashscope-minimax-video")
	if !ok {
		t.Fatal("official MiniMax plugin was not installed")
	}
	var creates, polls, downloads atomic.Int32
	var emptyResult atomic.Bool
	mediaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloads.Add(1)
		if r.URL.Path != "/result.mp4" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected media request: %s, authorization present: %t", r.URL.Path, r.Header.Get("Authorization") != "")
		}
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write([]byte("video"))
	}))
	defer mediaServer.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/api/") && r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("missing Bearer authentication")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/v1/services/aigc/video-generation/video-synthesis":
			creates.Add(1)
			if r.Method != "POST" || r.Header.Get("X-DashScope-Async") != "enable" {
				t.Errorf("create headers or method = %#v %s", r.Header, r.Method)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode body: %v", err)
			}
			input, _ := body["input"].(map[string]any)
			parameters, _ := body["parameters"].(map[string]any)
			if body["model"] != "MiniMax/MiniMax-H3" || input["prompt"] != "海边的猫" || parameters["duration"] != float64(5) || parameters["resolution"] != "768P" || parameters["ratio"] != "16:9" {
				t.Errorf("body = %#v", body)
			}
			_, _ = w.Write([]byte(`{"output":{"task_id":"existing-task","task_status":"PENDING"}}`))
		case "/api/v1/tasks/existing-task":
			polls.Add(1)
			if r.Method != "GET" {
				t.Errorf("poll method = %s", r.Method)
			}
			if emptyResult.Load() {
				_, _ = w.Write([]byte(`{"output":{"task_id":"existing-task","task_status":"SUCCEEDED"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"output":{"task_id":"existing-task","task_status":"SUCCEEDED","video_url":"` + mediaServer.URL + `/result.mp4"},"usage":{"input_seconds":0,"output_seconds":5,"total_seconds":5}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	input := canvasGenerationInput{
		Mode: "video", Prompt: "海边的猫",
		Config: providerConfig{BaseURL: server.URL + "/compatible-mode/v1", APIKey: "test-key", InterfaceType: "dashscope-minimax-video", Model: "MiniMax/MiniMax-H3", VideoSeconds: "5", VQuality: "768P", Size: "16:9"},
	}
	result, err := runProtocolAdapterTaskWithPolicy(ctx, input, adapter, fastVideoPollPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if result["mode"] != "video" || creates.Load() != 1 || polls.Load() != 1 || downloads.Load() != 1 {
		t.Fatalf("result=%#v creates=%d polls=%d downloads=%d", result, creates.Load(), polls.Load(), downloads.Load())
	}
	if _, _, err := queryProtocolAdapterVideoTask(ctx, input, adapter, "existing-task"); err != nil {
		t.Fatal(err)
	}
	if creates.Load() != 1 || polls.Load() != 2 || downloads.Load() != 2 {
		t.Fatalf("recovery creates=%d polls=%d downloads=%d", creates.Load(), polls.Load(), downloads.Load())
	}
	emptyResult.Store(true)
	if _, _, err := queryProtocolAdapterVideoTask(ctx, input, adapter, "existing-task"); err == nil || !strings.Contains(err.Error(), "没有返回结果") {
		t.Fatalf("empty result error = %v", err)
	}
	if creates.Load() != 1 || downloads.Load() != 2 {
		t.Fatal("empty result triggered another create or download")
	}
}
