package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestWorkbenchKindFromTaskInputRequiresWorkbenchMetadataAndMatchingTaskType(t *testing.T) {
	input := map[string]any{
		"mode":     "image",
		"metadata": map[string]any{"source": "workbench", "workbenchKind": "image"},
	}
	if got := workbenchKindFromTaskInput(input, "canvas_image"); got != model.WorkbenchKindImage {
		t.Fatalf("workbench kind = %q, want image", got)
	}
	if got := workbenchKindFromTaskInput(input, "canvas_video"); got != "" {
		t.Fatalf("mismatched task type was classified as %q", got)
	}
	input["metadata"].(map[string]any)["source"] = "canvas"
	if got := workbenchKindFromTaskInput(input, "canvas_image"); got != "" {
		t.Fatalf("non-workbench task was classified as %q", got)
	}
}

func TestTaskInputUsesWorkflowProvider(t *testing.T) {
	tests := []struct {
		name  string
		input map[string]any
		want  bool
	}{
		{name: "runninghub workflow", input: map[string]any{"config": map[string]any{"interfaceType": "runninghub-workflow-video"}}, want: true},
		{name: "case insensitive", input: map[string]any{"config": map[string]any{"interfaceType": "RunningHub-Workflow-Audio"}}, want: true},
		{name: "ordinary model", input: map[string]any{"config": map[string]any{"interfaceType": "openai-image", "channelId": "system-1", "model": "image-model"}}, want: false},
		{name: "missing config", input: map[string]any{}, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := taskInputUsesWorkflowProvider(test.input); got != test.want {
				t.Fatalf("taskInputUsesWorkflowProvider() = %v, want %v", got, test.want)
			}
			if test.want && taskInputUsesCustomChannel(test.input) {
				t.Fatal("workflow input must not be classified as a custom channel")
			}
		})
	}
}

func TestResolveTaskModelSelectionAllowsExplicitSystemChannelWhenFrontendModelsEnabled(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}); err != nil {
		t.Fatal(err)
	}
	ensureTestUsers(t, db)
	channel := model.ModelChannel{ID: "channel-1", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Agnes"}
	capabilityJSON, err := json.Marshal(DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceNewAPIVideo), "agnes-video-2.5"))
	if err != nil {
		t.Fatal(err)
	}
	channelModel := model.ChannelModel{
		ID: "channel-model-1", ChannelID: channel.ID, ModelKey: "agnes-video-2.5", Capability: "video",
		Protocol: model.ChannelInterfaceNewAPIVideo, BillingMode: "per_second", PriceConfigured: true, Enabled: true,
		CapabilityConfigJSON: string(capabilityJSON),
	}
	priceTier := model.ChannelModelPriceTier{
		ID: "tier-1", ChannelModelID: channelModel.ID, SelectorKey: `{}`, SelectorJSON: `{}`,
		BillingMode: "per_second", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&priceTier).Error; err != nil {
		t.Fatal(err)
	}
	input, err := normalizeTaskInput(map[string]any{
		"mode":   "video",
		"config": providerConfig{ChannelID: channel.ID, Model: channelModel.ModelKey, InterfaceType: string(channelModel.Protocol)},
	})
	if err != nil {
		t.Fatal(err)
	}

	selectionSvc := &Service{repo: repository.New(db)}
	routed, resolvedInput, err := selectionSvc.resolveTaskModelSelection(testGroupUserID(selectionSvc), input, "", "canvas_video", "", true)
	if err != nil {
		t.Fatalf("resolveTaskModelSelection() error = %v", err)
	}
	if routed != nil || resolvedInput["config"] == nil {
		t.Fatalf("resolveTaskModelSelection() routed = %#v, input = %#v", routed, resolvedInput)
	}
}

