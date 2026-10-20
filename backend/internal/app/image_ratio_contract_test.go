package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestGeminiDeclaredUltrawideRatioSurvivesAdmissionAndProvider(t *testing.T) {
	for _, tier := range []string{"1k", "2k", "4k"} {
		for _, size := range []string{"21:9", "7:3", "pixels"} {
			for _, references := range []int{0, 1, 2} {
				t.Run(fmt.Sprintf("%s/%s/references-%d", tier, size, references), func(t *testing.T) {
					profile := DefaultModelCapabilityConfigForModel("gemini-image", "gemini-nano-banana-2.1")
					profile.Image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"1k", "2k", "4k"}, Default: "1k"}
					profile.Image.Size.Presets = []ImageSizePreset{
						{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024},
						{Tier: "1k", Ratio: "21:9", Size: "2048x878", Width: 2048, Height: 878},
						{Tier: "2k", Ratio: "1:1", Size: "2048x2048", Width: 2048, Height: 2048},
						{Tier: "2k", Ratio: "21:9", Size: "3136x1344", Width: 3136, Height: 1344},
						{Tier: "4k", Ratio: "1:1", Size: "2880x2880", Width: 2880, Height: 2880},
						{Tier: "4k", Ratio: "21:9", Size: "3808x1632", Width: 3808, Height: 1632},
					}
					requested := size
					if size == "pixels" {
						for _, preset := range profile.Image.Size.Presets {
							if preset.Ratio == "21:9" && preset.Tier == tier {
								requested = preset.Size
							}
						}
						if requested == "pixels" {
							t.Fatal("missing ultrawide fixture preset")
						}
					}
					svc, _, channel, cm := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceGeminiImage, profile, []model.ChannelModelPriceTier{
						newSelectionPriceTier("tier", `{"imageResolution":"`+tier+`"}`, "gemini-nano-banana-2.1", "fixed_request"),
					})
					media := []providerMedia{}
					for index := 0; index < references; index++ {
						media = append(media, providerMedia{DataURL: "data:image/png;base64,aGVsbG8=", MimeType: "image/png"})
					}
					input := map[string]any{"mode": "image", "prompt": "an apple", "referenceImages": media, "config": map[string]any{
						"channelId": channel.ID, "model": cm.ModelKey, "imageParameters": map[string]any{"size": requested, "imageResolution": tier, "count": 1},
					}}
					resolved, err := svc.resolveSystemChannelModelSelection(input, "canvas_image", "image")
					if err != nil {
						t.Fatal(err)
					}
					if err := svc.ValidateTaskCapability(resolved); err != nil {
						t.Fatal(err)
					}
					raw, _ := json.Marshal(resolved)
					var task canvasGenerationInput
					if err := json.Unmarshal(raw, &task); err != nil {
						t.Fatal(err)
					}
					if task.Config.Size != "21:9" || task.Config.ImageParameters["size"] != "21:9" {
						t.Fatalf("ratio changed: %#v", task.Config)
					}
					adapter := imageParameterTestAdapter(t, "google-gemini-image", "gemini-image")
					create, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: protocolRequestFromInput(task)})
					if err != nil {
						t.Fatal(err)
					}
					bodyRaw, _ := json.Marshal(create.Body)
					var body struct {
						GenerationConfig struct {
							ImageConfig struct{ AspectRatio, ImageSize string }
						}
						Contents []struct{ Parts []map[string]any }
					}
					if err := json.Unmarshal(bodyRaw, &body); err != nil {
						t.Fatal(err)
					}
					if body.GenerationConfig.ImageConfig.AspectRatio != "21:9" || body.GenerationConfig.ImageConfig.ImageSize != strings.ToUpper(tier) {
						t.Fatalf("invalid provider body: %s", bodyRaw)
					}
					if len(body.Contents) != 1 || len(body.Contents[0].Parts) != references+1 {
						t.Fatalf("reference count changed: %s", bodyRaw)
					}
					for _, part := range body.Contents[0].Parts[1:] {
						if part["inlineData"] == nil {
							t.Fatalf("reference lost: %s", bodyRaw)
						}
					}
				})
			}
		}
	}
}

func TestNormalizeImageSizeIntentPreservesDeclaredRatioToken(t *testing.T) {
	spec := CapabilitySpec{ImageSize: &CapabilityImageSize{Parameter: "aspect_ratio", Presets: []ImageSizePreset{{Tier: "2k", Ratio: "21:9", Size: "3136x1344"}}}, Options: map[string]OptionConstraint{"imageResolution": {Values: []any{"2k"}}}}
	for _, value := range []string{"21:9", "7:3", "3136x1344"} {
		intent := normalizeImageSizeIntent(spec, ModelRequestIntent{Capability: "image", Options: map[string]any{"size": value, "imageResolution": "2k"}})
		if intent.Options["size"] != "21:9" {
			t.Fatalf("%s became %v", value, intent.Options["size"])
		}
	}
}
