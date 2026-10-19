package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/generation"
	"yingce/backend/internal/model"
)

func customResolutionDurationProfile(t *testing.T) *ModelCapabilityConfig {
	t.Helper()
	profile := DefaultModelCapabilityConfig(string(model.ChannelInterfaceMiniMaxVideo))
	data, _ := json.Marshal(profile)
	var value map[string]any
	_ = json.Unmarshal(data, &value)
	video := value["video"].(map[string]any)
	video["duration"] = map[string]any{"selection": "range", "min": 1, "max": 15, "step": 1, "default": 5}
	video["resolutions"] = []string{"768p", "1080p"}
	video["defaultResolution"] = "768p"
	video["durationByResolution"] = map[string]any{
		"768p":  map[string]any{"selection": "range", "min": 1, "max": 20, "step": 1, "default": 5},
		"1080p": map[string]any{"selection": "enum", "values": []int{5, 10}, "default": 5},
	}
	data, _ = json.Marshal(value)
	result, err := DecodeModelCapabilityConfig(string(data))
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCustomVideoDurationSurvivesRuntimeContract(t *testing.T) {
	profile := customResolutionDurationProfile(t)
	data, _ := json.Marshal(profile)
	var runtime generation.ModelCapabilityConfig
	if err := json.Unmarshal(data, &runtime); err != nil {
		t.Fatal(err)
	}
	data, _ = json.Marshal(runtime)
	var value map[string]any
	_ = json.Unmarshal(data, &value)
	if _, ok := value["video"].(map[string]any)["durationByResolution"].(map[string]any); !ok {
		t.Fatalf("runtime contract discarded resolution duration overrides: %s", data)
	}
}

func TestCustomVideoDurationRoutesAndTasksUseSelectedResolution(t *testing.T) {
	profile := customResolutionDurationProfile(t)
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		resolution, seconds string
		allowed             bool
	}{{"1080p", "15", false}, {"1080p", "10", true}, {"768p", "20", true}} {
		input := canvasGenerationInput{Mode: "video", Prompt: "test", Config: providerConfig{Size: profile.Video.DefaultRatio, VQuality: tc.resolution, VideoSeconds: tc.seconds}}
		if err := validateVideoTask(profile.Video, input); (err == nil) != tc.allowed {
			t.Errorf("task %s/%ss: err=%v, want allowed=%v", tc.resolution, tc.seconds, err, tc.allowed)
		}
		intent := ModelRequestIntent{Capability: "video", Options: map[string]any{"vquality": tc.resolution, "videoSeconds": tc.seconds}}
		if match := MatchCapability(spec, intent); match.Matched != tc.allowed {
			t.Errorf("route %s/%ss: match=%+v, want allowed=%v", tc.resolution, tc.seconds, match, tc.allowed)
		}
	}
}

func TestCustomVideoDurationRejectsUnsupportedPriceTier(t *testing.T) {
	data, _ := json.Marshal(customResolutionDurationProfile(t))
	tiers := []model.ChannelModelPriceTier{{Resolution: "1080p", VideoSeconds: 15}}
	if err := validateChannelModelTierCapabilities(tiers, string(data), "video", string(model.ChannelInterfaceMiniMaxVideo)); err == nil {
		t.Fatal("1080p price tier accepted a duration only supported by another resolution")
	}
}

func TestCustomVideoDurationDefaultsFollowResolution(t *testing.T) {
	profile := customResolutionDurationProfile(t)
	duration := profile.Video.DurationByResolution["1080p"]
	duration.Default = 10
	profile.Video.DurationByResolution["1080p"] = duration
	profile.Video.DefaultResolution = "1080p"
	config := map[string]any{"vquality": "1080p"}
	applyChannelCapabilityDefaults(config, "video", profile)
	if config["videoSeconds"] != "10" {
		t.Fatalf("task default ignored selected resolution: %+v", config)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(profile)
	defaults, err := channelModelDefaultOptions(model.ChannelModel{Capability: "video", Protocol: model.ChannelInterfaceMiniMaxVideo, CapabilityConfigJSON: string(data)}, spec)
	if err != nil || defaults["videoSeconds"] != 10 {
		t.Fatalf("catalog defaults ignored resolution: %+v, %v", defaults, err)
	}
}

func TestCustomVideoDurationRejectsUnknownOrDuplicateResolution(t *testing.T) {
	for _, key := range []string{"", "1440p", "1080"} {
		profile := customResolutionDurationProfile(t)
		profile.Video.DurationByResolution[key] = VideoDurationConfig{Selection: "enum", Values: []int{5}, Default: 5}
		if err := validateVideoCapabilityConfig(profile.Video); err == nil {
			t.Fatalf("unknown or duplicate resolution %q accepted", key)
		}
	}
}
