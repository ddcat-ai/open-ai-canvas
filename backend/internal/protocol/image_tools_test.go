package protocol

import (
	"context"
	"testing"
)

func TestImageToolsProvidersBuildAsyncImageRequests(t *testing.T) {
	cases := []struct {
		name     string
		provider string
		model    string
		path     string
	}{
		{name: "remove background", provider: "image-tools-remove-background", model: "bria/remove-background", path: "/bria/remove-background"},
		{name: "layer decomposition", provider: "image-tools-layer-decomposition", model: "bytedance/seedream-v5.0-pro/layer-decomposition", path: "/bytedance/seedream-v5.0-pro/layer-decomposition"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			adapter := officialPackageAdapter(t, "image-tools.yingce-plugin", tc.provider)
			if !adapter.Metadata().RequiresPublicMediaURLs {
				t.Fatal("image tools must receive hydrated public image URLs")
			}
			created, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Model: tc.model,
				Prompt: "preserve the source image while applying the requested image operation",
				Images: []MediaReference{{URL: "https://cdn.example/source.png", Role: "edit_source", Order: 0}},
			}})
			if err != nil {
				t.Fatal(err)
			}
			if created.Method != "POST" || created.Path != tc.path || created.ContentType != "application/json" {
				t.Fatalf("create request = %#v", created)
			}
			body := manifestTestBody(t, created)
			if body["image"] != "https://cdn.example/source.png" {
				t.Fatalf("source image mapping = %#v", body["image"])
			}
			result, err := adapter.ParseCreate(context.Background(), []byte(`{"data":{"id":"task-image-tool-1","status":"processing"}}`))
			if err != nil || result.TaskID != "task-image-tool-1" || result.Status != StatusProcessing {
				t.Fatalf("create result = %#v, err = %v", result, err)
			}
			poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: result.TaskID})
			if err != nil || poll.Method != "GET" || poll.Path != "/predictions/task-image-tool-1/result" {
				t.Fatalf("poll request = %#v, err = %v", poll, err)
			}
			completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: result.TaskID}, []byte(`{"data":{"id":"task-image-tool-1","status":"completed","outputs":["https://cdn.example/output.png"]}}`))
			if err != nil || completed.Status != StatusSucceeded || completed.Result == nil || len(completed.Result.Images) != 1 || completed.Result.Images[0].URL != "https://cdn.example/output.png" {
				t.Fatalf("poll result = %#v, err = %v", completed, err)
			}
		})
	}
}
