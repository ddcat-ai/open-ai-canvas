package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCapabilitySpecWithRoutePresetsRestoresImageSize(t *testing.T) {
	product := CapabilitySpec{Version: 1, Capability: "image", Options: map[string]OptionConstraint{
		"size": {Values: []any{"16:9"}},
	}}
	route := CapabilitySpec{
		Version:    1,
		Capability: "image",
		Options:    map[string]OptionConstraint{"size": {Values: []any{"16:9"}}},
		ImageSize: &CapabilityImageSize{
			Parameter: "aspect_ratio",
			Presets:   []CapabilityImageSizePreset{{Size: "3840x2160", Tier: "4k", Ratio: "16:9", Width: 3840, Height: 2160}},
		},
	}
	got := capabilitySpecWithRoutePresets(product, []CapabilitySpec{route})
	if got.ImageSize == nil || got.ImageSize.Parameter != "aspect_ratio" || len(got.ImageSize.Presets) != 1 || got.ImageSize.Presets[0].Tier != "4k" {
		t.Fatalf("restored imageSize = %#v", got.ImageSize)
	}
}

func TestCapabilitySpecWithRoutePresetsUnionsTiersAcrossRoutes(t *testing.T) {
	// 前台快照只带了单条线路的 1K 预设，其它线路提供 2K/4K：必须取并集，不能压成单档。
	preset := func(size string, tier string, width int, height int) CapabilityImageSizePreset {
		return CapabilityImageSizePreset{Size: size, Tier: tier, Ratio: "16:9", Width: width, Height: height}
	}
	product := CapabilitySpec{
		Version:    1,
		Capability: "image",
		Options:    map[string]OptionConstraint{"size": {Values: []any{"16:9"}}},
		ImageSize: &CapabilityImageSize{
			Parameter: "aspect_ratio",
			Presets:   []CapabilityImageSizePreset{preset("1824x1024", "1k", 1824, 1024)},
		},
	}
	routes := []CapabilitySpec{
		{Version: 1, Capability: "image", ImageSize: &CapabilityImageSize{Parameter: "aspect_ratio", Presets: []CapabilityImageSizePreset{preset("2752x1536", "2k", 2752, 1536)}}},
		{Version: 1, Capability: "image", ImageSize: &CapabilityImageSize{Parameter: "aspect_ratio", Presets: []CapabilityImageSizePreset{preset("3840x2160", "4k", 3840, 2160)}}},
	}

	got := capabilitySpecWithRoutePresets(product, routes)
	if got.ImageSize == nil {
		t.Fatal("imageSize = nil")
	}
	tiers := make(map[string]bool, len(got.ImageSize.Presets))
	for _, item := range got.ImageSize.Presets {
		tiers[item.Tier] = true
	}
	for _, tier := range []string{"1k", "2k", "4k"} {
		if !tiers[tier] {
			t.Fatalf("tier %s missing: %#v", tier, got.ImageSize.Presets)
		}
	}
}

func TestEnabledLogicalRouteSpecsOmitsDisabledAndZeroWeightTiers(t *testing.T) {
	preset := func(size string, tier string, width int, height int) CapabilityImageSizePreset {
		return CapabilityImageSizePreset{Size: size, Tier: tier, Ratio: "16:9", Width: width, Height: height}
	}
	product := CapabilitySpec{
		Version:    1,
		Capability: "image",
		ImageSize:  &CapabilityImageSize{Parameter: "aspect_ratio", Presets: []CapabilityImageSizePreset{preset("1824x1024", "1k", 1824, 1024)}},
	}
	routes := []cachedLogicalRoute{
		{Route: model.LogicalModelRoute{Enabled: true, Weight: 1}, CapabilitySpec: CapabilitySpec{ImageSize: &CapabilityImageSize{Presets: []CapabilityImageSizePreset{preset("2752x1536", "2k", 2752, 1536)}}}},
		{Route: model.LogicalModelRoute{Enabled: false, Weight: 1}, CapabilitySpec: CapabilitySpec{ImageSize: &CapabilityImageSize{Presets: []CapabilityImageSizePreset{preset("3840x2160", "4k", 3840, 2160)}}}},
		{Route: model.LogicalModelRoute{Enabled: true, Weight: 0}, CapabilitySpec: CapabilitySpec{ImageSize: &CapabilityImageSize{Presets: []CapabilityImageSizePreset{preset("4096x2304", "4k", 4096, 2304)}}}},
	}

	got := capabilitySpecWithRoutePresets(product, enabledLogicalRouteSpecs(routes))
	if got.ImageSize == nil {
		t.Fatal("imageSize = nil")
	}
	tiers := make(map[string]bool, len(got.ImageSize.Presets))
	for _, item := range got.ImageSize.Presets {
		tiers[item.Tier] = true
	}
	if !tiers["1k"] || !tiers["2k"] {
		t.Fatalf("expected 1k and 2k from enabled routes: %#v", got.ImageSize.Presets)
	}
	if tiers["4k"] {
		t.Fatalf("disabled and zero-weight 4k routes must not appear in public presets: %#v", got.ImageSize.Presets)
	}
}

