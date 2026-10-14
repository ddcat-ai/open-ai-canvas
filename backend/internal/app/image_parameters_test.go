package app

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func imageParameterTestAdapter(t *testing.T, packageID, providerID string) protocol.Adapter {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", packageID+".yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range adapters {
		if a.Metadata().ID == providerID {
			return a
		}
	}
	t.Fatal("provider missing")
	return nil
}

func TestImageParameterRatioUsesDeclaredPixelPreset(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("openai-image", "GPT Image 2.5")
	profile.Image.Parameters = []protocol.ImageParameter{{
		Name: "size", Label: "画幅 / 尺寸", Type: "string",
		Values: []any{"auto", "1824x1024", "1024x1824", "1024x1024"}, Default: "1824x1024",
		Binding: "aspectRatio", Encoding: "pixels", Pricing: true,
	}}
	profile.Image.Size = ImageSizeConfig{
		Parameter: "size", Values: []string{"auto", "1824x1024", "1024x1824", "1024x1024"}, Default: "1824x1024",
		Presets: []ImageSizePreset{
			{Tier: "1k", Ratio: "16:9", Size: "1824x1024"},
			{Tier: "1k", Ratio: "9:16", Size: "1024x1824"},
			{Tier: "1k", Ratio: "1:1", Size: "1024x1024"},
		},
	}
	if got := imageSizeValueForDeclaredPreset(profile.Image, "16:9", ""); got != "1824x1024" {
		t.Fatalf("ratio was not encoded by the declared preset: %q", got)
	}
	if got := imageSizeValueForDeclaredPreset(profile.Image, "1024x1824", ""); got != "1024x1824" {
		t.Fatalf("pixel preset was not preserved: %q", got)
	}
	values := map[string]any{"size": imageSizeValueForDeclaredPreset(profile.Image, "16:9", "")}
	if _, err := resolveImageParameterValues(profile.Image.Parameters, values); err != nil {
		t.Fatalf("encoded preset was rejected by image parameter admission: %v", err)
	}
	if _, err := resolveImageParameterValues(profile.Image.Parameters, map[string]any{"size": "16:9"}); err == nil || !strings.Contains(err.Error(), "支持值") || !strings.Contains(err.Error(), "imageSize.presets") {
		t.Fatalf("unsupported ratio error lacks actionable correction guidance: %v", err)
	}
}

func TestImageParametersResolutionOnlyAndLogicalReconciliation(t *testing.T) {
	a := imageParameterTestAdapter(t, "google-gemini-image", "gemini-image")
	registry, err := protocol.NewRegistry(a)
	if err != nil {
		t.Fatal(err)
	}
	config := DefaultModelCapabilityConfigForModel("gemini-image", "arbitrary-model")
	config.Image.Quality = ImageQualityConfig{Supported: true, Values: []string{"2k"}, Default: "2k"}
	config.Image.Size.Presets = nil
	resolved, err := NormalizeModelCapabilityConfigForModel("image", "gemini-image", "arbitrary-model", config, registry)
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Image.Quality.Supported || !resolved.Image.Resolution.Supported || resolved.Image.Resolution.Default != "2k" {
		t.Fatalf("resolution contract = %#v", resolved.Image)
	}
	route, err := CapabilitySpecFromModelCapabilityConfig(resolved, "image")
	if err != nil {
		t.Fatal(err)
	}
	old := CapabilitySpec{Version: 1, Capability: "image", Options: map[string]OptionConstraint{"quality": {Values: []any{"2k"}}}}
	current := capabilitySpecWithRoutePresets(old, []CapabilitySpec{route})
	if _, exists := current.Options["quality"]; exists {
		t.Fatal("stale quality leaked into public model")
	}
	if _, exists := current.Options["imageResolution"]; !exists {
		t.Fatal("resolution lost")
	}
	defaults, err := decodeLogicalDefaults(`{"quality":"2k"}`, current)
	if err != nil || defaults["imageResolution"] != "2k" || defaults["quality"] != nil {
		t.Fatalf("defaults = %#v, err=%v", defaults, err)
	}
}

