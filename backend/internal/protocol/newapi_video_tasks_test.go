package protocol

import (
	"context"
	"testing"
)

func TestNewAPIVideoTasksCreateAndPollPaths(t *testing.T) {
	request := GenerationRequest{
		Model: "minimax-h3-2K", Prompt: "双桥村雨巷", Duration: 10, AspectRatio: "9:16", Resolution: "768P",
		Images: []MediaReference{{URL: "https://cdn.example/ref.png", Order: 1}},
	}

	t.Run("official plugin", func(t *testing.T) {
		adapter := officialPackageAdapter(t, "newapi-video-tasks-v1.yingce-plugin", "newapi-video-tasks")
		create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		if create.Method != "POST" || create.Path != "/v1/video/generations" || create.ContentType != "application/json" {
			t.Fatalf("create = %#v", create)
		}
		body := manifestTestBody(t, create)
		if body["model"] != request.Model || body["prompt"] != request.Prompt || body["seconds"] != "10" || body["aspect_ratio"] != "9:16" || body["resolution"] != "768P" {
			t.Fatalf("create body = %#v", body)
		}
		images, _ := body["image_urls"].([]any)
		if len(images) != 1 || images[0] != request.Images[0].URL {
			t.Fatalf("image_urls = %#v", images)
		}

		created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"0d781e26038ab144","status":"queued"}`))
		if err != nil || created.TaskID != "0d781e26038ab144" || created.Status != StatusPending {
			t.Fatalf("created = %#v err=%v", created, err)
		}
		poll, err := adapter.BuildPoll(context.Background(), PollContext{Request: request, TaskID: created.TaskID})
		if err != nil || poll.Method != "GET" || poll.Path != "/v1/video/tasks/0d781e26038ab144" {
			t.Fatalf("poll = %#v err=%v", poll, err)
		}
	})

	t.Run("builtin host adapter", func(t *testing.T) {
		adapter, ok := Builtins().Get("newapi-video-tasks")
		if !ok {
			t.Fatal("builtin newapi-video-tasks missing")
		}
		create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		if create.Method != "POST" || create.Path != "/v1/video/generations" {
			t.Fatalf("builtin create = %#v", create)
		}
		poll, err := adapter.BuildPoll(context.Background(), PollContext{Model: request.Model, TaskID: "0d781e26038ab144"})
		if err != nil || poll.Method != "GET" || poll.Path != "/v1/video/tasks/0d781e26038ab144" {
			t.Fatalf("builtin poll = %#v err=%v", poll, err)
		}
		channel2, ok := Builtins().Get("newapi-channel-2")
		if !ok {
			t.Fatal("builtin newapi-channel-2 missing")
		}
		legacyPoll, err := channel2.BuildPoll(context.Background(), PollContext{TaskID: "0d781e26038ab144"})
		if err != nil || legacyPoll.Path != "/v1/video/generations/0d781e26038ab144" {
			t.Fatalf("channel-2 poll changed = %#v err=%v", legacyPoll, err)
		}
	})
}

func TestNewAPIVideoTasksParsesGatewayPollPayloads(t *testing.T) {
	adapter := officialPackageAdapter(t, "newapi-video-tasks-v1.yingce-plugin", "newapi-video-tasks")
	builtin, ok := Builtins().Get("newapi-video-tasks")
	if !ok {
		t.Fatal("builtin newapi-video-tasks missing")
	}
	tests := []struct {
		name    string
		payload string
		wantURL string
	}{
		{name: "succeeded data.0.url", payload: `{"id":"0d781e26038ab144","status":"succeeded","data":[{"url":"https://cdn.example/succeeded.mp4"}]}`, wantURL: "https://cdn.example/succeeded.mp4"},
		{name: "completed data.0.url", payload: `{"id":"0d781e26038ab144","status":"completed","data":[{"url":"https://cdn.example/completed.mp4"}]}`, wantURL: "https://cdn.example/completed.mp4"},
		{name: "SUCCESS data.0.url", payload: `{"id":"0d781e26038ab144","status":"SUCCESS","data":[{"url":"https://cdn.example/success.mp4"}]}`, wantURL: "https://cdn.example/success.mp4"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			for _, item := range []struct {
				name    string
				adapter Adapter
			}{{"official", adapter}, {"builtin", builtin}} {
				t.Run(item.name, func(t *testing.T) {
					state, err := item.adapter.ParsePoll(context.Background(), PollContext{TaskID: "0d781e26038ab144"}, []byte(test.payload))
					if err != nil {
						t.Fatal(err)
					}
					if state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 || state.Result.Videos[0].URL != test.wantURL {
						t.Fatalf("state = %#v, want succeeded %s", state, test.wantURL)
					}
				})
			}
		})
	}
}
