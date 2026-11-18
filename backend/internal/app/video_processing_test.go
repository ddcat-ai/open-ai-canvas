package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestValidateVideoProcessingConfig(t *testing.T) {
	valid := []*VideoProcessingConfig{
		nil,
		{FPSPolicy: VideoProcessingFPSKeepSource},
		{FPSPolicy: VideoProcessingFPSUserSelect, FPSOptions: []int{30, 60, 120}, MaxSourceSeconds: 120},
	}
	for _, value := range valid {
		if err := validateVideoProcessingConfig(value, VideoProcessingOperationEnhance); err != nil {
			t.Fatalf("validateVideoProcessingConfig(%#v) = %v", value, err)
		}
	}
	invalid := []*VideoProcessingConfig{
		{FPSPolicy: "auto"},
		{FPSPolicy: VideoProcessingFPSKeepSource, FPSOptions: []int{30}},
		{FPSPolicy: VideoProcessingFPSUserSelect},
		{FPSPolicy: VideoProcessingFPSUserSelect, FPSOptions: []int{10}},
		{FPSPolicy: VideoProcessingFPSUserSelect, FPSOptions: []int{30, 30}},
		{FPSPolicy: VideoProcessingFPSKeepSource, MaxSourceSeconds: DefaultVideoProcessingMaxSourceSeconds + 1},
	}
	for _, value := range invalid {
		if err := validateVideoProcessingConfig(value, VideoProcessingOperationEnhance); err == nil {
			t.Fatalf("validateVideoProcessingConfig(%#v) accepted invalid config", value)
		}
	}
}

func TestNormalizeVideoProcessingOptionsKeepSourceDropsFPS(t *testing.T) {
	options := map[string]any{"fps": 60, "bitrate_level": "HIGH", "bitrate": "", "unknown": "x"}
	band, err := normalizeVideoProcessingOptions(&VideoProcessingConfig{FPSPolicy: VideoProcessingFPSKeepSource}, options)
	if err != nil {
		t.Fatal(err)
	}
	if band != "le30" {
		t.Fatalf("band = %q, want le30", band)
	}
	if _, ok := options["fps"]; ok {
		t.Fatalf("keep_source must not send fps: %#v", options)
	}
	if options["bitrate_level"] != "high" || options["bitrate"] != nil || options["unknown"] != nil {
		t.Fatalf("options = %#v", options)
	}
}

func TestNormalizeVideoProcessingOptionsUserSelect(t *testing.T) {
	processing := &VideoProcessingConfig{FPSPolicy: VideoProcessingFPSUserSelect, FPSOptions: []int{30, 60, 120}}
	options := map[string]any{"fps": float64(60), "bitrate": float64(8000)}
	band, err := normalizeVideoProcessingOptions(processing, options)
	if err != nil {
		t.Fatal(err)
	}
	if band != "le60" || options["fps"] != 60 || options["bitrate"] != 8000 {
		t.Fatalf("band = %q, options = %#v", band, options)
	}
	for _, bad := range []map[string]any{{}, {"fps": 45}, {"fps": 60, "bitrate": 5}, {"fps": 60, "bitrate_level": "ultra"}} {
		if _, err := normalizeVideoProcessingOptions(processing, bad); err == nil {
			t.Fatalf("accepted invalid options %#v", bad)
		}
	}
}

func TestVideoFPSBand(t *testing.T) {
	cases := map[float64]string{0: "", 24: "le30", 30: "le30", 30.5: "le60", 60: "le60", 61: "le120", 120: "le120"}
	for fps, want := range cases {
		if got := videoFPSBand(fps); got != want {
			t.Fatalf("videoFPSBand(%v) = %q, want %q", fps, got, want)
		}
	}
}

func TestValidateVideoProcessingSourceSize(t *testing.T) {
	for _, size := range [][2]int{{854, 480}, {1920, 1080}, {1080, 1920}, {0, 0}} {
		if err := validateVideoProcessingSourceSize(size[0], size[1]); err != nil {
			t.Fatalf("size %v rejected: %v", size, err)
		}
	}
	for _, size := range [][2]int{{640, 320}, {2560, 1440}, {2000, 1000}} {
		if err := validateVideoProcessingSourceSize(size[0], size[1]); err == nil {
			t.Fatalf("size %v accepted", size)
		}
	}
}

func TestFPSBandSelectsVideoPriceTier(t *testing.T) {
	channelModel := model.ChannelModel{PriceTiers: []model.ChannelModelPriceTier{
		{ID: "1080-le30", SelectorJSON: `{"vquality":"1080p","fpsBand":"le30"}`, BillingMode: "per_second", Enabled: true, PriceConfigured: true},
		{ID: "1080-le60", SelectorJSON: `{"vquality":"1080p","fpsBand":"le60"}`, BillingMode: "per_second", Enabled: true, PriceConfigured: true},
	}}
	intent := ModelRequestIntent{Capability: "video", Inputs: map[string]int{"video": 1}, Options: map[string]any{"vquality": "1080p", "fpsBand": "le60", "videoSeconds": 5}}
	tier := channelModelPriceTierForIntent(channelModel, intent)
	if tier == nil || tier.ID != "1080-le60" {
		t.Fatalf("tier = %#v, want 1080-le60", tier)
	}
}

func TestEnhanceOperationKeepsOwnPriceSelector(t *testing.T) {
	selector := skuSelectorForIntent(ModelRequestIntent{Capability: "video", Operation: VideoProcessingOperationEnhance, Inputs: map[string]int{"video": 1}, Options: map[string]any{"vquality": "1080p", "fpsBand": "le60"}})
	if selector["operation"] != VideoProcessingOperationEnhance || selector["fpsBand"] != "le60" || selector["vquality"] != "1080p" {
		t.Fatalf("selector = %#v", selector)
	}
	ordinary := skuSelectorForIntent(ModelRequestIntent{Capability: "video", Operation: "reference_to_video", Inputs: map[string]int{"video": 1}})
	if ordinary["operation"] != "video_to_video" {
		t.Fatalf("ordinary video reference selector = %#v", ordinary)
	}
}
