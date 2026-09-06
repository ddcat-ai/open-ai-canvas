package service

import (
	"fmt"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestImagePriceTiersMatchResolutionAndActualReferences(t *testing.T) {
	channelModel := model.ChannelModel{}
	for _, operation := range []string{"text_to_image", "image_to_image"} {
		for _, quality := range []string{"1k", "2k", "4k"} {
			channelModel.PriceTiers = append(channelModel.PriceTiers, model.ChannelModelPriceTier{
				ID: operation + "-" + quality, SelectorJSON: fmt.Sprintf(`{"operation":%q,"quality":%q}`, operation, quality), Enabled: true, PriceConfigured: true,
			})
		}
	}
	for _, operation := range []string{"", "image", "text_to_image", "image_to_image"} {
		for _, quality := range []string{"1K", "2K", "4K"} {
			for _, imageCount := range []int{0, 1, 3} {
				intent := ModelRequestIntentFromTaskInput(map[string]any{
					"mode": "image", "referenceImages": make([]any, imageCount), "config": map[string]any{"quality": quality},
				}, "canvas_image", operation)
				wantOperation := "text_to_image"
				if imageCount > 0 {
					wantOperation = "image_to_image"
				}
				tier := channelModelPriceTierForIntent(channelModel, intent)
				if tier == nil || tier.ID != wantOperation+"-"+skuSelectorForIntent(intent)["quality"] {
					t.Fatalf("operation=%q quality=%q imageCount=%d: tier=%#v", operation, quality, imageCount, tier)
				}
			}
		}
	}
	if tier := channelModelPriceTierForIntent(channelModel, ModelRequestIntent{Capability: "image", Options: map[string]any{"quality": "8k"}}); tier != nil {
		t.Fatalf("unconfigured resolution matched tier: %#v", tier)
	}
}

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

func TestModelRequestIntentNormalizesImageSpecificationValues(t *testing.T) {
	input := map[string]any{
		"mode":   "image",
		"config": map[string]any{"quality": "1K", "size": "3:2"},
	}
	intent := ModelRequestIntentFromTaskInput(input, "canvas_image", "image")
	if got := intent.Options["quality"]; got != "1k" {
		t.Fatalf("quality = %#v, want 1k", got)
	}
	if got := intent.Options["size"]; got != "3:2" {
		t.Fatalf("size = %#v, want 3:2", got)
	}
}

func TestSKUSelectorInfersImageResolutionFromSizeWhenQualityIsAutomatic(t *testing.T) {
	for _, test := range []struct {
		size string
		want string
	}{
		{size: "1024x1024", want: "1k"},
		{size: "2048x2048", want: "2k"},
		{size: "2880x2880", want: "4k"},
	} {
		selector := skuSelectorForIntent(ModelRequestIntent{Capability: "image", Options: map[string]any{"quality": "auto", "size": test.size}})
		if selector["quality"] != test.want {
			t.Fatalf("size %s quality = %q, want %q", test.size, selector["quality"], test.want)
		}
	}
}

func TestSKUSelectorHandlesMissingImageOptions(t *testing.T) {
	for _, quality := range []any{nil, "", "auto", "any"} {
		options := map[string]any{"size": "2048x2048"}
		if quality != nil {
			options["quality"] = quality
		}
		selector := skuSelectorForIntent(ModelRequestIntent{Capability: "image", Options: options})
		if selector["quality"] != "2k" {
			t.Errorf("quality=%#v: selector=%#v, want 2k", quality, selector)
		}
	}
	for _, options := range []map[string]any{nil, {}, {"quality": nil, "size": nil}} {
		selector := skuSelectorForIntent(ModelRequestIntent{Capability: "image", Options: options})
		if len(selector) != 1 || selector["operation"] != "text_to_image" {
			t.Errorf("missing options produced synthetic specification: %#v", selector)
		}
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
