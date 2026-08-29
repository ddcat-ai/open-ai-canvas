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
	if len(adapters) == 0 {
		t.Fatalf("loaded adapters = %d", len(adapters))
	}
	var adapter Adapter
	for _, a := range adapters {
		if a.Metadata().ID == "autodl-comfyui" {
			adapter = a
			break
		}
	}
	if adapter == nil {
		t.Fatal("autodl-comfyui provider adapter not found")
	}
	if adapter.Metadata().ID != "autodl-comfyui" || adapter.Metadata().Execution != "declarative" {
		t.Fatalf("metadata = %#v", adapter.Metadata())
	}
	if !adapter.Metadata().RequiresPublicMediaURLs {
		t.Fatal("AutoDL provider must request public reference media URLs")
	}

	create, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Model: "minimax_h3_lightx2v_no_pic", Prompt: "a cinematic test", Duration: 3, Resolution: "768P竖", Images: []MediaReference{{URL: "https://cdn.example/reference.png"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_no_pic" || create.ContentType != "application/json" {
		t.Fatalf("create spec = %#v", create)
	}
	body, ok := create.Body.(map[string]any)
	if !ok || body["prompt"] != "a cinematic test" || body["duration"] != 3 || body["resolution"] != "768p竖" {
		t.Fatalf("create body = %#v", create.Body)
	}
	if _, exists := body["ref_image_0"]; exists {
		t.Fatalf("no_pic workflow must not send ref_image_0: %#v", body)
	}
	if _, exists := body["first_frame"]; exists {
		t.Fatalf("no_pic workflow must not send first_frame: %#v", body)
	}

	createV5, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Model: "minimax_h3_lightx2v_v5_15s", Prompt: "a cinematic test", Duration: 15, Resolution: "768p竖", Images: []MediaReference{{URL: "https://cdn.example/ref0.png"}, {URL: "https://cdn.example/ref1.png"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	bodyV5 := createV5.Body.(map[string]any)
	if bodyV5["ref_image_0"] != "https://cdn.example/ref0.png" || bodyV5["ref_image_1"] != "https://cdn.example/ref1.png" {
		t.Fatalf("v5 create body missing ref images = %#v", bodyV5)
	}
	if _, exists := bodyV5["first_frame"]; exists {
		t.Fatalf("v5 workflow must not send first_frame: %#v", bodyV5)
	}

	createLightX2V, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Model: "minimax_h3_lightx2v", Prompt: "a cinematic test", Duration: 5, Resolution: "768p竖", Images: []MediaReference{{URL: "https://cdn.example/first.png"}, {URL: "https://cdn.example/last.png"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	bodyLightX2V := createLightX2V.Body.(map[string]any)
	if bodyLightX2V["first_frame"] != "https://cdn.example/first.png" || bodyLightX2V["last_frame"] != "https://cdn.example/last.png" {
		t.Fatalf("lightx2v body = %#v", bodyLightX2V)
	}
	if _, exists := bodyLightX2V["ref_image_0"]; exists {
		t.Fatalf("lightx2v must not send ref_image_0: %#v", bodyLightX2V)
	}

	createImageAudio, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Model: "minimax_h3_image_audio_to_video", Prompt: "should be omitted", Duration: 5, Resolution: "768p横",
		Images: []MediaReference{{URL: "https://cdn.example/face.png"}},
		Audios: []MediaReference{{URL: "https://cdn.example/voice.mp3"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	bodyImageAudio := createImageAudio.Body.(map[string]any)
	if bodyImageAudio["ref_image_0"] != "https://cdn.example/face.png" || bodyImageAudio["ref_audio_0"] != "https://cdn.example/voice.mp3" || bodyImageAudio["audio_duration"] != 5 || bodyImageAudio["resolution"] != "768p横" {
		t.Fatalf("image_audio body = %#v", bodyImageAudio)
	}
	if _, exists := bodyImageAudio["prompt"]; exists {
		t.Fatalf("image_audio workflow must not send prompt: %#v", bodyImageAudio)
	}
	if _, exists := bodyImageAudio["duration"]; exists {
		t.Fatalf("image_audio workflow must not send duration: %#v", bodyImageAudio)
	}
	if _, exists := bodyImageAudio["ref_image_1"]; exists {
		t.Fatalf("image_audio workflow must not send ref_image_1: %#v", bodyImageAudio)
	}
	if _, exists := bodyImageAudio["ref_audio_1"]; exists {
		t.Fatalf("image_audio workflow must not send ref_audio_1: %#v", bodyImageAudio)
	}

	createAudioToVideoV2, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Model: "minimax_h3_image_audio_to_video_v2", Prompt: "cinematic sync", Duration: 8, Resolution: "1080p横",
		Images: []MediaReference{{URL: "https://cdn.example/img0.png"}, {URL: "https://cdn.example/img1.png"}},
		Audios: []MediaReference{{URL: "https://cdn.example/aud0.mp3"}, {URL: "https://cdn.example/aud1.mp3"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	bodyV2 := createAudioToVideoV2.Body.(map[string]any)
	if bodyV2["prompt"] != "cinematic sync" || bodyV2["duration"] != 8 || bodyV2["resolution"] != "1080p横" ||
		bodyV2["ref_image_0"] != "https://cdn.example/img0.png" || bodyV2["ref_image_1"] != "https://cdn.example/img1.png" ||
		bodyV2["ref_audio_0"] != "https://cdn.example/aud0.mp3" || bodyV2["ref_audio_1"] != "https://cdn.example/aud1.mp3" {
		t.Fatalf("v2 body = %#v", bodyV2)
	}
	if _, exists := bodyV2["audio_duration"]; exists {
		t.Fatalf("v2 must not send audio_duration: %#v", bodyV2)
	}

	createB99001, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Model: "minimax_h3_b99_001", Prompt: "a prompt test", Duration: 5, Resolution: "736p竖",
		Images: []MediaReference{{URL: "https://cdn.example/should-be-omitted.png"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	bodyB99001 := createB99001.Body.(map[string]any)
	if bodyB99001["prompt"] != "a prompt test" || bodyB99001["duration"] != 5 || bodyB99001["resolution"] != "736p竖" {
		t.Fatalf("b99_001 body = %#v", bodyB99001)
	}
	if _, exists := bodyB99001["ref_image_0"]; exists {
		t.Fatalf("b99_001 must not send ref_image_0: %#v", bodyB99001)
	}
	if _, exists := bodyB99001["first_frame"]; exists {
		t.Fatalf("b99_001 must not send first_frame: %#v", bodyB99001)
	}

	createB99002, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Model: "minimax_h3_b99_002", Prompt: "first to last", Duration: 6, Resolution: "736p横",
		Images: []MediaReference{{URL: "https://cdn.example/f0.png"}, {URL: "https://cdn.example/f1.png"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	bodyB99002 := createB99002.Body.(map[string]any)
	if bodyB99002["prompt"] != "first to last" || bodyB99002["duration"] != 6 || bodyB99002["resolution"] != "736p横" ||
		bodyB99002["first_frame"] != "https://cdn.example/f0.png" || bodyB99002["last_frame"] != "https://cdn.example/f1.png" {
		t.Fatalf("b99_002 body = %#v", bodyB99002)
	}
	if _, exists := bodyB99002["ref_image_0"]; exists {
		t.Fatalf("b99_002 must not send ref_image_0: %#v", bodyB99002)
	}

	createB99003, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Model: "minimax_h3_b99_003_12s", Prompt: "multi image 12s", Duration: 12, Resolution: "736p(1:1)",
		Images: []MediaReference{{URL: "https://cdn.example/img0.png"}, {URL: "https://cdn.example/img1.png"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	bodyB99003 := createB99003.Body.(map[string]any)
	if bodyB99003["prompt"] != "multi image 12s" || bodyB99003["duration"] != 12 || bodyB99003["resolution"] != "736p(1:1)" ||
		bodyB99003["ref_image_0"] != "https://cdn.example/img0.png" || bodyB99003["ref_image_1"] != "https://cdn.example/img1.png" {
		t.Fatalf("b99_003 body = %#v", bodyB99003)
	}
	if _, exists := bodyB99003["first_frame"]; exists {
		t.Fatalf("b99_003 must not send first_frame: %#v", bodyB99003)
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