func TestImageParametersAdmissionPricingAndProviderUseSameValues(t *testing.T) {
	minimum, maximum := 0.0, 100.0
	parameters := []protocol.ImageParameter{
		{Name: "imageResolution", Label: "Resolution", Type: "string", Values: []any{"small", "large"}, Default: "small", Pricing: true, Binding: "resolution"},
		{Name: "novelAmount", Label: "Novel amount", Type: "number", Min: &minimum, Max: &maximum, Default: 0, Binding: "providerOptions.example.amount"},
		{Name: "rawMode", Label: "Raw mode", Type: "boolean", Default: false, Binding: "providerOptions.example.raw"},
	}
	profile := DefaultModelCapabilityConfigForModel("example", "model")
	profile.Image.Parameters = parameters
	profile.Image.Size = ImageSizeConfig{Parameter: "none", Default: "auto"}
	if err := projectImageParameters(profile.Image); err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "image")
	if err != nil {
		t.Fatal(err)
	}
	intent := ModelRequestIntent{Capability: "image", Options: map[string]any{"imageResolution": "large", "novelAmount": float64(0), "rawMode": false}}
	if match := MatchCapability(spec, intent); !match.Matched {
		t.Fatal(match.Reasons)
	}
	for _, invalid := range []map[string]any{{"novelAmount": 101}, {"quality": "4k"}, {"rawMode": 0}} {
		if _, err := resolveImageParameterValues(parameters, invalid); err == nil {
			t.Fatalf("invalid values accepted: %#v", invalid)
		}
	}
	if err := validateImageParameterPriceSelector(parameters, map[string]string{"novelAmount": "1"}); err == nil {
		t.Fatal("nonpricing parameter accepted for billing")
	}
	if err := validateImageParameterPriceSelector(parameters, map[string]string{"imageResolution": "large"}); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(profile)
	cm := model.ChannelModel{Capability: "image", Protocol: "example", CapabilityConfigJSON: string(raw), PriceTiers: []model.ChannelModelPriceTier{newSelectionPriceTier("large", `{"imageResolution":"large"}`, "model", "fixed_request")}}
	if tier := channelModelPriceTierForIntent(cm, intent); tier == nil || tier.ID != "large" {
		t.Fatal("typed intent failed price matching")
	}
	request := protocolRequestFromInput(canvasGenerationInput{Mode: "image", Config: providerConfig{Model: "model", InterfaceType: "example", ImageParameters: intent.Options}, Metadata: map[string]any{"providerOptions": map[string]any{"example": map[string]any{"amount": 999}}}})
	request, err = protocol.ApplyImageParameters(request, parameters)
	if err != nil {
		t.Fatal(err)
	}
	if request.Resolution != "large" || request.ProviderOptions["example"]["amount"] != float64(0) || request.ProviderOptions["example"]["raw"] != false {
		t.Fatalf("provider request drifted: %#v", request)
	}
}

func TestImageParametersPublicIntentDoesNotOverwriteEncodedPixelSize(t *testing.T) {
	adapter := imageParameterTestAdapter(t, "openai-images", "openai-image")
	request := protocolRequestFromInput(canvasGenerationInput{Mode: "image", Config: providerConfig{
		Model: "arbitrary-model", InterfaceType: "openai-image", Size: "2496x1664", ImageResolution: "2k", Quality: "max",
		ImageParameters: map[string]any{"size": "3:2", "imageResolution": "2k", "quality": "max"},
	}})
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body, ok := spec.Body.(map[string]any)
	if !ok {
		encoded, _ := json.Marshal(spec.Body)
		_ = json.Unmarshal(encoded, &body)
	}
	if body["size"] != "2496x1664" || body["quality"] != "max" || body["resolution"] != "2k" {
		t.Fatalf("encoded request = %#v", body)
	}
}

func TestImageParametersLegacyChannelUsesLiveContractForRouteAndBilling(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("gemini-image", "opaque-model")
	profile.Image.Quality = ImageQualityConfig{Supported: true, Values: []string{"2k"}, Default: "2k"}
	profile.Image.Resolution = ImageResolutionConfig{}
	svc, db, _, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceGeminiImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("resolution", `{"imageResolution":"2k"}`, "opaque-model", "fixed_request"),
	})
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	stored, err := svc.repo.ChannelModel(channelModel.ID)
	if err != nil {
		t.Fatal(err)
	}
	spec, err := channelModelCapabilitySpec(*stored, svc.protocolRegistry())
	if err != nil {
		t.Fatal(err)
	}
	if imagePriceParametersForChannel(*stored) != nil {
		t.Fatal("fixture must retain legacy persisted config")
	}
	svc.routeCatalogTTL = time.Hour
	svc.routeCatalog = &routeCatalogSnapshot{LoadedAt: time.Now(), Models: map[string]cachedLogicalModel{
		"logical": {Model: model.LogicalModel{ID: "logical", Capability: "image", PricePolicy: "channel"}, ProductSpec: spec, Defaults: imageParameterDefaults(spec.ImageParameters), Routes: []cachedLogicalRoute{
			{Route: model.LogicalModelRoute{ID: "route", Enabled: true, Weight: 1}, CapabilitySpec: spec, ChannelModel: *stored},
		}},
	}}
	routed, err := svc.ResolveLogicalModel("logical", ModelRequestIntent{Capability: "image", Options: map[string]any{"imageResolution": "2k"}})
	if err != nil {
		t.Fatal(err)
	}
	input := applyRoutedProviderSelection(map[string]any{"mode": "image", "config": map[string]any{"quality": "stale", "transparentBackground": "true"}}, routed)
	if err := svc.ValidateTaskCapability(input); err != nil {
		t.Fatal(err)
	}
	config := input["config"].(map[string]any)
	parameters := config["imageParameters"].(map[string]any)
	if parameters["imageResolution"] != "2k" || parameters["quality"] != nil || config["quality"] != "" {
		t.Fatalf("execution projection = %#v", config)
	}
	tier, err := svc.channelModelPriceTierForBilling(*stored, "resolution", "image", routed.Intent)
	if err != nil || tier == nil || tier.ID != routed.PriceTier.ID {
		t.Fatalf("billing projection = %#v, %v", tier, err)
	}
	quote, err := svc.QuoteLogicalModel("logical", ModelRequestIntent{Capability: "image", Options: map[string]any{"imageResolution": "2k"}})
	if err != nil || quote == nil || quote.AmountMicrocredits != tier.UnitPriceMicrocredits {
		t.Fatalf("quote drift: %#v, %v", quote, err)
	}
	if _, err := svc.channelModelPriceTierForBilling(*stored, "resolution", "image", ModelRequestIntent{Capability: "image", Options: map[string]any{"imageResolution": "4k"}}); err == nil {
		t.Fatal("mismatched billing parameters accepted")
	}
}

