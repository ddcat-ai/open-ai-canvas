package app

import "testing"

func TestGeminiImageResolutionAndThinkingAreIndependent(t *testing.T) {
	config := providerConfig{Size: "16:9", Quality: "high", ImageResolution: "1K", ImageParameters: map[string]any{"thinkingLevel": "low"}}
	image := geminiImageConfigFor(config)
	thinking := geminiThinkingConfigFor(config)
	if image == nil || image.AspectRatio != "16:9" || image.ImageSize != "1K" || thinking == nil || thinking.ThinkingLevel != "LOW" {
		t.Fatalf("independent settings: image=%+v thinking=%+v", image, thinking)
	}
	config.ImageResolution = "auto"
	if got := geminiImageConfigFor(config); got == nil || got.ImageSize != "4K" {
		t.Fatalf("auto must retain quality fallback: %+v", got)
	}
	if geminiImageConfigFor(providerConfig{}) != nil || geminiThinkingConfigFor(providerConfig{}) != nil {
		t.Fatal("omitted options must not invent resolution or thinking defaults")
	}
}
