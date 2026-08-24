package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestModelRequestIntentNormalizesVideoResolution(t *testing.T) {
	input := map[string]any{
		"mode":   "video",
		"config": map[string]any{"vquality": "480", "videoSeconds": "6", "size": "16:9"},
	}
	intent := ModelRequestIntentFromTaskInput(input, "video_generate", "text_to_video")
	if got := intent.Options["vquality"]; got != "480p" {
		t.Fatalf("vquality = %#v, want 480p", got)
	}
}

func TestSKUSelectorIncludesVideoReferenceImageCount(t *testing.T) {
	selector := skuSelectorForIntent(ModelRequestIntent{Capability: "video", Inputs: map[string]int{"image": 5}, Options: map[string]any{"vquality": "720p"}})
	if selector["imageCount"] != "5" || selector["vquality"] != "720p" {
		t.Fatalf("selector = %#v", selector)
	}
	modelWithTiers := model.ChannelModel{PriceTiers: []model.ChannelModelPriceTier{
		{SelectorJSON: `{"vquality":"720p","imageCount":"5"}`, Enabled: true, PriceConfigured: true},
		{SelectorJSON: `{"vquality":"720p","imageCount":"9"}`, Enabled: true, PriceConfigured: true},
	}}
	matched := channelModelPriceTierForIntent(modelWithTiers, ModelRequestIntent{Capability: "video", Inputs: map[string]int{"image": 5}, Options: map[string]any{"vquality": "720p"}})
	if matched == nil || matched.SelectorJSON != `{"vquality":"720p","imageCount":"5"}` {
		t.Fatalf("matched tier = %#v", matched)
	}
}

func TestSKUSelectorTreatsAnyVideoReferenceAsVideoToVideo(t *testing.T) {
	intent := ModelRequestIntentFromTaskInput(map[string]any{
		"mode":              "video",
		"referenceImages":   []any{map[string]any{"url": "https://example.com/reference.png"}},
		"referenceVideos":   []any{map[string]any{"url": "https://example.com/reference.mp4"}},
		"referenceAudios":   []any{map[string]any{"url": "https://example.com/reference.mp3"}},
		"capabilityOptions": map[string]any{"vquality": "720p"},
	}, "canvas_video", "reference_to_video")
	selector := skuSelectorForIntent(intent)
	if selector["operation"] != "video_to_video" {
		t.Fatalf("operation = %q, want video_to_video; selector = %#v", selector["operation"], selector)
	}

	modelWithTiers := model.ChannelModel{PriceTiers: []model.ChannelModelPriceTier{
		{SelectorJSON: `{}`, Enabled: true, PriceConfigured: true},
		{SelectorJSON: `{"operation":"video_to_video"}`, Enabled: true, PriceConfigured: true},
	}}
	matched := channelModelPriceTierForIntent(modelWithTiers, intent)
	if matched == nil || matched.SelectorJSON != `{"operation":"video_to_video"}` {
		t.Fatalf("matched tier = %#v", matched)
	}
}

func TestSKUSelectorTreatsAnyImageReferenceCountAsImageToVideo(t *testing.T) {
	intent := ModelRequestIntentFromTaskInput(map[string]any{
		"mode": "video",
		"referenceImages": []any{
			map[string]any{"url": "https://example.com/reference-1.png"},
			map[string]any{"url": "https://example.com/reference-2.png"},
			map[string]any{"url": "https://example.com/reference-3.png"},
		},
	}, "canvas_video", "reference_to_video")
	selector := skuSelectorForIntent(intent)
	if selector["operation"] != "image_to_video" || selector["imageCount"] != "3" {
		t.Fatalf("selector = %#v, want image_to_video with imageCount 3", selector)
	}

	modelWithTiers := model.ChannelModel{PriceTiers: []model.ChannelModelPriceTier{
		{SelectorJSON: `{}`, Enabled: true, PriceConfigured: true},
		{SelectorJSON: `{"operation":"image_to_video"}`, Enabled: true, PriceConfigured: true},
	}}
	matched := channelModelPriceTierForIntent(modelWithTiers, intent)
	if matched == nil || matched.SelectorJSON != `{"operation":"image_to_video"}` {
		t.Fatalf("matched tier = %#v", matched)
	}
}
