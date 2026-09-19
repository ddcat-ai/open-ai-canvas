package app

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestNormalizeVideoAudioPriceSelector(t *testing.T) {
	for _, test := range []struct {
		value string
		want  string
	}{
		{value: "true", want: "true"},
		{value: "false", want: "false"},
		{value: " FALSE ", want: "false"},
		{value: "*", want: ""},
	} {
		t.Run(test.value, func(t *testing.T) {
			selector, _, _, err := normalizeChannelModelTierSelector("video", ChannelModelPriceTierRequest{
				Selector: map[string]string{"videoGenerateAudio": test.value},
			})
			if err != nil || selector["videoGenerateAudio"] != test.want {
				t.Fatalf("selector = %#v, error = %v, want audio %q", selector, err, test.want)
			}
			if test.want == "" && len(selector) != 0 {
				t.Fatalf("wildcard must share the default selector, got %#v", selector)
			}
		})
	}
	for _, value := range []string{"yes", "1", "0", "auto"} {
		if _, _, _, err := normalizeChannelModelTierSelector("video", ChannelModelPriceTierRequest{
			Selector: map[string]string{"videoGenerateAudio": value},
		}); err == nil {
			t.Fatalf("invalid audio selector %q accepted", value)
		}
	}
	for _, capability := range []string{"text", "image", "audio"} {
		for _, value := range []string{"true", "false", "*"} {
			if _, _, _, err := normalizeChannelModelTierSelector(capability, ChannelModelPriceTierRequest{
				Selector: map[string]string{"videoGenerateAudio": value},
			}); err == nil {
				t.Fatalf("%s model accepted video audio selector %q", capability, value)
			}
		}
	}
}

func TestVideoPriceTierMatchesAudioAndActualReferences(t *testing.T) {
	channelModel := model.ChannelModel{PriceTiers: []model.ChannelModelPriceTier{
		{ID: "default", SelectorJSON: `{}`, Enabled: true, PriceConfigured: true},
		{ID: "reference", SelectorJSON: `{"operation":"video_to_video"}`, Enabled: true, PriceConfigured: true},
		{ID: "reference-audio", SelectorJSON: `{"operation":"video_to_video","videoGenerateAudio":"true"}`, Enabled: true, PriceConfigured: true},
		{ID: "reference-silent", SelectorJSON: `{"operation":"video_to_video","videoGenerateAudio":"false"}`, Enabled: true, PriceConfigured: true},
	}}
	for _, test := range []struct {
		name  string
		value any
		want  string
	}{
		{name: "audio boolean", value: true, want: "reference-audio"},
		{name: "silent boolean", value: false, want: "reference-silent"},
		{name: "audio string", value: "true", want: "reference-audio"},
		{name: "silent string", value: "false", want: "reference-silent"},
		{name: "unspecified", want: "reference"},
		{name: "invalid is not silent", value: "invalid", want: "reference"},
	} {
		t.Run(test.name, func(t *testing.T) {
			options := map[string]any{}
			if test.value != nil {
				options["videoGenerateAudio"] = test.value
			}
			for _, source := range []string{"config", "capabilityOptions"} {
				intent := ModelRequestIntentFromTaskInput(map[string]any{
					"mode": "video", "referenceVideos": []any{map[string]any{"id": "video-reference"}}, source: options,
				}, "canvas_video", "reference_to_video")
				tier := channelModelPriceTierForIntent(channelModel, intent)
				if tier == nil || tier.ID != test.want {
					t.Fatalf("%s matched %#v, want %s", source, tier, test.want)
				}
			}
		})
	}
	intent := ModelRequestIntent{Capability: "video", Inputs: map[string]int{"video": 1}}
	intent.Options = mergeIntentDefaults(map[string]any{"videoGenerateAudio": false}, map[string]any{"videoGenerateAudio": true})
	if tier := channelModelPriceTierForIntent(channelModel, intent); tier == nil || tier.ID != "reference-silent" {
		t.Fatalf("explicit false must override audio default: %#v", tier)
	}
}

func TestVideoTokenPricesUseOutputOnlyAndSharedBounds(t *testing.T) {
	for _, protocol := range []model.ChannelInterfaceType{model.ChannelInterfaceVolcengineArkVideo, model.ChannelInterfaceVolcengineArkAgentPlanVideo, model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceType("newapi-channel-2"), model.ChannelInterfaceType("custom-video")} {
		for _, test := range []struct {
			name          string
			input, output int64
			cached        int64
			valid         bool
		}{
			{name: "free", valid: true},
			{name: "paid", output: 16_000_000, valid: true},
			{name: "maximum", output: maxChannelModelTokenPriceMicrocredits, valid: true},
			{name: "over maximum", output: maxChannelModelTokenPriceMicrocredits + 1},
			{name: "negative", output: -1},
			{name: "hidden input price", input: 1, output: 16_000_000},
			{name: "hidden cached price", output: 16_000_000, cached: 1},
		} {
			t.Run(string(protocol)+"/"+test.name, func(t *testing.T) {
				if got := ValidateChannelModelPrice("token", "video", protocol, 0, test.input, test.output, test.cached); got != test.valid {
					t.Fatalf("price validity = %v, want %v", got, test.valid)
				}
				for _, configured := range []bool{true, false} {
					err := validateChannelModelTierPricing("video", protocol, "token", ChannelModelPriceTierRequest{
						PriceConfigured: configured, InputTokenPriceMicrocredits: test.input,
						OutputTokenPriceMicrocredits: test.output, CachedTokenPriceMicrocredits: test.cached,
					})
					if (err == nil) != test.valid {
						t.Fatalf("configured=%v error=%v, want validity %v", configured, err, test.valid)
					}
				}
			})
		}
	}
}
