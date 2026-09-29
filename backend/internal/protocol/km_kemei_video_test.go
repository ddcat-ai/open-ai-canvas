package protocol

import (
	"context"
	"testing"
)

func TestKemeiVideoCreatePollAndCancel(t *testing.T) {
	adapter := officialPackageAdapter(t, "km-kemei-video.yingce-plugin", "km-kemei-video")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "kling-v3-omni", Prompt: "推开欧式古典大门，展现奇幻云海城堡", Duration: 5,
		AspectRatio: "16:9", Resolution: "1080p", GenerateAudio: true, Watermark: false,
		Images: []MediaReference{{URL: "https://cdn.example/first.png", Role: "first_frame", Order: 1}, {URL: "https://cdn.example/last.png", Role: "last_frame", Order: 2}},
		Videos: []MediaReference{{URL: "https://cdn.example/ref.mp4", Role: "reference_video", Order: 1}},
		ProviderOptions: map[string]map[string]any{"km-kemei-video": {
			"negative_prompt": "模糊, 水印", "files": []any{"https://cdn.example/spec.pdf"}, "links": []any{"https://example.com/reference"},
			"ratio": "adaptive", "web_search": true, "seed": 42,
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/video/generations" || create.Auth.Type != "bearer" {
		t.Fatalf("create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if body["model"] != "kling-v3-omni" || body["prompt"] != "推开欧式古典大门，展现奇幻云海城堡" || body["ratio"] != "adaptive" || body["seed"] != float64(42) {
		t.Fatalf("body = %#v", body)
	}
	images, _ := body["images"].([]any)
	if len(images) != 2 || images[0].(map[string]any)["role"] != "first_frame" || images[1].(map[string]any)["role"] != "last_frame" {
		t.Fatalf("images = %#v", images)
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"video_task_abc123xyz789","status":"pending"}`))
	if err != nil || created.TaskID != "video_task_abc123xyz789" || created.Status != StatusPending {
		t.Fatalf("created = %#v err=%v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Path != "/v1/video/generations/video_task_abc123xyz789" {
		t.Fatalf("poll = %#v err=%v", poll, err)
	}
	succeeded, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"task_id":"video_task_abc123xyz789","status":"completed","data":[{"url":"https://example.com/output/generated_video.mp4"}]}`))
	if err != nil || succeeded.Status != StatusSucceeded || len(succeeded.Result.Videos) != 1 || succeeded.Result.Videos[0].URL != "https://example.com/output/generated_video.mp4" || !succeeded.Result.Videos[0].Ephemeral {
		t.Fatalf("succeeded = %#v err=%v", succeeded, err)
	}
	cancel, err := adapter.BuildCancel(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || cancel.Method != "DELETE" || cancel.Path != "/v1/video/generations/video_task_abc123xyz789" {
		t.Fatalf("cancel = %#v err=%v", cancel, err)
	}
}
