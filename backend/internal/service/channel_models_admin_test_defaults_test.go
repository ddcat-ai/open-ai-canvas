package service

import "testing"

func TestVideoTestDefaultsFollowCapabilityProfile(t *testing.T) {
	tests := []struct {
		name           string
		profile        *VideoCapabilityConfig
		wantRatio      string
		wantResolution string
	}{
		{name: "nil profile falls back", profile: nil, wantRatio: "16:9", wantResolution: "720"},
		{name: "declared defaults win", profile: &VideoCapabilityConfig{Ratios: []string{"9:16", "16:9"}, DefaultRatio: "16:9", Resolutions: []string{"480p", "720p"}, DefaultResolution: "720p"}, wantRatio: "16:9", wantResolution: "720p"},
		{name: "first enum when no default", profile: &VideoCapabilityConfig{Ratios: []string{"1:1"}, Resolutions: []string{"768p横"}}, wantRatio: "1:1", wantResolution: "768p横"},
		{name: "empty profile falls back", profile: &VideoCapabilityConfig{}, wantRatio: "16:9", wantResolution: "720"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ratio, resolution := videoTestDefaults(tt.profile)
			if ratio != tt.wantRatio || resolution != tt.wantResolution {
				t.Fatalf("videoTestDefaults() = (%q, %q), want (%q, %q)", ratio, resolution, tt.wantRatio, tt.wantResolution)
			}
		})
	}
}

func TestVideoTestDefaultsResolveArkSeedanceEnum(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("volcengine-ark-video", "doubao-seedance-2-0-mini-260615").Video
	_, resolution := videoTestDefaults(profile)
	if resolution == "" || resolution == "720" {
		t.Fatalf("Ark Seedance test resolution must come from the declared enum, got %q", resolution)
	}
	if got := videoResolutionNameRequest(profile, resolution); got != resolution {
		t.Fatalf("declared resolution %q must round-trip through the profile, got %q", resolution, got)
	}
}
