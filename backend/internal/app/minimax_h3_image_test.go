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

// 官方包经插件中心安装后，宿主负责 Bearer、路由、下载持久化和失败语义；
// 这里用本地模拟上游验证完整链路，不调用真实 MiniMax 付费接口。
func TestMiniMaxH3ImageRuntime(t *testing.T) {
	allowLoopbackProviderTest(t)
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ctx := withProtocolRegistry(context.Background(), center.registrySnapshot())
	adapter, ok := declarativeProtocolAdapterForContext(ctx, "minimax-h3-image")
	if !ok {
		t.Fatal("official MiniMax H3 Image plugin was not installed")
	}
	if _, ok := declarativeProtocolAdapterForContext(ctx, "minimax-image"); !ok {
		t.Fatal("legacy MiniMax Image plugin must remain installed alongside H3")
	}
	var generations, edits, downloads atomic.Int32
	var mode atomic.Value
	mode.Store("ok")
	// 结果图片在独立 CDN 域名上，下载时不能携带渠道 API Key。
	mediaServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloads.Add(1)
		if r.URL.Path != "/media/output-0.jpg" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected media request: %s, authorization present: %t", r.URL.Path, r.Header.Get("Authorization") != "")
		}
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte("jpeg-bytes"))
	}))
	defer mediaServer.Close()
	mediaURL := mediaServer.URL + "/media/output-0.jpg"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("missing Bearer authentication on %s", r.URL.Path)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode body: %v", err)
		}
		switch r.URL.Path {
		case "/v1/images/generations":
			generations.Add(1)
			if _, present := body["images"]; present || body["model"] != "MiniMax-H3-Image-Highspeed" || body["size"] != "auto" || body["aspect_ratio"] != "16:9" || body["area"] != "2K" || body["n"] != float64(1) || body["response_format"] != "url" {
				t.Errorf("generations body = %#v", body)
			}
		case "/v1/images/edits":
			edits.Add(1)
			images, _ := body["images"].([]any)
			if len(images) != 2 || body["model"] != "MiniMax-H3-Image" {
				t.Errorf("edits body = %#v", body)
			}
		default:
			http.NotFound(w, r)
			return
		}
		for _, forbidden := range []string{"quality", "background"} {
			if _, present := body[forbidden]; present {
				t.Errorf("body must not contain %s: %#v", forbidden, body)
			}
		}
		switch mode.Load() {
		case "unprocessable":
			w.WriteHeader(http.StatusUnprocessableEntity)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"unprocessable_entity_error","message":"input content failed safety check: prompt (1026)","http_code":"422"},"request_id":"req-422"}`))
		case "all-failed-200":
			_, _ = w.Write([]byte(`{"data":[{"error":{"code":"1027","message":"output image failed content safety check"}}],"request_id":"req-200"}`))
		default:
			_, _ = w.Write([]byte(`{"created":1792308678,"data":[{"url":"` + mediaURL + `","size":"2720x1536"},{"error":{"code":"1027","message":"output image failed content safety check"}}],"output_format":"jpeg","usage":{"generated_images":1},"request_id":"req-ok"}`))
		}
	}))
	defer server.Close()

	run := func(input canvasGenerationInput) (map[string]interface{}, error) {
		return runProtocolAdapterTaskWithPolicy(ctx, input, adapter, fastVideoPollPolicy())
	}
	textInput := canvasGenerationInput{
		Mode: "image", Prompt: "雨夜霓虹街道",
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", InterfaceType: "minimax-h3-image", Model: "MiniMax-H3-Image-Highspeed", Size: "16:9", ImageResolution: "2K", Count: "1"},
	}
	result, err := run(textInput)
	if err != nil {
		t.Fatal(err)
	}
	images, _ := result["images"].([]interface{})
	if result["mode"] != "image" || len(images) != 1 || generations.Load() != 1 || downloads.Load() != 1 {
		t.Fatalf("result=%#v generations=%d downloads=%d", result, generations.Load(), downloads.Load())
	}
	if item, _ := images[0].(map[string]interface{}); item["mimeType"] != "image/jpeg" || !strings.HasPrefix(item["dataUrl"].(string), "data:image/jpeg;base64,") {
		t.Fatalf("image item = %#v, 临时 URL 必须下载为持久化内容", images[0])
	}

	// 渠道 Base URL 写成 .../v1 时也必须命中 /v1/images/generations，不能拼出 /v1/v1。
	versioned := textInput
	versioned.Config.BaseURL = server.URL + "/v1"
	if _, err := run(versioned); err != nil {
		t.Fatalf("versioned base URL: %v", err)
	}

	editInput := textInput
	editInput.Config.Model = "MiniMax-H3-Image"
	editInput.ReferenceImages = []providerMedia{{ID: "a", DataURL: "data:image/png;base64,QUJD"}, {ID: "b", DataURL: "data:image/png;base64,REVG"}}
	if _, err := run(editInput); err != nil {
		t.Fatal(err)
	}
	if edits.Load() != 1 || generations.Load() != 2 || downloads.Load() != 3 {
		t.Fatalf("edits=%d generations=%d downloads=%d", edits.Load(), generations.Load(), downloads.Load())
	}

	mode.Store("unprocessable")
	if _, err := run(textInput); err == nil || !strings.Contains(err.Error(), "safety check") {
		t.Fatalf("HTTP 422 error = %v", err)
	}
	mode.Store("all-failed-200")
	if _, err := run(textInput); err == nil || !strings.Contains(err.Error(), "content safety check") {
		t.Fatalf("all-failed 200 error = %v", err)
	}
	// 失败不会触发额外创建或下载：上游不幂等，重复提交会重复扣费。
	if generations.Load() != 4 || downloads.Load() != 3 {
		t.Fatalf("generations=%d downloads=%d after failures", generations.Load(), downloads.Load())
	}
}
