package app

import (
	"math"
	"testing"
)

func TestArkVideoEstimateUsesOfficialDimensionsAndNoExtraFrames(t *testing.T) {
	for _, tt := range []struct {
		name, model, resolution, ratio string
		width, height                  int64
		estimated                      bool
	}{
		{"1.0 fast retains 1080", "doubao-seedance-1-0-pro-fast", "1080P", "16:9", 1920, 1088, false},
		{"1.5", "doubao-seedance-1-5-pro", "720", "16:9", 1280, 720, false},
		{"2.5", "doubao-seedance-2-5", "480p", "9:16", 480, 854, false},
		{"4K widescreen", "doubao-seedance-2-0", "4K", "21:9", 4398, 1886, false},
		{"4K classic", "doubao-seedance-2-0", "2160p", "4:3", 3326, 2494, false},
		{"endpoint conservative size", "ep-custom", "720p", "21:9", 1504, 640, true},
		{"adaptive", "doubao-seedance-2-0", "720p", "adaptive", 1112, 834, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			estimate := estimateArkVideoTokens(map[string]any{"config": map[string]any{
				"model": "display-name-fast", "providerModelKey": tt.model, "vquality": tt.resolution, "size": tt.ratio, "videoSeconds": "5",
			}})
			if estimate.Err != nil {
				t.Fatal(estimate.Err)
			}
			got := estimate.Video
			want := (tt.width*tt.height*24*5 + 1023) / 1024
			if got.OutputWidth != tt.width || got.OutputHeight != tt.height || got.FormulaTokens != want || got.DimensionsEstimated != tt.estimated || got.ReservedTokens != (want*110+99)/100 {
				t.Fatalf("estimate=%#v, want %dx%d, tokens=%d", got, tt.width, tt.height, want)
			}
		})
	}
}

func TestArkVideoEstimateRejectsInvalidParameters(t *testing.T) {
	for _, patch := range []map[string]any{
		{"vquality": "garbage"}, {"size": "invalid"}, {"size": "0:7"},
		{"videoSeconds": "-1"}, {"videoSeconds": "1.5"}, {"videoSeconds": math.MaxInt64},
	} {
		config := map[string]any{"model": "doubao-seedance-2-0", "vquality": "720p", "size": "16:9", "videoSeconds": "5"}
		for k, v := range patch {
			config[k] = v
		}
		if got := estimateArkVideoTokens(map[string]any{"config": config}); got.Err == nil || got.OutputTokens != 0 {
			t.Fatalf("invalid config %#v yielded %#v", patch, got)
		}
	}
}

func TestArkVideoReferenceUsesOutputPixelsAndFractionalSeconds(t *testing.T) {
	input := map[string]any{"config": map[string]any{"model": "doubao-seedance-2-0", "videoSeconds": "5", "vquality": "720p", "size": "16:9"},
		"referenceVideos": []any{map[string]any{"durationMs": 1250, "width": 3840, "height": 2160}, map[string]any{"durationMs": 250}},
	}
	got := estimateArkVideoTokens(input)
	if got.Err != nil || got.Video.FormulaTokens != 140400 || got.Video.ReferenceSeconds != 1.5 || got.Video.ReferenceDurationEstimated {
		t.Fatalf("estimate=%#v error=%v", got.Video, got.Err)
	}
	for _, references := range []any{[]any{map[string]any{"durationMs": -1}}, []any{map[string]any{"durationMs": 1.5}}, []any{map[string]any{"durationMs": int64(math.MaxInt64)}, map[string]any{"durationMs": 6000}}, "invalid", make([]any, 129)} {
		input["referenceVideos"] = references
		if got := estimateArkVideoTokens(input); got.Err == nil {
			t.Fatalf("accepted invalid references: %#v", references)
		}
	}
}