func TestImageParametersCustomChannelRejectsForgedOrOutOfRangeValues(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("gemini-image", "opaque-model")
	enabled, minimum, maximum := true, 0.0, 2.0
	profile.Image.Parameters = []protocol.ImageParameter{{Name: "temperature", Enabled: &enabled, Min: &minimum, Max: &maximum}}
	svc := &Service{}
	for _, values := range []map[string]any{{"temperature": 3}, {"providerSecret": "value"}, {"temperature": []any{1}}} {
		input := map[string]any{"mode": "image", "config": map[string]any{"interfaceType": "gemini-image", "model": "opaque-model", "capabilityConfig": profile, "imageParameters": values}}
		if err := svc.ValidateTaskCapability(input); err == nil {
			t.Fatalf("invalid values accepted: %#v", values)
		}
	}
}

func TestImageParametersDeclaredResolutionNamesAndPixelsAreNotFixedTiers(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("opaque-provider", "opaque-model")
	profile.Image.Parameters = []protocol.ImageParameter{
		{Name: "size", Label: "Frame", Type: "string", Values: []any{"2:1"}, Default: "2:1", Binding: "aspectRatio", Encoding: "pixels"},
		{Name: "imageResolution", Label: "Resolution", Type: "string", Values: []any{"panorama"}, Default: "panorama", Binding: "resolution"},
	}
	profile.Image.Size.Presets = []ImageSizePreset{{Tier: "panorama", Ratio: "2:1", Width: 8192, Height: 4096, Size: "8192x4096"}}
	if err := projectImageParameters(profile.Image); err != nil {
		t.Fatal(err)
	}
	if err := validateImageCapabilityConfig(profile.Image); err != nil {
		t.Fatal(err)
	}
	config := providerConfig{InterfaceType: "opaque-provider", ImageParameters: map[string]any{"size": "2:1", "imageResolution": "panorama"}}
	if err := applyImageParameterValues(&config, profile.Image); err != nil {
		t.Fatal(err)
	}
	if config.Size != "8192x4096" || config.ImageParameters["size"] != "2:1" {
		t.Fatalf("pixel mapping = %#v", config)
	}
}

func TestImageParametersSaveDifferentRatiosPerResolution(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("opaque-provider", "opaque-model")
	profile.Image.Parameters = []protocol.ImageParameter{
		{Name: "size", Label: "Frame", Type: "string", Values: []any{"1:1", "16:9"}, Default: "1:1", Binding: "aspectRatio", Encoding: "pixels"},
		{Name: "imageResolution", Label: "Resolution", Type: "string", Values: []any{"1k", "2k"}, Default: "1k", Binding: "resolution"},
	}
	profile.Image.Size.Presets = []ImageSizePreset{
		{Tier: "1k", Ratio: "1:1", Width: 1024, Height: 1024, Size: "1024x1024"},
		{Tier: "2k", Ratio: "16:9", Width: 2560, Height: 1440, Size: "2560x1440"},
	}
	if err := projectImageParameters(profile.Image); err != nil {
		t.Fatal(err)
	}
	if err := validateImageSizePresetRequirement("image", "opaque-provider", profile); err != nil {
		t.Fatal(err)
	}
	if err := validateImagePresetSelection(profile.Image, "2k", "1:1"); err == nil {
		t.Fatal("unsupported combination accepted")
	}
	if got := resolveImageTaskSize(profile.Image, "opaque-provider", "16:9", "2k"); got != "2560x1440" {
		t.Fatal(got)
	}
	profile.Image.Size.Presets = profile.Image.Size.Presets[:1]
	if err := validateImageSizePresetRequirement("image", "opaque-provider", profile); err == nil {
		t.Fatal("unmapped ratio accepted")
	}
}

