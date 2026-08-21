package service

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

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
	if supportsLogicalModelTokenBilling("video", []model.ChannelInterfaceType{model.ChannelInterfaceVolcengineArkVideo, model.ChannelInterfaceNewAPIVideo}) {
		t.Fatal("mixed video protocols must not support Token billing")
	}
}

func TestChannelModelCapabilitySpecRequiresExplicitImageCapability(t *testing.T) {
	channelModel := model.ChannelModel{Capability: "image", CapabilityConfigJSON: ""}

	_, err := channelModelCapabilitySpec(channelModel)
	if err == nil || !strings.Contains(err.Error(), "渠道图片模型尚未配置能力参数") {
		t.Fatalf("channelModelCapabilitySpec() error = %v", err)
	}
}