func TestResolveTaskModelSelectionAllowsCustomImageChannelWhenFrontendModelsEnabled(t *testing.T) {
	input := map[string]any{
		"mode": "image",
		"config": map[string]any{
			"baseUrl":       "https://images.example.com/v1",
			"apiKey":        "custom-key",
			"interfaceType": "openai-image",
			"model":         "custom-image-model",
		},
	}

	routed, resolvedInput, err := (&Service{}).resolveTaskModelSelection("", input, "", "canvas_image", "image", true)
	if err != nil {
		t.Fatalf("resolveTaskModelSelection() error = %v", err)
	}
	if routed != nil || resolvedInput["config"] == nil {
		t.Fatalf("resolveTaskModelSelection() routed = %#v, input = %#v", routed, resolvedInput)
	}
}

func TestResolveTaskModelSelectionStillRequiresLogicalModelWithoutExplicitSystemChannel(t *testing.T) {
	_, _, err := (&Service{}).resolveTaskModelSelection("", map[string]any{
		"mode":   "video",
		"config": map[string]any{"model": "agnes-video-2.5"},
	}, "", "canvas_video", "", true)
	if err == nil || !strings.Contains(err.Error(), "logicalModelId") {
		t.Fatalf("resolveTaskModelSelection() error = %v, want logicalModelId validation", err)
	}
}

func TestResolveSystemChannelModelSelectionRebuildsAuthoritativeExecutionSpec(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceGrokImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-1k", `{"operation":"text_to_image","imageResolution":"1k"}`, "provider-image-1k", "fixed_request"),
		newSelectionPriceTier("tier-2k", `{"operation":"text_to_image","imageResolution":"2k"}`, "provider-image-2k", "fixed_request"),
	})

	input := map[string]any{
		"mode": "image",
		"config": map[string]any{
			"channelId":        channel.ID,
			"model":            channelModel.ModelKey,
			"quality":          "2k",
			"priceTierId":      "client-tier",
			"providerModelKey": "client-provider-model",
			"interfaceType":    "runninghub-workflow-image",
			"apiFormat":        "client-format",
			"baseUrl":          "https://attacker.invalid/v1",
			"apiKey":           "client-api-key",
			"secretKey":        "client-secret",
			"headers":          []any{map[string]any{"name": "Authorization", "value": "client-token"}},
			"capabilityConfig": map[string]any{"image": map[string]any{"maxOutputs": 99}},
		},
		// capabilityOptions 是创作端表达的最终规格，必须覆盖旧页面缓存到 config 的同名值。
		"capabilityOptions": map[string]any{"imageResolution": "1k", "size": "1:1"},
	}

	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_image", "")
	if err != nil {
		t.Fatalf("resolveSystemChannelModelSelection() error = %v", err)
	}
	config := resolved["config"].(map[string]any)
	for _, forbidden := range []string{"baseUrl", "apiKey", "secretKey", "headers", "capabilityConfig"} {
		if _, exists := config[forbidden]; exists {
			t.Fatalf("config[%q] must be removed from a system-channel request: %#v", forbidden, config[forbidden])
		}
	}
	if got := config["imageResolution"]; got != "1k" {
		t.Fatalf("imageResolution = %#v, want capabilityOptions value 1k", got)
	}
	if got := config["priceTierId"]; got != "tier-1k" {
		t.Fatalf("priceTierId = %#v, want server-selected tier-1k", got)
	}
	if got := config["providerModelKey"]; got != "provider-image-1k" {
		t.Fatalf("providerModelKey = %#v, want server-selected provider-image-1k", got)
	}
	if got := config["interfaceType"]; got != string(model.ChannelInterfaceGrokImage) {
		t.Fatalf("interfaceType = %#v, want %q", got, model.ChannelInterfaceGrokImage)
	}
	if got := config["apiFormat"]; got != "openai" {
		t.Fatalf("apiFormat = %#v, want openai", got)
	}
	options := resolved["capabilityOptions"].(map[string]any)
	if options["imageResolution"] != config["imageResolution"] || options["size"] != config["size"] || providerConfigOptionValue(options["count"]) != config["count"] {
		t.Fatalf("capabilityOptions and provider config diverged: options=%#v config=%#v", options, config)
	}
}