func TestImageParametersPixelSelectionKeepsExactSizeWithoutResolution(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("opaque-provider", "opaque-model")
	profile.Image.Parameters = []protocol.ImageParameter{{Name: "size", Label: "Size", Type: "string", Values: []any{"1024x1024", "2048x2048"}, Default: "1024x1024", Binding: "aspectRatio", Encoding: "pixels"}}
	profile.Image.Size.Presets = []ImageSizePreset{{Tier: "1k", Ratio: "1:1", Width: 1024, Height: 1024, Size: "1024x1024"}, {Tier: "2k", Ratio: "1:1", Width: 2048, Height: 2048, Size: "2048x2048"}}
	if err := projectImageParameters(profile.Image); err != nil {
		t.Fatal(err)
	}
	config := providerConfig{InterfaceType: "opaque-provider", Size: "2048x2048", ImageParameters: map[string]any{"size": "2048x2048"}}
	if err := applyImageParameterValues(&config, profile.Image); err != nil {
		t.Fatal(err)
	}
	if config.Size != "2048x2048" || config.ImageResolution != "" || config.Quality != "" {
		t.Fatalf("unexpected encoding: %#v", config)
	}
}

func TestImageParametersDisabledResolutionUsesDefaultAndPreservesGroups(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("opaque-provider", "opaque-model")
	disabled := false
	profile.Image.Parameters = []protocol.ImageParameter{
		{Name: "size", Label: "Frame", Type: "string", Values: []any{"1:1"}, Default: "1:1", Binding: "aspectRatio", Encoding: "pixels"},
		{Name: "imageResolution", Label: "Resolution", Type: "string", Values: []any{"1k", "2k"}, Default: "2k", Binding: "resolution", Enabled: &disabled},
	}
	profile.Image.Size.DefaultTier = "2k"
	profile.Image.Size.Presets = []ImageSizePreset{{Tier: "1k", Ratio: "1:1", Width: 1024, Height: 1024, Size: "1024x1024"}, {Tier: "2k", Ratio: "1:1", Width: 2048, Height: 2048, Size: "2048x2048"}}
	encoded, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	var reopened ModelCapabilityConfig
	if err := json.Unmarshal(encoded, &reopened); err != nil {
		t.Fatal(err)
	}
	if err := projectImageParameters(reopened.Image); err != nil {
		t.Fatal(err)
	}
	if err := validateImageSizePresetRequirement("image", "opaque-provider", &reopened); err != nil {
		t.Fatal(err)
	}
	config := providerConfig{InterfaceType: "opaque-provider", Size: "1:1"}
	if err := applyImageParameterValues(&config, reopened.Image); err != nil {
		t.Fatal(err)
	}
	if config.Size != "2048x2048" || config.ImageResolution != "" {
		t.Fatalf("disabled resolution changed output: %#v", config)
	}
	if len(reopened.Image.Size.Presets) != 2 || len(activeImageSizePresets(reopened.Image)) != 1 {
		t.Fatal("stored and active presets not separated")
	}
	reopened.Image.Parameters[1].Enabled = nil
	if err := projectImageParameters(reopened.Image); err != nil {
		t.Fatal(err)
	}
	if len(activeImageSizePresets(reopened.Image)) != 2 {
		t.Fatal("enabling lost presets")
	}
}

func TestImageParametersDisabledResolutionRejectsAmbiguousPixels(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("opaque-provider", "opaque-model")
	profile.Image.Parameters = []protocol.ImageParameter{{Name: "size", Label: "Frame", Type: "string", Values: []any{"1:1"}, Default: "1:1", Binding: "aspectRatio", Encoding: "pixels"}}
	profile.Image.Size.Presets = []ImageSizePreset{{Tier: "1k", Ratio: "1:1", Width: 1024, Height: 1024, Size: "1024x1024"}, {Tier: "2k", Ratio: "1:1", Width: 2048, Height: 2048, Size: "2048x2048"}}
	if err := projectImageParameters(profile.Image); err != nil {
		t.Fatal(err)
	}
	if err := validateImageSizePresetRequirement("image", "opaque-provider", profile); err == nil {
		t.Fatal("ambiguous pixels accepted")
	}
	config := providerConfig{InterfaceType: "opaque-provider", Size: "1:1"}
	if err := applyImageParameterValues(&config, profile.Image); err == nil {
		t.Fatal("runtime selected first preset")
	}
}
