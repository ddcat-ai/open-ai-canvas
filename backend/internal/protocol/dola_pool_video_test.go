package protocol

import (
	"context"
	"testing"
)

func TestOfficialDolaPoolVideoProfile(t *testing.T) {
	adapter := officialPackageAdapter(t, "dola-pool.yingce-plugin", "dola-pool")
	request := GenerationRequest{
		Capability:  CapabilityVideo,
		Model:       "seedance-2.5",
		Prompt:      "A cat chasing butterflies in a meadow",
		Duration:    30,
		AspectRatio: "720x1280",
		Images:      []MediaReference{{URL: "https://assets.example/character.png", Kind: "image"}},
	}

	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/videos/generations" || create.ContentType != "application/json" {
		t.Fatalf("Dola-pool create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if body["model"] != request.Model || body["prompt"] != request.Prompt || body["duration"] != float64(30) {
		t.Fatalf("Dola-pool create body = %#v", body)
	}
	if body["ratio"] != request.AspectRatio || body["size"] != request.AspectRatio {
		t.Fatalf("Dola-pool frame fields = %#v", body)
	}
	images, _ := body["reference_images"].([]any)
	if len(images) != 1 || images[0] != request.Images[0].URL {
		t.Fatalf("Dola-pool reference_images = %#v", images)
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"video-task-1","status":"queued"}`))
	if err != nil {
		t.Fatal(err)
	}
	if created.TaskID != "video-task-1" || created.Status != StatusPending {
		t.Fatalf("Dola-pool create result = %#v", created)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil {
		t.Fatal(err)
	}
	if poll.Method != "GET" || poll.Path != "/v1/videos/video-task-1" {
		t.Fatalf("Dola-pool poll = %#v", poll)
	}
	state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"id":"video-task-1","status":"completed","video_url":"https://dolasd.xyz/videos/result.mp4"}`))
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 || state.Result.Videos[0].URL != "https://dolasd.xyz/videos/result.mp4" {
		t.Fatalf("Dola-pool poll result = %#v", state)
	}

	resultAdapter, ok := adapter.(ResultAdapter)
	if !ok {
		t.Fatal("Dola-pool adapter does not expose binary result download")
	}
	result, err := resultAdapter.BuildResult(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil {
		t.Fatal(err)
	}
	if result.Method != "GET" || result.Path != "/v1/videos/video-task-1/content" || result.Headers["Accept"] != "video/mp4" {
		t.Fatalf("Dola-pool result download = %#v", result)
	}
}

func TestOfficialDolaPoolRequiresExplicitDuration(t *testing.T) {
	adapter := officialPackageAdapter(t, "dola-pool.yingce-plugin", "dola-pool")
	_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:  "seedance-2.5",
		Prompt: "A cat chasing butterflies in a meadow",
	}})
	if err == nil {
		t.Fatal("Dola-pool accepted a request without an explicit duration")
	}
}