func TestResolveSystemChannelModelSelectionPricesImageResolutionAndQualityIndependently(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2")
	profile.Image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"1k", "2k"}, Default: "1k"}
	profile.Image.Quality = ImageQualityConfig{Supported: true, Values: []string{"high", "max"}, Default: "high"}
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("2k-max", `{"operation":"text_to_image","imageResolution":"2k","quality":"max"}`, "provider-2k-max", "fixed_request"),
	})

	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), map[string]any{
		"mode":   "image",
		"config": map[string]any{"channelId": channel.ID, "model": channelModel.ModelKey, "imageResolution": "2k", "quality": "max", "size": "1:1"},
	}, "canvas_image", "")
	if err != nil {
		t.Fatalf("resolveSystemChannelModelSelection() error = %v", err)
	}
	config := resolved["config"].(map[string]any)
	if config["priceTierId"] != "2k-max" || config["imageResolution"] != "2k" || config["quality"] != "max" {
		t.Fatalf("resolved request = %#v, want exact 2k-max tier and independent options", config)
	}
	options := resolved["capabilityOptions"].(map[string]any)
	if options["imageResolution"] != "2k" || options["quality"] != "max" {
		t.Fatalf("capabilityOptions = %#v, want independent imageResolution/quality", options)
	}
}

func TestResolveSystemChannelModelSelectionImportsLegacyGrokResolutionWithCanonicalPrice(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
	profile.Image.Resolution = ImageResolutionConfig{}
	profile.Image.Quality = ImageQualityConfig{Supported: true, Values: []string{"1k", "2k"}, Default: "2k"}
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceGrokImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("legacy-2k", `{"imageResolution":"2k"}`, "provider-2k", "fixed_request"),
	})

	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), map[string]any{
		"mode":   "image",
		"config": map[string]any{"channelId": channel.ID, "model": channelModel.ModelKey, "quality": "2k", "size": "16:9"},
	}, "canvas_image", "")
	if err != nil {
		t.Fatalf("legacy request was rejected: %v", err)
	}
	config := resolved["config"].(map[string]any)
	if config["imageResolution"] != "2k" || config["quality"] != nil || config["priceTierId"] != "legacy-2k" || config["providerModelKey"] != "provider-2k" {
		t.Fatalf("legacy request did not preserve its execution and pricing semantics: %#v", config)
	}
	if channelModel.CapabilityConfigJSON == "" || !strings.Contains(channelModel.CapabilityConfigJSON, `"quality":{"supported":true`) {
		t.Fatal("fixture did not retain the persisted legacy capability JSON")
	}
}

func TestResolveSystemChannelModelSelectionMatchesMiniMax768PTier(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceMiniMaxVideo), "MiniMax-H3")
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "video", model.ChannelInterfaceMiniMaxVideo, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-768p", `{"vquality":"768p"}`, "MiniMax-H3", "per_second"),
		newSelectionPriceTier("tier-2k", `{"vquality":"1440p"}`, "MiniMax-H3", "per_second"),
	})

	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), map[string]any{
		"mode":            "video",
		"referenceImages": []any{map[string]any{"storageKey": "resource:test"}},
		"config": map[string]any{
			"channelId":    channel.ID,
			"model":        channelModel.ModelKey,
			"vquality":     "768",
			"videoSeconds": "15",
		},
	}, "canvas_video", "image_to_video")
	if err != nil {
		t.Fatalf("resolveSystemChannelModelSelection() error = %v", err)
	}
	config := resolved["config"].(map[string]any)
	if config["priceTierId"] != "tier-768p" {
		t.Fatalf("priceTierId = %#v, want tier-768p", config["priceTierId"])
	}
	if config["vquality"] != "768" {
		t.Fatalf("execution vquality = %#v, want original provider-facing value 768", config["vquality"])
	}
}

