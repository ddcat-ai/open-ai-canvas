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