func TestMatchCapabilityRoutesTextImagesOnlyToDeclaredProfiles(t *testing.T) {
	plainText := CapabilitySpec{
		Version:    1,
		Capability: "text",
		Inputs:     map[string]InputConstraint{"image": {Min: 0, Max: 0}},
	}
	visionText := CapabilitySpec{
		Version:    1,
		Capability: "text",
		Inputs:     map[string]InputConstraint{"image": {Min: 0, Max: 8}},
	}
	intent := ModelRequestIntent{Capability: "text", Inputs: map[string]int{"image": 2}}

	if match := MatchCapability(plainText, intent); match.Matched {
		t.Fatalf("plain text profile unexpectedly matched image input: %#v", match)
	}
	if match := MatchCapability(visionText, intent); !match.Matched {
		t.Fatalf("vision text profile did not match image input: %#v", match)
	}
}

func TestMatchCapabilityAcceptsWildcardOptionValues(t *testing.T) {
	spec := CapabilitySpec{
		Version:    1,
		Capability: "image",
		Options:    map[string]OptionConstraint{"size": {Values: []any{"*"}}},
	}
	intent := ModelRequestIntent{Capability: "image", Options: map[string]any{"size": "1024x1024"}}
	if match := MatchCapability(spec, intent); !match.Matched {
		t.Fatalf("wildcard option did not match custom value: %#v", match)
	}
}

func TestMatchCapabilityAcceptsWildcardAlongsidePresetOptionValues(t *testing.T) {
	intent := ModelRequestIntent{Capability: "image", Options: map[string]any{"size": "2:1"}}
	spec := CapabilitySpec{
		Version:    1,
		Capability: "image",
		Options:    map[string]OptionConstraint{"size": {Values: []any{"1:1", "9:16", "*"}}},
	}
	match := MatchCapability(spec, intent)
	if !match.Matched {
		t.Fatalf("wildcard alongside presets did not match custom value: %#v", match)
	}
}

func TestMatchCapabilityTreatsVideoResolutionSuffixAsEquivalent(t *testing.T) {
	spec := CapabilitySpec{
		Version:    1,
		Capability: "video",
		Options:    map[string]OptionConstraint{"vquality": {Values: []any{"720p"}}},
	}
	intent := ModelRequestIntent{Capability: "video", Options: map[string]any{"vquality": "720"}}
	if match := MatchCapability(spec, intent); !match.Matched {
		t.Fatalf("720 and 720p should match the same video resolution: %#v", match)
	}
}

func TestVideoResolutionAliasesAcrossProductAndPricedRoutes(t *testing.T) {
	product := CapabilitySpec{
		Version: 1, Capability: "video",
		Options: map[string]OptionConstraint{"vquality": {Values: []any{"768P", "2K"}}},
	}
	route := capabilitySpecWithPriceTiers(product, model.ChannelModel{
		PriceTiers: []model.ChannelModelPriceTier{
			{Resolution: "768P", Enabled: true, PriceConfigured: true},
			{Resolution: "2K", Enabled: true, PriceConfigured: true},
		},
	})
	if err := validateProductSpecWithinRoutes(product, []CapabilitySpec{route}); err != nil {
		t.Fatalf("2K product rejected against priced route: %v", err)
	}
	for _, resolution := range []string{"2K", "2k", "1440P", "1440"} {
		intent := ModelRequestIntent{Capability: "video", Options: map[string]any{
			"vquality": normalizeModelRequestOption("vquality", resolution),
		}}
		for name, spec := range map[string]CapabilitySpec{"product": product, "route": route} {
			if match := MatchCapability(spec, intent); !match.Matched {
				t.Errorf("%s rejected %s: %#v", name, resolution, match)
			}
		}
	}
	unsupported := CapabilitySpec{Version: 1, Capability: "video", Options: map[string]OptionConstraint{
		"vquality": {Values: []any{"4K"}},
	}}
	if err := validateProductSpecWithinRoutes(unsupported, []CapabilitySpec{route}); err == nil {
		t.Fatal("2K route accepted unsupported 4K product")
	}
	if capabilityOptionValuesEqual("quality", "2K", "1440p") {
		t.Fatal("video aliases must not affect image quality")
	}
}