func TestResolveSystemChannelModelSelectionAppliesServerDefaults(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceGrokImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-default", `{"operation":"text_to_image","imageResolution":"2k"}`, "provider-image-default", "fixed_request"),
	})

	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), map[string]any{
		"mode":   "image",
		"config": map[string]any{"channelId": channel.ID, "model": channelModel.ModelKey},
	}, "canvas_image", "")
	if err != nil {
		t.Fatalf("resolveSystemChannelModelSelection() error = %v", err)
	}
	config := resolved["config"].(map[string]any)
	if config["size"] != "1:1" || config["imageResolution"] != "2k" || config["quality"] != nil || config["count"] != "1" || config["transparentBackground"] != nil {
		t.Fatalf("server defaults were not applied: %#v", config)
	}
	encoded, err := json.Marshal(resolved)
	if err != nil {
		t.Fatal(err)
	}
	var executable canvasGenerationInput
	if err := json.Unmarshal(encoded, &executable); err != nil {
		t.Fatalf("server defaults cannot be decoded by provider: %v", err)
	}
	if config["priceTierId"] != "tier-default" || config["providerModelKey"] != "provider-image-default" {
		t.Fatalf("server price selection was not persisted: %#v", config)
	}
}

func TestResolveSystemChannelModelSelectionIgnoresStaleQualityWhenQualityIsUnsupported(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGeminiImage), "nano-banana-pro")
	profile.Image.Quality = ImageQualityConfig{Supported: false, Default: "auto"}
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceGeminiImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-any", `{}`, "provider-image", "fixed_request"),
	})

	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), map[string]any{
		"mode": "image",
		"config": map[string]any{
			"channelId": channel.ID,
			"model":     channelModel.ModelKey,
			// This value can survive when the user switches from a model that
			// supported quality to one that does not.
			"quality": "high",
			"size":    "16:9",
		},
	}, "canvas_image", "")
	if err != nil {
		t.Fatalf("resolveSystemChannelModelSelection() error = %v", err)
	}
	options, ok := resolved["capabilityOptions"].(map[string]any)
	if !ok {
		t.Fatalf("capabilityOptions = %#v, want object", resolved["capabilityOptions"])
	}
	if _, exists := options["quality"]; exists {
		t.Fatalf("stale unsupported quality must not enter capabilityOptions: %#v", options)
	}
}

func TestResolveSystemChannelModelSelectionRejectsUnsupportedRequest(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceGrokImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-any", `{}`, "provider-image", "fixed_request"),
	})

	tests := []struct {
		name  string
		input map[string]any
	}{
		{
			name: "too many reference images",
			input: map[string]any{
				"mode": "image", "referenceImages": []any{"a", "b"},
				"config": map[string]any{"channelId": channel.ID, "model": channelModel.ModelKey},
			},
		},
		{
			name: "unsupported quality",
			input: map[string]any{
				"mode": "image", "config": map[string]any{"channelId": channel.ID, "model": channelModel.ModelKey},
				"capabilityOptions": map[string]any{"quality": "4k", "size": "1:1"},
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), test.input, "canvas_image", ""); err == nil {
				t.Fatal("resolveSystemChannelModelSelection() should reject a request outside the server capability contract")
			}
		})
	}

	videoProfile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceNewAPIVideo), "video-model")
	videoSvc, _, videoChannel, videoModel := createSystemChannelSelectionFixture(t, "video", model.ChannelInterfaceNewAPIVideo, videoProfile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("video-tier", `{}`, "provider-video", "per_second"),
	})
	if _, err := videoSvc.resolveSystemChannelModelSelection(testGroupAccess(videoSvc), map[string]any{
		"mode":   "video",
		"config": map[string]any{"channelId": videoChannel.ID, "model": videoModel.ModelKey},
	}, "canvas_video", "audio_to_video"); err == nil {
		t.Fatal("resolveSystemChannelModelSelection() should reject an unsupported operation")
	}
}

func TestResolveSystemChannelModelSelectionRejectsCorruptCapabilityConfig(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
	svc, db, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceGrokImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-any", `{}`, "provider-image", "fixed_request"),
	})
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", channelModel.ID).Update("capability_config_json", "{").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), map[string]any{
		"mode":   "image",
		"config": map[string]any{"channelId": channel.ID, "model": channelModel.ModelKey},
	}, "canvas_image", ""); err == nil {
		t.Fatal("resolveSystemChannelModelSelection() should fail closed for corrupt persisted capability config")
	}
}

