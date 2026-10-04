package protocol

import (
	"context"
	"strings"
	"testing"
)

func cangyuanAdapter(t *testing.T, provider string) Adapter {
	t.Helper()
	return officialPackageAdapter(t, "cangyuan-midjourney.yingce-plugin", provider)
}

func TestCangyuanMidjourneyV7RequestAndEditPolling(t *testing.T) {
	adapter := cangyuanAdapter(t, "cangyuan-midjourney-v7")
	request := GenerationRequest{Model: "midjourney-v7", Prompt: "生成一张氛围感美女照片", ImageCount: 1, AspectRatio: "auto", Quality: "high", Resolution: "2k", Extra: map[string]any{"transparentBackground": "true"}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/images/generations" || body["n"] != float64(1) || body["response_format"] != "url" || body["async"] != false {
		t.Fatalf("create = %#v, body = %#v", spec, body)
	}
	for _, key := range []string{"size", "images", "quality", "resolution", "background", "speed", "output_format", "mask"} {
		if _, ok := body[key]; ok {
			t.Fatalf("unsupported field %s was emitted: %#v", key, body)
		}
	}
	request.Images = []MediaReference{{URL: "https://example.com/second.png", Role: "edit_source", Order: 2}, {URL: "https://example.com/first.png", Role: "edit_source", Order: 1}}
	request.AspectRatio = "9:16"
	spec, err = adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body = manifestTestBody(t, spec)
	images := body["images"].([]any)
	if spec.Path != "/v1/images/edits" || body["size"] != "9:16" || len(images) != 2 || images[0] != "https://example.com/first.png" {
		t.Fatalf("edit = %#v, body = %#v", spec, body)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{Request: request, TaskID: "task-42"})
	if err != nil || poll.Path != "/v1/images/edits/task-42" {
		t.Fatalf("edit poll = %#v, err = %v", poll, err)
	}
}

func TestCangyuanMidjourneyV82VersionsReferencesAndMask(t *testing.T) {
	adapter := cangyuanAdapter(t, "cangyuan-midjourney-v82")
	for _, model := range []string{"midjourney-1k", "midjourney-2k"} {
		request := GenerationRequest{Model: model, Prompt: "portrait --v 8.2", ImageCount: 1, Quality: "high"}
		spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		body := manifestTestBody(t, spec)
		if body["prompt"] != request.Prompt || body["model"] != model {
			t.Fatalf("version request = %#v", body)
		}
		for _, key := range []string{"quality", "resolution", "background", "output_format", "speed", "reference", "mask"} {
			if _, ok := body[key]; ok {
				t.Fatalf("unexpected %s in %#v", key, body)
			}
		}
	}
	request := GenerationRequest{Model: "midjourney-1k", Prompt: "portrait --v 8.2", Images: []MediaReference{{URL: "https://example.com/source.png", Role: "edit_source"}, {URL: "https://example.com/mask.png", Role: "mask"}}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Path != "/v1/images/edits" || body["reference"] != "editor" || body["mask"] != "https://example.com/mask.png" || len(body["images"].([]any)) != 1 {
		t.Fatalf("masked edit = %#v, body = %#v", spec, body)
	}
	request.Images = request.Images[:1]
	request.ProviderOptions = map[string]map[string]any{"cangyuan-midjourney-v82": {"reference": "style", "speed": "fast"}}
	spec, err = adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body = manifestTestBody(t, spec)
	if spec.Path != "/v1/images/generations" || body["reference"] != "style" || body["speed"] != "fast" {
		t.Fatalf("style = %#v, body = %#v", spec, body)
	}
}

func TestCangyuanMidjourneyRejectsInvalidInputs(t *testing.T) {
	for _, tc := range []struct {
		name, provider string
		request        GenerationRequest
	}{
		{"model mismatch", "cangyuan-midjourney-v7", GenerationRequest{Model: "midjourney-1k", Prompt: "portrait"}},
		{"invented v82 model", "cangyuan-midjourney-v82", GenerationRequest{Model: "midjourney-v8.2", Prompt: "portrait"}},
		{"multiple submissions", "cangyuan-midjourney-v7", GenerationRequest{Model: "midjourney-v7", Prompt: "portrait", ImageCount: 2}},
		{"long unicode prompt", "cangyuan-midjourney-v7", GenerationRequest{Model: "midjourney-v7", Prompt: strings.Repeat("画", 4001)}},
		{"data URI", "cangyuan-midjourney-v7", GenerationRequest{Model: "midjourney-v7", Prompt: "portrait", Images: []MediaReference{{DataURL: "data:image/png;base64,aA=="}}}},
		{"v7 mask", "cangyuan-midjourney-v7", GenerationRequest{Model: "midjourney-v7", Prompt: "portrait", Images: []MediaReference{{URL: "https://example.com/mask.png", Role: "mask"}}}},
		{"editor missing source", "cangyuan-midjourney-v82", GenerationRequest{Model: "midjourney-1k", Prompt: "portrait", Images: []MediaReference{{URL: "https://example.com/mask.png", Role: "mask"}}}},
		{"invalid speed", "cangyuan-midjourney-v82", GenerationRequest{Model: "midjourney-1k", Prompt: "portrait", ProviderOptions: map[string]map[string]any{"cangyuan-midjourney-v82": {"speed": "turbo"}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := cangyuanAdapter(t, tc.provider).BuildCreate(context.Background(), RequestContext{Request: tc.request}); err == nil {
				t.Fatal("invalid input was accepted")
			}
		})
	}
}

func TestCangyuanMidjourneyPreservesAllResultsAndTaskStates(t *testing.T) {
	for _, provider := range []string{"cangyuan-midjourney-v7", "cangyuan-midjourney-v82"} {
		adapter := cangyuanAdapter(t, provider)
		for _, payload := range []string{`{"data":[{"url":"https://example.com/1.png"},{"url":"https://example.com/2.png"},{"url":"https://example.com/3.png"},{"url":"https://example.com/4.png"}]}`, `{"id":"task-42","status":"completed","data":[{"url":"https://example.com/1.png"},{"url":"https://example.com/2.png"},{"url":"https://example.com/3.png"},{"url":"https://example.com/4.png"}]}`} {
			result, err := adapter.ParseCreate(context.Background(), []byte(payload))
			if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 4 {
				t.Fatalf("%s result = %#v, err = %v", provider, result, err)
			}
		}
		pending, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task-42","status":"queued"}`))
		if err != nil || pending.TaskID != "task-42" || pending.Status != StatusPending {
			t.Fatalf("pending = %#v, err = %v", pending, err)
		}
		failed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task-42"}, []byte(`{"status":"failed","error":{"code":"invalid_prompt","message":"prompt rejected"}}`))
		if err != nil || failed.TaskID != "task-42" || failed.Status != StatusFailed || failed.Message != "prompt rejected" {
			t.Fatalf("failure = %#v, err = %v", failed, err)
		}
	}
}
