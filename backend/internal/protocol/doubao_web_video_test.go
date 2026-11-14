package protocol

import (
	"context"
	"testing"
)

// TestOfficialDoubaoWebVideoProfile 校验内置豆包网页驱动插件包：声明式映射、
// data URL 参考图（requiresPublicMediaUrls=false）、轮询与二进制下载合同。
func TestOfficialDoubaoWebVideoProfile(t *testing.T) {
	adapter := officialPackageAdapter(t, "doubao-web.yingce-plugin", "doubao-web")
	if adapter.Metadata().RequiresPublicMediaURLs {
		t.Fatal("doubao-web must keep requiresPublicMediaUrls=false (data URL 参考图直传本机桥)")
	}
	request := GenerationRequest{
		Capability:  CapabilityVideo,
		Model:       "seedance_2.0_mini",
		Prompt:      "一只猫在草丛里追蝴蝶",
		Duration:    10,
		AspectRatio: "16:9",
		Images:      []MediaReference{{DataURL: "data:image/png;base64,aGVsbG8=", Kind: "image"}},
		Metadata:    map[string]any{"nodeId": "video-node"},
	}

	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/videos/generations" || create.ContentType != "application/json" {
		t.Fatalf("doubao-web create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if metadata, ok := body["metadata"].(map[string]any); !ok || metadata["nodeId"] != "video-node" {
		t.Fatalf("doubao-web metadata = %#v", body["metadata"])
	}
	if body["model"] != request.Model || body["prompt"] != request.Prompt || body["duration"] != float64(10) {
		t.Fatalf("doubao-web create body = %#v", body)
	}
	if body["ratio"] != request.AspectRatio || body["size"] != request.AspectRatio {
		t.Fatalf("doubao-web frame fields = %#v", body)
	}
	images, _ := body["reference_images"].([]any)
	if len(images) != 1 || images[0] != request.Images[0].DataURL {
		t.Fatalf("doubao-web reference_images = %#v", images)
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task_abc123","status":"queued"}`))
	if err != nil {
		t.Fatal(err)
	}
	if created.TaskID != "task_abc123" || created.Status != StatusPending {
		t.Fatalf("doubao-web create result = %#v", created)
	}

	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil {
		t.Fatal(err)
	}
	if poll.Method != "GET" || poll.Path != "/v1/videos/task_abc123" {
		t.Fatalf("doubao-web poll = %#v", poll)
	}
	state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"id":"task_abc123","status":"completed","video_url":"http://127.0.0.1:8787/v1/videos/task_abc123/content"}`))
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 {
		t.Fatalf("doubao-web poll result = %#v", state)
	}

	resultAdapter, ok := adapter.(ResultAdapter)
	if !ok {
		t.Fatal("doubao-web adapter does not expose binary result download")
	}
	result, err := resultAdapter.BuildResult(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil {
		t.Fatal(err)
	}
	if result.Method != "GET" || result.Path != "/v1/videos/task_abc123/content" || result.Headers["Accept"] != "video/mp4" {
		t.Fatalf("doubao-web result download = %#v", result)
	}
}

func TestOfficialDoubaoWebRequiresExplicitDuration(t *testing.T) {
	adapter := officialPackageAdapter(t, "doubao-web.yingce-plugin", "doubao-web")
	_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:  "seedance_2.0_mini",
		Prompt: "一只猫在草丛里追蝴蝶",
	}})
	if err == nil {
		t.Fatal("doubao-web accepted a request without an explicit duration")
	}
}
