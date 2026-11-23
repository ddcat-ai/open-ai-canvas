package app

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestLayerPlanningDeliversOwnedPixelsToVisionModel(t *testing.T) {
	s, _, pixels := cloudAgentVisionFixture(t)
	input := canvasGenerationInput{
		Mode: "text", Prompt: "规划图层", Metadata: map[string]interface{}{"edit": "layer-planning"},
		ReferenceImages: []providerMedia{{StorageKey: "resource:ref-one", URL: "https://invalid.example/stale.png", DataURL: "data:image/png;base64,c3RhbGU="}},
	}
	if err := s.hydrateGenerationMedia(t.Context(), "user", &input, providerMediaHydrationPolicy{preferURL: true}); err != nil {
		t.Fatal(err)
	}
	want := "data:image/png;base64," + base64.StdEncoding.EncodeToString(pixels)
	if input.ReferenceImages[0].DataURL != want || input.ReferenceImages[0].URL != "" {
		t.Fatal("planning did not use the authorized resource's actual pixels")
	}
	content, err := textChatContent(input)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(content)
	if err != nil || !strings.Contains(string(raw), want) || strings.Contains(string(raw), "invalid.example") {
		t.Fatalf("vision payload lost stored pixels: %v", err)
	}
	foreign := canvasGenerationInput{Mode: "text", Metadata: input.Metadata, ReferenceImages: []providerMedia{{StorageKey: "resource:ref-one"}}}
	if err := s.hydrateGenerationMedia(t.Context(), "other-user", &foreign, providerMediaHydrationPolicy{preferURL: true}); err == nil {
		t.Fatal("planning allowed another user's resource")
	}
}
