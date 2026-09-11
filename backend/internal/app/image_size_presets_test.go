package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestImageSizePresetsValidationAndRoundTrip(t *testing.T) {
	profile := DefaultImageCapabilityConfig("openai-image", "test")
	profile.Size = ImageSizeConfig{Parameter: "size", Values: []string{"1824x1024", "1920x1080"}, Default: "1824x1024", Presets: []ImageSizePreset{
		{Tier: "1k", Ratio: "16:9", Size: "1824x1024", Width: 1824, Height: 1024},
		{Tier: "2k", Ratio: "16:9", Size: "1920x1080", Width: 1920, Height: 1080},
	}}
	if err := validateImageCapabilityConfig(profile); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	var restored ImageCapabilityConfig
	if err := json.Unmarshal(data, &restored); err != nil || len(restored.Size.Presets) != 2 || restored.Size.Presets[1].Size != "1920x1080" {
		t.Fatalf("presets did not survive JSON round trip: %v", err)
	}

	for _, tc := range []struct {
		name string
		edit func(*ImageCapabilityConfig)
		want string
	}{
		{"invalid tier", func(p *ImageCapabilityConfig) { p.Size.Presets[0].Tier = "8k" }, "档位"},
		{"zero ratio", func(p *ImageCapabilityConfig) { p.Size.Presets[0].Ratio = "0:9" }, "比例"},
		{"mismatched ratio", func(p *ImageCapabilityConfig) { p.Size.Presets[0].Ratio = "9:16" }, "不一致"},
		{"tiny size", func(p *ImageCapabilityConfig) {
			p.Size.Presets[0].Width = 16
			p.Size.Presets[0].Height = 16
			p.Size.Presets[0].Size = "16x16"
		}, "像素"},
		{"size mismatch", func(p *ImageCapabilityConfig) { p.Size.Presets[0].Size = "1024x1024" }, "像素"},
		{"not supported", func(p *ImageCapabilityConfig) { p.Size.Values = []string{"1824x1024"} }, "支持值"},
		{"duplicate equivalent ratio", func(p *ImageCapabilityConfig) { p.Size.Presets[1].Tier = "1k"; p.Size.Presets[1].Ratio = "32:18" }, "重复"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var p ImageCapabilityConfig
			if err := json.Unmarshal(data, &p); err != nil {
				t.Fatal(err)
			}
			tc.edit(&p)
			if err := validateImageCapabilityConfig(&p); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %s, got %v", tc.want, err)
			}
		})
	}
}

func TestImageSizePresetsEnforceResolutionRatioPair(t *testing.T) {
	profile := DefaultImageCapabilityConfig("grok-image", "grok-imagine-image")
	profile.Quality.Default = "1k"
	profile.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"1:1", "16:9"}, Default: "1:1", Presets: []ImageSizePreset{
		{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024},
		{Tier: "2k", Ratio: "16:9", Size: "2752x1536", Width: 2752, Height: 1536},
	}}
	if err := validateImageCapabilityConfig(profile); err != nil {
		t.Fatal(err)
	}
	profile.Quality.Default = "2k"
	if err := validateImageCapabilityConfig(profile); err == nil || !strings.Contains(err.Error(), "默认图片分辨率") {
		t.Fatalf("expected invalid default pair error, got %v", err)
	}
	profile.Quality.Default = "1k"
	input := canvasGenerationInput{Config: providerConfig{Size: "1:1", Quality: "2k"}}
	if err := validateImageTask(profile, input); err == nil || !strings.Contains(err.Error(), "当前分辨率") {
		t.Fatalf("expected pair validation error, got %v", err)
	}
	input.Config.Size = "16:9"
	if err := validateImageTask(profile, input); err != nil {
		t.Fatal(err)
	}
	profile.Size.AllowCustom = true
	input.Config.Size = "1:1"
	if err := validateImageTask(profile, input); err != nil {
		t.Fatal(err)
	}
}
