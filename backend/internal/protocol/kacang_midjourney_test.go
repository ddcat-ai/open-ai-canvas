package protocol

import (
	"context"
	"testing"
)

func kacangAdapter(t *testing.T, provider string) Adapter {
	t.Helper()
	return officialPackageAdapter(t, "kacang-midjourney.yingce-plugin", provider)
}

func TestKacangMidjourneyRouteDefaultsAndReferenceOrder(t *testing.T) {
	for _, tc := range []struct{ provider, model, path, ratio string }{
		{"kacang-midjourney-special", "Midjourney v8.2-特惠", "/v1/images/generations", "16:9"},
		{"kacang-midjourney-v7", "Midjourney v7-特惠", "/v1/images/generations", "16:9"},
		{"kacang-midjourney", "mj-v8.2", "/v1/midjourney/generations", "9:16"},
		{"kacang-midjourney", "Midjourney v8.2 高速", "/v1/midjourney/generations", "9:16"},
	} {
		request := GenerationRequest{Model: tc.model, Prompt: "生成一张氛围感美女照片", Quality: "1k", Resolution: "4k"}
		adapter := kacangAdapter(t, tc.provider)
		spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		body := manifestTestBody(t, spec)
		if spec.Path != tc.path || body["size"] != tc.ratio || body["n"] != float64(1) || body["prompt"] != request.Prompt {
			t.Fatalf("%s request = %#v", tc.model, body)
		}
		for _, key := range []string{"images", "resolution", "response_format", "async", "background", "output_format"} {
			if _, exists := body[key]; exists {
				t.Fatalf("unsupported %s emitted: %#v", key, body)
			}
		}
		if tc.model == "mj-v8.2" {
			if body["quality"] != float64(1) || body["stylize"] != float64(100) || body["chaos"] != float64(0) || body["raw"] != false || body["hd"] != false {
				t.Fatalf("stable defaults = %#v", body)
			}
		} else if _, exists := body["quality"]; exists {
			t.Fatalf("unsupported quality emitted: %#v", body)
		}
		if tc.provider != "kacang-midjourney" {
			continue
		}
		request.Images = []MediaReference{{URL: "https://example.com/b.png", Order: 2}, {URL: "https://example.com/a.png", Order: 1}}
		spec, err = adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		urls := manifestTestBody(t, spec)["images"].([]any)
		if len(urls) != 2 || urls[0] != "https://example.com/a.png" {
			t.Fatalf("ordered references = %#v", urls)
		}
		poll, err := adapter.BuildPoll(context.Background(), PollContext{Request: request, TaskID: "task-42"})
		if err != nil || poll.Path != "/v1/tasks/task-42" {
			t.Fatalf("poll = %#v, error=%v", poll, err)
		}
	}
}

func TestKacangMidjourneyRejectsWrongRouteAndUnsupportedInputs(t *testing.T) {
	for _, tc := range []struct {
		name, provider string
		request        GenerationRequest
	}{
		{"wrong supplier", "kacang-midjourney", GenerationRequest{Model: "midjourney-1k", Prompt: "portrait"}},
		{"wrong class", "kacang-midjourney-special", GenerationRequest{Model: "mj-v8.2", Prompt: "portrait"}},
		{"blank prompt", "kacang-midjourney", GenerationRequest{Model: "mj-v8.2", Prompt: " "}},
		{"multiple submits", "kacang-midjourney", GenerationRequest{Model: "mj-v8.2", Prompt: "portrait", ImageCount: 4}},
		{"special auto", "kacang-midjourney-special", GenerationRequest{Model: "Midjourney v8.2-特惠", Prompt: "portrait", AspectRatio: "auto"}},
		{"pixel size", "kacang-midjourney", GenerationRequest{Model: "mj-v8.2", Prompt: "portrait", AspectRatio: "1024x1024"}},
		{"two special references", "kacang-midjourney-special", GenerationRequest{Model: "Midjourney v8.2-特惠", Prompt: "portrait", Images: []MediaReference{{URL: "https://example.com/a.png"}, {URL: "https://example.com/b.png"}}}},
		{"mask", "kacang-midjourney", GenerationRequest{Model: "mj-v8.2", Prompt: "portrait", Images: []MediaReference{{URL: "https://example.com/mask.png", Role: "mask"}}}},
		{"numeric quality range", "kacang-midjourney", GenerationRequest{Model: "mj-v8.2", Prompt: "portrait", ProviderOptions: map[string]map[string]any{"kacang-midjourney": {"quality": 3}}}},
		{"stylize range", "kacang-midjourney", GenerationRequest{Model: "mj-v8.2", Prompt: "portrait", ProviderOptions: map[string]map[string]any{"kacang-midjourney": {"stylize": 1001}}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := kacangAdapter(t, tc.provider).BuildCreate(context.Background(), RequestContext{Request: tc.request}); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
}

func TestKacangMidjourneyPendingFailureAndAllPictures(t *testing.T) {
	adapter := kacangAdapter(t, "kacang-midjourney")
	pending, err := adapter.ParseCreate(context.Background(), []byte(`{"data":{"task_id":"task-42","status":"submitted"}}`))
	if err != nil || pending.TaskID != "task-42" || pending.Status != StatusPending || pending.Result != nil {
		t.Fatalf("accepted task = %#v, %v", pending, err)
	}
	for _, payload := range []string{
		`{"data":{"status":"completed","result":{"data":{"image_urls":["https://example.com/1.png","https://example.com/2.png","https://example.com/3.png","https://example.com/4.png"],"grid_image_url":"https://example.com/grid.png"}}}}`,
		`{"status":"completed","result":{"data":{"image_urls":["https://example.com/1.png","https://example.com/2.png","https://example.com/3.png","https://example.com/4.png","https://example.com/grid.png"],"grid_image_url":"https://example.com/grid.png"}}}`,
	} {
		result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task-42"}, []byte(payload))
		if err != nil || result.TaskID != "task-42" || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 5 {
			t.Fatalf("all images = %#v, %v", result, err)
		}
		for _, image := range result.Result.Images {
			if !image.Ephemeral {
				t.Fatal("temporary result was not marked for persistence")
			}
		}
	}
	failure, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task-42"}, []byte(`{"data":{"status":"failed","error_code":"task_failed","error_message":"upstream failed"}}`))
	if err != nil || failure.Status != StatusFailed || failure.Message != "upstream failed" {
		t.Fatalf("failure = %#v, %v", failure, err)
	}
	empty, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task-42"}, []byte(`{"data":{"status":"completed","result":{"data":{}}}}`))
	if err != nil || empty.Result != nil {
		t.Fatalf("empty output = %#v, %v", empty, err)
	}
	special, err := kacangAdapter(t, "kacang-midjourney-special").ParseCreate(context.Background(), []byte(`{"data":[{"url":"https://example.com/1.png"}]}`))
	if err != nil || special.Status != StatusSucceeded || special.Result == nil || len(special.Result.Images) != 1 {
		t.Fatalf("special = %#v, %v", special, err)
	}
}
