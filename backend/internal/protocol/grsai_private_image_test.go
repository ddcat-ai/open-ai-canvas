package protocol

import (
	"context"
	"testing"
)

func TestGrsaiPrivateImageProfiles(t *testing.T) {
	tests := []struct {
		providerID string
		model      string
		request    GenerationRequest
		wantKey    string
		wantValue  string
	}{
		{
			providerID: "grsai-nano-banana-image",
			model:      "nano-banana-2",
			request: GenerationRequest{
				Prompt:      "生成一张边牧与古牧直播带货截图",
				Images:      []MediaReference{{URL: "https://cdn.example/reference.png", Order: 1}},
				AspectRatio: "1:1",
				Resolution:  "1K",
			},
			wantKey:   "imageSize",
			wantValue: "1K",
		},
		{
			providerID: "grsai-gpt-image",
			model:      "gpt-image-2.5",
			request: GenerationRequest{
				Prompt:      "生成一张边牧与古牧直播带货截图",
				AspectRatio: "1024x1024",
				Quality:     "auto",
			},
			wantKey:   "quality",
			wantValue: "auto",
		},
	}

	for _, tt := range tests {
		t.Run(tt.providerID, func(t *testing.T) {
			adapter := officialPackageAdapter(t, "grsai-api.yingce-plugin", tt.providerID)
			tt.request.Model = tt.model
			create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: tt.request})
			if err != nil {
				t.Fatal(err)
			}
			if create.Method != "POST" || create.Path != "/v1/api/generate" || create.ContentType != "application/json" {
				t.Fatalf("create = %#v", create)
			}
			body := manifestTestBody(t, create)
			if body["model"] != tt.model || body["prompt"] != tt.request.Prompt || body["aspectRatio"] != tt.request.AspectRatio || body[tt.wantKey] != tt.wantValue || body["replyType"] != "json" {
				t.Fatalf("body = %#v", body)
			}
			images, ok := body["images"].([]any)
			if !ok || len(images) != len(tt.request.Images) {
				t.Fatalf("images = %#v", body["images"])
			}
			poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "grsai-image-task"})
			if err != nil || poll.Path != "/v1/api/result" || poll.Query["id"][0] != "grsai-image-task" {
				t.Fatalf("poll = %#v err=%v", poll, err)
			}
			result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "grsai-image-task"}, []byte(`{"id":"grsai-image-task","status":"succeeded","results":[{"url":"https://cdn.example/result.png"}]}`))
			if err != nil || result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Images) != 1 || result.Result.Images[0].URL != "https://cdn.example/result.png" || !result.Result.Images[0].Ephemeral {
				t.Fatalf("result = %#v err=%v", result, err)
			}
		})
	}
}

func TestGrsaiNanoBananaImagePrefersQualityTierOverLegacyResolution(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai-api.yingce-plugin", "grsai-nano-banana-image")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "nano-banana-pro",
		Prompt:      "生成一张Gemini4Pro的宣传海报",
		AspectRatio: "1:1",
		Resolution:  "720",
		Quality:     "4k",
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, create)
	if body["imageSize"] != "4K" {
		t.Fatalf("imageSize = %#v, want 4K when quality=4k and legacy resolution=720", body["imageSize"])
	}
}

func TestGrsaiGPTImageMapsMaskAndBackground(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai-api.yingce-plugin", "grsai-gpt-image")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:  "gpt-image-2-vip",
		Prompt: "修改图片背景",
		Images: []MediaReference{
			{URL: "https://cdn.example/source.png", Role: "edit_source", Order: 1},
			{URL: "https://cdn.example/mask.png", Role: "mask", Order: 2},
		},
		AspectRatio: "1024x1024",
		Quality:     "medium",
		ProviderOptions: map[string]map[string]any{
			"grsai-gpt-image": {"background": "transparent"},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, create)
	images, ok := body["images"].([]any)
	if !ok || len(images) != 1 || images[0] != "https://cdn.example/source.png" {
		t.Fatalf("images = %#v", body["images"])
	}
	if body["mask"] != "https://cdn.example/mask.png" || body["background"] != "transparent" {
		t.Fatalf("edit fields = %#v", body)
	}
}