func createSystemChannelSelectionFixture(t *testing.T, capability string, protocol model.ChannelInterfaceType, profile *ModelCapabilityConfig, tiers []model.ChannelModelPriceTier) (*Service, *gorm.DB, model.ModelChannel, model.ChannelModel) {
	t.Helper()
	svc, db := newChannelModelTestService(t)
	channel := model.ModelChannel{ID: newID(), Scope: model.ChannelScopeSystem, Enabled: true, Name: "System Channel", APIFormat: "legacy"}
	capabilityJSON, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	channelModel := model.ChannelModel{
		ID: newID(), ChannelID: channel.ID, ModelKey: capability + "-model", ProviderModelKey: "provider-default",
		Capability: capability, Protocol: protocol, Enabled: true, CapabilityConfigJSON: string(capabilityJSON),
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	for index := range tiers {
		tiers[index].ChannelModelID = channelModel.ID
		if err := db.Create(&tiers[index]).Error; err != nil {
			t.Fatal(err)
		}
	}
	return svc, db, channel, channelModel
}

func newSelectionPriceTier(id string, selector string, providerModelKey string, billingMode string) model.ChannelModelPriceTier {
	return model.ChannelModelPriceTier{
		ID: id, SelectorKey: selector, SelectorJSON: selector, ProviderModelKey: providerModelKey,
		BillingMode: billingMode, UnitPriceMicrocredits: 10, PriceConfigured: true, Enabled: true,
	}
}

func TestImageResolutionPricingOnSystemChannel(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGeminiImage), "gemini-image-model")
	profile.Image.Quality = ImageQualityConfig{Supported: false, Default: "auto"}
	profile.Image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"1k", "2k", "4k"}, Default: "1k"}
	profile.Image.Size = ImageSizeConfig{
		Parameter: "aspect_ratio",
		Values:    []string{"1:1", "16:9"},
		Default:   "16:9",
		Presets: []ImageSizePreset{
			{Tier: "1k", Ratio: "16:9", Size: "1824x1024", Width: 1824, Height: 1024},
			{Tier: "2k", Ratio: "16:9", Size: "2752x1536", Width: 2752, Height: 1536},
			{Tier: "4k", Ratio: "16:9", Size: "3840x2160", Width: 3840, Height: 2160},
		},
	}
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceGeminiImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-1k", `{"imageResolution":"1k"}`, "provider-1k", "fixed_request"),
		newSelectionPriceTier("tier-2k", `{"imageResolution":"2k"}`, "provider-2k", "fixed_request"),
		newSelectionPriceTier("tier-4k", `{"imageResolution":"4k"}`, "provider-4k", "fixed_request"),
	})

	for _, tc := range []struct {
		name     string
		quality  string
		size     string
		wantTier string
	}{
		{"1k specified", "1k", "16:9", "tier-1k"},
		{"2k specified", "2k", "16:9", "tier-2k"},
		{"4k specified", "4k", "16:9", "tier-4k"},
		{"empty specified", "", "16:9", "tier-1k"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := map[string]any{
				"mode": "image",
				"config": map[string]any{
					"channelId":       channel.ID,
					"model":           channelModel.ModelKey,
					"size":            tc.size,
					"imageResolution": tc.quality,
				},
			}
			resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_image", "")
			if err != nil {
				t.Fatalf("resolve error: %v", err)
			}
			cfg := resolved["config"].(map[string]any)
			if cfg["priceTierId"] != tc.wantTier {
				t.Fatalf("priceTierId = %#v, want %s", cfg["priceTierId"], tc.wantTier)
			}
		})
	}
}

