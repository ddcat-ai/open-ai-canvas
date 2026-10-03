package protocol

import (
	"context"
	"testing"
)

func TestGwayVideoUsesDocumentedCreateAndPollContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "gway-api.yingce-plugin", "gway-video")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "seedance-2.5-101010",
		Prompt:      "一只猫在月球上行走",
		Duration:    5,
		AspectRatio: "1:1",
		Resolution:  "720p",
		Images:      []MediaReference{{URL: "https://cdn.example/start.png", Role: "first_frame", Order: 1}},
		Videos:      []MediaReference{{URL: "https://cdn.example/ref.mp4", Order: 2}},
		Audios:      []MediaReference{{URL: "https://cdn.example/ref.mp3", Order: 3}},
		ProviderOptions: map[string]map[string]any{
			"gway-video": {
				"materials": []any{map[string]any{"type": "image", "url": "https://cdn.example/material.png"}},
				"face":      map[string]any{"enabled": true, "mode": "light"},
			},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/video/generations" || create.ContentType != "application/json" {
		t.Fatalf("create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if body["model"] != "seedance-2.5-101010" || body["prompt"] != "一只猫在月球上行走" || body["duration"] != float64(5) || body["ratio"] != "1:1" || body["resolution"] != "720p" {
		t.Fatalf("body = %#v", body)
	}
	if got := body["images"].([]any); len(got) != 1 {
		t.Fatalf("images = %#v", body["images"])
	} else if image := got[0].(map[string]any); image["url"] != "https://cdn.example/start.png" || image["type"] != "first_frame" {
		t.Fatalf("images = %#v", body["images"])
	}
	if got := body["videos"].([]any); len(got) != 1 || got[0] != "https://cdn.example/ref.mp4" {
		t.Fatalf("videos = %#v", body["videos"])
	}
	if got := body["audios"].([]any); len(got) != 1 || got[0] != "https://cdn.example/ref.mp3" {
		t.Fatalf("audios = %#v", body["audios"])
	}
	if _, ok := body["materials"]; !ok {
		t.Fatalf("materials missing from body: %#v", body)
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task_gway_1","status":"queued"}`))
	if err != nil || created.TaskID != "task_gway_1" || created.Status != StatusPending {
		t.Fatalf("created = %#v err=%v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Method != "GET" || poll.Path != "/v1/videos/tasks/task_gway_1" {
		t.Fatalf("poll = %#v err=%v", poll, err)
	}
	result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"id":"task_gway_1","object":"video","status":"completed","progress":100,"result_urls":["https://cdn.example/result.mp4"]}`))
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Videos) != 1 || result.Result.Videos[0].URL != "https://cdn.example/result.mp4" || !result.Result.Videos[0].Ephemeral {
		t.Fatalf("result = %#v err=%v", result, err)
	}
}

func TestGwayImageUsesAsyncImageContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "gway-api.yingce-plugin", "gway-image")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "gpt-image-2.5-1k",
		Prompt:      "雾中的山路",
		AspectRatio: "16:9",
		Resolution:  "1K",
		ImageCount:  2,
		Images:      []MediaReference{{URL: "https://cdn.example/ref.png"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Path != "/v1/images/create" || create.Method != "POST" {
		t.Fatalf("create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if body["model"] != "gpt-image-2.5-1k" || body["prompt"] != "雾中的山路" || body["ratio"] != "16:9" || body["resolution"] != "1K" || body["n"] != float64(2) {
		t.Fatalf("body = %#v", body)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "image-task-1"})
	if err != nil || poll.Path != "/v1/images/tasks/image-task-1" {
		t.Fatalf("poll = %#v err=%v", poll, err)
	}
	result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "image-task-1"}, []byte(`{"id":"image-task-1","object":"image","status":"completed","result_urls":["https://cdn.example/result.png"]}`))
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 1 || result.Result.Images[0].URL != "https://cdn.example/result.png" || !result.Result.Images[0].Ephemeral {
		t.Fatalf("result = %#v err=%v", result, err)
	}
}

func TestGwayImageSyncUsesOpenAIImageContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "gway-api.yingce-plugin", "gway-image-sync")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "your-image-model",
		Prompt:      "红色立方体",
		ImageCount:  1,
		AspectRatio: "1024x1024",
		Quality:     "high",
		ProviderOptions: map[string]map[string]any{
			"gway-image-sync": {"response_format": "url"},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Path != "/v1/images/generations" || create.Method != "POST" {
		t.Fatalf("create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if body["model"] != "your-image-model" || body["prompt"] != "红色立方体" || body["n"] != float64(1) || body["size"] != "1024x1024" || body["quality"] != "high" || body["response_format"] != "url" {
		t.Fatalf("body = %#v", body)
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"created":1710000000,"data":[{"url":"https://cdn.example/generated.png"}]}`))
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 1 || result.Result.Images[0].URL != "https://cdn.example/generated.png" || !result.Result.Images[0].Ephemeral {
		t.Fatalf("result = %#v err=%v", result, err)
	}
}

func TestGwayChatUsesOpenAICompatibleContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "gway-api.yingce-plugin", "gway-chat")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:    "gpt-5.6-luna",
		Messages: []Message{{Role: "user", Content: "你好"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Path != "/v1/chat/completions" || create.Method != "POST" {
		t.Fatalf("create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if body["model"] != "gpt-5.6-luna" {
		t.Fatalf("body = %#v", body)
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"choices":[{"message":{"role":"assistant","content":"你好！"}}]}`))
	if err != nil || result.Status != StatusSucceeded || result.Result == nil || result.Result.Text != "你好！" {
		t.Fatalf("result = %#v err=%v", result, err)
	}
}
