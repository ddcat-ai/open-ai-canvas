package protocol

import (
	"context"
	"testing"
)

func TestOfficialMuse2APIVideoProfile(t *testing.T) {
	adapter := officialPackageAdapter(t, "muse2api-video.yingce-plugin", "muse2api-video")
	request := GenerationRequest{
		Capability:  CapabilityVideo,
		Model:       "muse2-model",
		Prompt:      "一只小猫在草地上走动",
		Duration:    5,
		AspectRatio: "16:9",
	}

	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/videos" || create.ContentType != "application/json" {
		t.Fatalf("create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if len(body) != 3 || body["prompt"] != request.Prompt || body["duration"] != float64(5) || body["size"] != request.AspectRatio {
		t.Fatalf("create body = %#v", body)
	}
	if _, ok := body["model"]; ok {
		t.Fatalf("upstream request must not include model: %#v", body)
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task_xxx","status":"queued"}`))
	if err != nil || created.TaskID != "task_xxx" || created.Status != StatusPending {
		t.Fatalf("created = %#v error=%v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Method != "GET" || poll.Path != "/v1/videos/task_xxx" {
		t.Fatalf("poll = %#v error=%v", poll, err)
	}
	state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"status":"succeeded","result":{"url":"/v1/media/xxx.mp4"}}`))
	if err != nil || state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 {
		t.Fatalf("poll state = %#v error=%v", state, err)
	}
	if got := state.Result.Videos[0]; got.URL != "/v1/media/xxx.mp4" || !got.Ephemeral {
		t.Fatalf("video result = %#v", got)
	}
}