func TestParameterizedOpenAIAspectPresetSystemChannelPersistsPixelExecutionSize(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "GPT Image 2.5")
	profile.Image.Parameters = []protocol.ImageParameter{{
		Name: "size", Label: "画幅 / 尺寸", Type: "string",
		Values: []any{"auto", "1824x1024", "1024x1824", "1024x1024"}, Default: "1824x1024",
		Pricing: true, Binding: "aspectRatio", Encoding: "pixels",
	}}
	profile.Image.Size = ImageSizeConfig{
		Parameter: "size", Values: []string{"auto", "1824x1024", "1024x1824", "1024x1024"}, Default: "1824x1024",
		Presets: []ImageSizePreset{
			{Tier: "1k", Ratio: "16:9", Size: "1824x1024", Width: 1824, Height: 1024},
			{Tier: "1k", Ratio: "9:16", Size: "1024x1824", Width: 1024, Height: 1824},
			{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024},
		},
	}
	if err := projectImageParameters(profile.Image); err != nil {
		t.Fatal(err)
	}
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-1k", `{"size":"1824x1024"}`, "provider-1k", "fixed_request"),
	})
	input := map[string]any{
		"mode": "image",
		"config": map[string]any{
			"channelId":       channel.ID,
			"model":           channelModel.ModelKey,
			"imageParameters": map[string]any{"size": "16:9"},
		},
	}
	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_image", "")
	if err != nil {
		t.Fatalf("resolve error = %v", err)
	}
	config := resolved["config"].(map[string]any)
	parameters := config["imageParameters"].(map[string]any)
	if parameters["size"] != "1824x1024" || config["size"] != "1824x1024" {
		t.Fatalf("parameterized size = %#v, config = %#v", parameters["size"], config["size"])
	}
}

func TestParameterizedOpenAIPixelSizeSelectionAcceptsDeclaredSizeAndResolution(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "GPT Image 2.5")
	minCount, maxCount := 1.0, 5.0
	profile.Image.Parameters = []protocol.ImageParameter{
		{
			Name: "size", Label: "画幅 / 尺寸", Type: "string",
			Values: []any{"auto", "1824x1024", "2752x1536", "3840x2160"}, Default: "1824x1024",
			Pricing: true, Binding: "aspectRatio", Encoding: "pixels",
		},
		{
			Name: "imageResolution", Label: "分辨率", Type: "string",
			Values: []any{"1k", "2k", "4k"}, Default: "1k", Pricing: true, Binding: "resolution",
		},
		{Name: "count", Label: "生成数量", Type: "integer", Min: &minCount, Max: &maxCount, Default: 1, Pricing: true, Binding: "imageCount"},
		{Name: "transparentBackground", Label: "透明背景", Type: "boolean", Default: false, Binding: "transparentBackground"},
	}
	profile.Image.Size = ImageSizeConfig{
		Parameter: "size", Values: []string{"auto", "1824x1024", "2752x1536", "3840x2160"}, Default: "1824x1024",
		Presets: []ImageSizePreset{
			{Tier: "1k", Ratio: "16:9", Size: "1824x1024", Width: 1824, Height: 1024},
			{Tier: "2k", Ratio: "16:9", Size: "2752x1536", Width: 2752, Height: 1536},
			{Tier: "4k", Ratio: "16:9", Size: "3840x2160", Width: 3840, Height: 2160},
		},
	}
	if err := projectImageParameters(profile.Image); err != nil {
		t.Fatal(err)
	}
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-1k", `{"imageResolution":"1k"}`, "provider-1k", "fixed_request"),
		newSelectionPriceTier("tier-2k", `{"imageResolution":"2k"}`, "provider-2k", "fixed_request"),
		newSelectionPriceTier("tier-4k", `{"imageResolution":"4k"}`, "provider-4k", "fixed_request"),
	})
	input := map[string]any{
		"mode": "image",
		"config": map[string]any{
			"channelId": channel.ID, "model": channelModel.ModelKey,
			"size": "1824x1024", "imageResolution": "1k",
			"imageParameters": map[string]any{"size": "1824x1024", "imageResolution": "1k", "count": 1, "transparentBackground": false},
		},
	}
	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_image", "")
	if err != nil {
		t.Fatalf("resolve error = %v", err)
	}
	config := resolved["config"].(map[string]any)
	parameters := config["imageParameters"].(map[string]any)
	if parameters["size"] != "1824x1024" || parameters["imageResolution"] != "1k" || config["priceTierId"] != "tier-1k" {
		t.Fatalf("resolved parameters = %#v, config = %#v", parameters, config)
	}
}

