package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestWavespeedImageEditConformance 验证 wavespeed-image-edit 插件在宿主运行时的完整链路：
// create(POST /openai/gpt-image-2.5-sunburst/edit) -> taskId(data.id) -> poll(GET /predictions/{id}/result) -> outputs 结果映射。
func TestWavespeedImageEditConformance(t *testing.T) {
	allowLoopbackProviderTest(t)
	manifest := []byte(`{
		"apiVersion":"yingce.plugin/v2",
		"id":"test-wavespeed-image-edit","version":"1.0.0","name":"WaveSpeed Image Edit","author":"WaveSpeed / 影策","documentation":"# WaveSpeed Image Edit",
		"permissions":["generation.run","media.read"],
		"configuration":{"fields":[{"name":"apiKey","type":"secret","label":"WaveSpeed API Key","required":true}]},
		"contributes":{"providers":[{
			"id":"test-wavespeed-image-edit","label":"WaveSpeed Image Edit","capabilities":["image"],
			"scopes":["admin.system-channel","user.custom-channel","canvas","creation","agent"],
			"baseUrl":"https://api.wavespeed.ai/api/v3","requiresPublicMediaUrls":true,
			"auth":{"type":"bearer","field":"apiKey"},
			"parameters":[
				{"name":"model","type":"string","required":true,"mapping":"model","description":"WaveSpeed 图片编辑模型端点 ID。"},
				{"name":"prompt","type":"string","required":true,"mapping":"prompt","description":"编辑提示词。"},
				{"name":"images","type":"media[]","required":false,"mapping":"provider image/reference fields","description":"编辑源图。"},
				{"name":"aspectRatio","type":"string","required":false,"mapping":"size/aspect_ratio","description":"比例。"},
				{"name":"quality","type":"string","required":false,"mapping":"quality","description":"质量。"},
				{"name":"providerOptions","type":"object","required":false,"mapping":"provider-specific fields","description":"厂商扩展字段。"}
			],
			"create":{"method":"POST","path":"/{{model}}","contentType":"application/json","body":{
				"prompt":{"$ref":"request.prompt"},
				"images":{"$map":{"from":{"$ref":"request.images"},"as":"media","in":{"$ref":"media.value"}}},
				"aspect_ratio":{"$omitEmpty":{"$ref":"request.aspectRatio"}},
				"quality":{"$omitEmpty":{"$ref":"request.quality"}},
				"output_format":{"$omitEmpty":{"$coalesce":[{"$ref":"request.providerOptions.wavespeed-image-edit.output_format"},"png"]}}
			}},
			"poll":{"method":"GET","path":"/predictions/{{taskId}}/result"},
			"response":{
				"taskId":{"$coalesce":[{"$ref":"response.data.id"},{"$ref":"response.id"}]},
				"status":{"$coalesce":[{"$ref":"response.data.status"},{"$ref":"response.status"},"pending"]},
				"message":{"$coalesce":[{"$ref":"response.data.error"},{"$ref":"response.data.message"},{"$ref":"response.error.message"},{"$ref":"response.message"}]},
				"images":{"$ref":"response.data.outputs"},
				"errorPaths":["error.code"],
				"resultEphemeral":true
			}
		}]}
	}`)
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := center.install(testPluginPackage(t, manifest), "wavespeed-image-edit.yingce-plugin"); err != nil {
		t.Fatal(err)
	}

	createCalls := 0
	pollCalls := 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v1/openai/gpt-image-2.5-sunburst/edit"):
			createCalls++
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode create body: %v", err)
			}
			if body["prompt"] != "把背景换成海边日落" {
				t.Errorf("create body prompt = %v", body["prompt"])
			}
			images, ok := body["images"].([]any)
			if !ok || len(images) != 1 || images[0] != "https://cdn.example/source.png" {
				t.Errorf("create body images = %#v", body["images"])
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":200,"data":{"id":"task-ws-001"}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/predictions/task-ws-001/result":
			pollCalls++
			if pollCalls == 1 {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"code":200,"data":{"id":"task-ws-001","status":"processing","outputs":null}}`))
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(fmt.Sprintf(`{"code":200,"data":{"id":"task-ws-001","status":"completed","outputs":[%q,%q]}}`, server.URL+"/result-1.png", server.URL+"/result-2.png")))
		case r.Method == http.MethodGet && (r.URL.Path == "/result-1.png" || r.URL.Path == "/result-2.png"):
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("fake-png"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	config := providerConfig{BaseURL: server.URL, APIKey: "ws-key", Model: "openai/gpt-image-2.5-sunburst/edit", APIFormat: "openai", InterfaceType: "test-wavespeed-image-edit"}
	ctx := context.Background()
	ctx = withProtocolRegistry(ctx, center.registrySnapshot())

	result, err := runDeclarativeProtocolTask(ctx, canvasGenerationInput{
		Mode:            "image",
		Prompt:          "把背景换成海边日落",
		Config:          config,
		ReferenceImages: []providerMedia{{URL: "https://cdn.example/source.png"}},
	})
	if err != nil {
		t.Fatalf("runDeclarativeProtocolTask() error = %v", err)
	}
	if createCalls != 1 {
		t.Fatalf("create calls = %d, want 1", createCalls)
	}
	if pollCalls < 2 {
		t.Fatalf("poll calls = %d, want >= 2", pollCalls)
	}
	// 结果应包含两张输出图
	images, ok := result["images"].([]interface{})
	if !ok || len(images) != 2 {
		raw, _ := json.Marshal(result)
		t.Fatalf("result images type/count unexpected: %s", raw)
	}
	for i, rawImage := range images {
		image, _ := rawImage.(map[string]interface{})
		if strings.TrimSpace(fmt.Sprint(image["dataUrl"])) == "" || image["mimeType"] != "image/png" {
			t.Fatalf("result image %d = %#v", i, image)
		}
	}
	_ = fmt.Sprintf("%v", result["mode"])
}

// TestWavespeedImageEditPollFailure 验证 poll 返回 failed 时错误向上传播。
func TestWavespeedImageEditPollFailure(t *testing.T) {
	allowLoopbackProviderTest(t)
	manifest := []byte(`{
		"apiVersion":"yingce.plugin/v2",
		"id":"test-wavespeed-image-edit","version":"1.0.0","name":"WaveSpeed Image Edit","author":"WaveSpeed / 影策","documentation":"# WaveSpeed Image Edit",
		"permissions":["generation.run","media.read"],
		"configuration":{"fields":[{"name":"apiKey","type":"secret","label":"WaveSpeed API Key","required":true}]},
		"contributes":{"providers":[{
			"id":"test-wavespeed-image-edit","label":"WaveSpeed Image Edit","capabilities":["image"],
			"scopes":["admin.system-channel","user.custom-channel","canvas","creation","agent"],
			"baseUrl":"https://api.wavespeed.ai/api/v3","requiresPublicMediaUrls":true,
			"auth":{"type":"bearer","field":"apiKey"},
			"parameters":[
				{"name":"model","type":"string","required":true,"mapping":"model","description":"WaveSpeed 图片编辑模型端点 ID。"},
				{"name":"prompt","type":"string","required":true,"mapping":"prompt","description":"编辑提示词。"}
			],
			"create":{"method":"POST","path":"/{{model}}","contentType":"application/json","body":{
				"prompt":{"$ref":"request.prompt"}
			}},
			"poll":{"method":"GET","path":"/predictions/{{taskId}}/result"},
			"response":{
				"taskId":{"$coalesce":[{"$ref":"response.data.id"},{"$ref":"response.id"}]},
				"status":{"$coalesce":[{"$ref":"response.data.status"},{"$ref":"response.status"},"pending"]},
				"message":{"$coalesce":[{"$ref":"response.data.error"},{"$ref":"response.data.message"},{"$ref":"response.error.message"},{"$ref":"response.message"}]},
				"images":{"$ref":"response.data.outputs"},
				"errorPaths":["error.code"],
				"resultEphemeral":true
			}
		}]}
	}`)
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := center.install(testPluginPackage(t, manifest), "wavespeed-image-edit.yingce-plugin"); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/v1/openai/gpt-image-2.5-sunburst/edit"):
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":200,"data":{"id":"task-ws-fail"}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/predictions/task-ws-fail/result":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"code":200,"data":{"id":"task-ws-fail","status":"failed","error":"content policy violation"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	config := providerConfig{BaseURL: server.URL, APIKey: "ws-key", Model: "openai/gpt-image-2.5-sunburst/edit", APIFormat: "openai", InterfaceType: "test-wavespeed-image-edit"}
	ctx := context.Background()
	ctx = withProtocolRegistry(ctx, center.registrySnapshot())

	_, err = runDeclarativeProtocolTask(ctx, canvasGenerationInput{
		Mode:   "image",
		Prompt: "edit",
		Config: config,
	})
	if err == nil {
		t.Fatal("expected error on failed poll, got nil")
	}
	if !strings.Contains(err.Error(), "content policy violation") {
		t.Fatalf("error = %v, want content policy violation", err)
	}
}
