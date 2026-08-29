package protocol

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAutoDLPluginArtifact(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "autodl-comfyui.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(adapters) != 1 {
		t.Fatalf("loaded adapters = %d", len(adapters))
	}
	adapter := adapters[0]
	if adapter.Metadata().ID != "autodl-comfyui" || adapter.Metadata().Version != "1.0.3" || adapter.Metadata().Execution != "declarative" {
		t.Fatalf("metadata = %#v", adapter.Metadata())
	}
	if !adapter.Metadata().RequiresPublicMediaURLs {
		t.Fatal("AutoDL provider must request public reference media URLs")
	}

	create, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Model: "minimax_h3_lightx2v_no_pic", Prompt: "a cinematic test", Duration: 3, Resolution: "768", Images: []MediaReference{{URL: "https://cdn.example/reference.png"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_no_pic" || create.ContentType != "application/json" {
		t.Fatalf("create spec = %#v", create)
	}
	body, ok := create.Body.(map[string]any)
	if !ok || body["prompt"] != "a cinematic test" || body["duration"] != 3 || body["resolution"] != "768p横" || body["ref_image_0"] != "https://cdn.example/reference.png" {
		t.Fatalf("create body = %#v", create.Body)
	}
	if _, exists := body["ref_image_1"]; exists {
		t.Fatalf("missing reference image was not omitted: %#v", body)
	}

	failed, err := adapter.ParseCreate(context.Background(), []byte(`{"code":"RequestParameterIsWrong","data":null,"msg":"参数: resolution 的值: 768P 不在 options 列表中"}`))
	if err != nil || failed.Status != StatusFailed || failed.Message == "" {
		t.Fatalf("failed = %#v, err = %v", failed, err)
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"code":0,"data":{"task_id":"task-auto-1","status":"QUEUED"}}`))
	if err != nil || created.TaskID != "task-auto-1" || created.Status != StatusPending {
		t.Fatalf("created = %#v, err = %v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{BaseURL: "https://autodl.art", Model: "minimax_h3_lightx2v_no_pic", TaskID: created.TaskID})
	if err != nil || poll.Method != "GET" || poll.Path != "/api/v1/comfyui/comfyui_workflow/result/task-auto-1" {
		t.Fatalf("poll spec = %#v, err = %v", poll, err)
	}
	completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"code":"Success","data":{"task_id":"task-auto-1","status":"completed","results":[{"url":"https://cdn.example/video.mp4","type":"video","file_type":"mp4"}]}}`))
	if err != nil || completed.Status != StatusSucceeded || completed.Result == nil || len(completed.Result.Videos) != 1 {
		t.Fatalf("completed = %#v, err = %v", completed, err)
	}
	video := completed.Result.Videos[0]
	if video.URL != "https://cdn.example/video.mp4" || video.Kind != "video" || !video.Ephemeral {
		t.Fatalf("video = %#v", video)
	}
	if _, err := json.Marshal(completed); err != nil {
		t.Fatal(err)
	}
}

func TestAutoDLPluginMapsCanvas720pTo768p(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "autodl-comfyui.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	create, err := adapters[0].BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Model: "minimax_h3_image_audio_to_video_v2", Prompt: "test", Duration: 4, Resolution: "720p",
	}})
	if err != nil {
		t.Fatal(err)
	}
	body, ok := create.Body.(map[string]any)
	if !ok || body["resolution"] != "768p横" {
		t.Fatalf("720p mapping = %#v", create.Body)
	}
	portrait, err := adapters[0].BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Model: "minimax_h3_image_audio_to_video_v2", Prompt: "test", Duration: 4, Resolution: "720p", AspectRatio: "9:16",
	}})
	if err != nil {
		t.Fatal(err)
	}
	portraitBody, ok := portrait.Body.(map[string]any)
	if !ok || portraitBody["resolution"] != "768p竖" {
		t.Fatalf("portrait 720p mapping = %#v", portrait.Body)
	}
}