func TestOpenAIAspectPresetSystemChannelPersistsPixelExecutionSize(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2.5-4k")
	profile.Image.Size = ImageSizeConfig{
		Parameter: "aspect_ratio",
		Values:    []string{"1:1", "9:16"},
		Default:   "1:1",
		Presets: []ImageSizePreset{
			{Tier: "2k", Ratio: "1:1", Size: "2048x2048", Width: 2048, Height: 2048},
			{Tier: "2k", Ratio: "9:16", Size: "1536x2752", Width: 1536, Height: 2752},
			{Tier: "4k", Ratio: "1:1", Size: "2880x2880", Width: 2880, Height: 2880},
			{Tier: "4k", Ratio: "9:16", Size: "2160x3840", Width: 2160, Height: 3840},
		},
	}
	profile.Image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"2k", "4k"}, Default: "2k"}
	profile.Image.Quality = ImageQualityConfig{Supported: false}
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-2k", `{"imageResolution":"2k"}`, "provider-2k", "fixed_request"),
		newSelectionPriceTier("tier-4k", `{"imageResolution":"4k"}`, "provider-4k", "fixed_request"),
	})
	input := map[string]any{
		"mode": "image",
		"config": map[string]any{
			"channelId":       channel.ID,
			"model":           channelModel.ModelKey,
			"size":            "9:16",
			"imageResolution": "2k",
		},
	}
	resolved, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), input, "canvas_image", "")
	if err != nil {
		t.Fatalf("resolve error: %v", err)
	}
	if err := svc.ValidateTaskCapability(resolved); err != nil {
		t.Fatalf("ValidateTaskCapability() error = %v", err)
	}
	cfg := resolved["config"].(map[string]any)
	if cfg["priceTierId"] != "tier-2k" {
		t.Fatalf("priceTierId = %#v, want tier-2k", cfg["priceTierId"])
	}
	if cfg["size"] != "1536x2752" {
		t.Fatalf("config.size = %#v, want 1536x2752", cfg["size"])
	}
}

// 受管逻辑模型流程的客户端只表达创作参数：config 里没有 interfaceType。协议必须由
// 服务端路由记录回填，否则比例型 size 不会换算成像素，只认 WIDTHxHEIGHT 的上游会
// 直接拒绝（线上表现为创建成功但生成 400 失败）。
func TestRoutedLogicalImageTaskWithoutClientInterfaceTypePersistsPixelSize(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "gpt-image-2.5-4k")
	profile.Image.Size = ImageSizeConfig{
		Parameter: "aspect_ratio",
		Values:    []string{"1:1", "9:16"},
		Default:   "1:1",
		Presets: []ImageSizePreset{
			{Tier: "2k", Ratio: "1:1", Size: "2048x2048", Width: 2048, Height: 2048},
			{Tier: "2k", Ratio: "9:16", Size: "1536x2752", Width: 1536, Height: 2752},
		},
	}
	profile.Image.Quality = ImageQualityConfig{Supported: true, Values: []string{"2k"}, Default: "2k"}
	svc, _, _, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceOpenAIImage, profile, nil)
	tier := newSelectionPriceTier("tier-2k", `{"quality":"2k"}`, "provider-2k", "fixed_request")
	tier.ChannelModelID = channelModel.ID
	routed := &RoutedModel{ChannelModel: channelModel, PriceTier: &tier}

	input := map[string]any{
		"mode":   "image",
		"prompt": "A simple gray circle on a white background.",
		"config": map[string]any{
			"channelId": channelModel.ChannelID,
			"model":     channelModel.ModelKey,
			"size":      "9:16",
			"quality":   "2k",
		},
	}
	resolved := applyRoutedProviderSelection(input, routed)
	cfg := resolved["config"].(map[string]any)
	if cfg["interfaceType"] != string(model.ChannelInterfaceOpenAIImage) {
		t.Fatalf("config.interfaceType = %#v, want %s", cfg["interfaceType"], model.ChannelInterfaceOpenAIImage)
	}
	if err := svc.ValidateTaskCapability(resolved); err != nil {
		t.Fatalf("ValidateTaskCapability() error = %v", err)
	}
	if cfg["size"] != "1536x2752" {
		t.Fatalf("config.size = %#v, want 1536x2752", cfg["size"])
	}
}