func TestValidateProductSpecWithinRoutesRejectsUnsupportedCapabilityValue(t *testing.T) {
	routes := []CapabilitySpec{
		{
			Version:    1,
			Capability: "video",
			Operations: []string{"text_to_video"},
			Options: map[string]OptionConstraint{
				"vquality": {Values: []any{"720p"}},
			},
		},
		{
			Version:    1,
			Capability: "video",
			Operations: []string{"image_to_video"},
			Options: map[string]OptionConstraint{
				"vquality": {Values: []any{"1080p"}},
			},
		},
	}
	product := CapabilitySpec{
		Version:    1,
		Capability: "video",
		Operations: []string{"text_to_video", "image_to_video"},
		Options: map[string]OptionConstraint{
			"vquality": {Values: []any{"720p", "4k"}},
		},
	}

	err := validateProductSpecWithinRoutes(product, routes)
	if err == nil || !strings.Contains(err.Error(), "vquality") {
		t.Fatalf("validateProductSpecWithinRoutes() error = %v", err)
	}
}

func TestValidateProductSpecWithinRoutesPreservesInputRangeCoverage(t *testing.T) {
	routes := []CapabilitySpec{
		{Version: 1, Capability: "image", Inputs: map[string]InputConstraint{"image": {Min: 0, Max: 4}}},
		{Version: 1, Capability: "image", Inputs: map[string]InputConstraint{"image": {Min: 5, Max: 9}}},
	}
	covered := CapabilitySpec{Version: 1, Capability: "image", Inputs: map[string]InputConstraint{"image": {Min: 0, Max: 9}}}
	if err := validateProductSpecWithinRoutes(covered, routes); err != nil {
		t.Fatalf("covered input range rejected: %v", err)
	}

	routes[1].Inputs["image"] = InputConstraint{Min: 6, Max: 9}
	if err := validateProductSpecWithinRoutes(covered, routes); err == nil {
		t.Fatal("input range with an uncovered count was accepted")
	}
}

func TestLogicalModelConfigurationErrorAfterRouteCoverageShrinks(t *testing.T) {
	product := CapabilitySpec{Version: 1, Capability: "image", Inputs: map[string]InputConstraint{"image": {Min: 0, Max: 9}}}
	complete := []CapabilitySpec{
		{Version: 1, Capability: "image", Inputs: map[string]InputConstraint{"image": {Min: 0, Max: 4}}},
		{Version: 1, Capability: "image", Inputs: map[string]InputConstraint{"image": {Min: 5, Max: 9}}},
	}
	if message := logicalModelConfigurationError(product, complete); message != "" {
		t.Fatalf("complete route coverage reported an error: %s", message)
	}
	if message := logicalModelConfigurationError(product, complete[:1]); !strings.Contains(message, "无法完整覆盖") {
		t.Fatalf("shrunk route coverage error = %q", message)
	}
}

func TestLogicalModelAvailabilityErrorRequiresSettlementReadyCoverage(t *testing.T) {
	product := CapabilitySpec{Version: 1, Capability: "image", Inputs: map[string]InputConstraint{"image": {Min: 0, Max: 9}}}
	structural := []CapabilitySpec{
		{Version: 1, Capability: "image", Inputs: map[string]InputConstraint{"image": {Min: 0, Max: 4}}},
		{Version: 1, Capability: "image", Inputs: map[string]InputConstraint{"image": {Min: 5, Max: 9}}},
	}

	if message := logicalModelAvailabilityError("channel", product, structural, nil); !strings.Contains(message, "可结算价格") {
		t.Fatalf("missing settlement route error = %q", message)
	}
	if message := logicalModelAvailabilityError("channel", product, structural, structural[:1]); !strings.Contains(message, "部分创作端能力") {
		t.Fatalf("partial settlement coverage error = %q", message)
	}
	if message := logicalModelAvailabilityError("channel", product, structural, structural); message != "" {
		t.Fatalf("complete settlement coverage error = %q", message)
	}
	if message := logicalModelAvailabilityError("unified", product, structural, nil); message != "" {
		t.Fatalf("unified pricing unexpectedly required channel prices: %q", message)
	}
}

func TestSupportsLogicalModelTokenBillingForArkVideoRoutes(t *testing.T) {
	if !supportsLogicalModelTokenBilling("text", nil) {
		t.Fatal("text logical models should support Token billing")
	}
	if !supportsLogicalModelTokenBilling("video", []model.ChannelInterfaceType{model.ChannelInterfaceVolcengineArkVideo}) {
		t.Fatal("Ark video-only routes should support Token billing")
	}
	if supportsLogicalModelTokenBilling("video", nil) {
		t.Fatal("video logical models without an enabled route must not support Token billing")
	}
	if !supportsLogicalModelTokenBilling("video", []model.ChannelInterfaceType{model.ChannelInterfaceVolcengineArkVideo, model.ChannelInterfaceNewAPIVideo}) {
		t.Fatal("all video protocols must support Token billing")
	}
}

func TestChannelModelCapabilitySpecRequiresExplicitImageCapability(t *testing.T) {
	channelModel := model.ChannelModel{Capability: "image", CapabilityConfigJSON: ""}

	_, err := channelModelCapabilitySpec(channelModel)
	if err == nil || !strings.Contains(err.Error(), "渠道图片模型尚未配置能力参数") {
		t.Fatalf("channelModelCapabilitySpec() error = %v", err)
	}
}
