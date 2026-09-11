package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestTaskInputUsesWorkflowProvider(t *testing.T) {
	tests := []struct {
		name  string
		input map[string]any
		want  bool
	}{
		{name: "runninghub workflow", input: map[string]any{"config": map[string]any{"interfaceType": "runninghub-workflow-video"}}, want: true},
		{name: "comfy bridge", input: map[string]any{"config": map[string]any{"interfaceType": "comfyui-bridge-image"}}, want: true},
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

	routed, resolvedInput, err := (&Service{repo: repository.New(db)}).resolveTaskModelSelection(input, "", "canvas_video", "", true)
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

	routed, resolvedInput, err := (&Service{}).resolveTaskModelSelection(input, "", "canvas_image", "image", true)
	if err != nil {
		t.Fatalf("resolveTaskModelSelection() error = %v", err)
	}
	if routed != nil || resolvedInput["config"] == nil {
		t.Fatalf("resolveTaskModelSelection() routed = %#v, input = %#v", routed, resolvedInput)
	}
}

func TestResolveTaskModelSelectionStillRequiresLogicalModelWithoutExplicitSystemChannel(t *testing.T) {
	_, _, err := (&Service{}).resolveTaskModelSelection(map[string]any{
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
		newSelectionPriceTier("tier-1k", `{"operation":"text_to_image","quality":"1k"}`, "provider-image-1k", "fixed_request"),
		newSelectionPriceTier("tier-2k", `{"operation":"text_to_image","quality":"2k"}`, "provider-image-2k", "fixed_request"),
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
		"capabilityOptions": map[string]any{"quality": "1k", "size": "1:1"},
	}

	resolved, err := svc.resolveSystemChannelModelSelection(input, "canvas_image", "")
	if err != nil {
		t.Fatalf("resolveSystemChannelModelSelection() error = %v", err)
	}
	config := resolved["config"].(map[string]any)
	for _, forbidden := range []string{"baseUrl", "apiKey", "secretKey", "headers", "capabilityConfig"} {
		if _, exists := config[forbidden]; exists {
			t.Fatalf("config[%q] must be removed from a system-channel request: %#v", forbidden, config[forbidden])
		}
	}
	if got := config["quality"]; got != "1k" {
		t.Fatalf("quality = %#v, want capabilityOptions value 1k", got)
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
	if options["quality"] != config["quality"] || options["size"] != config["size"] || options["count"] != config["count"] {
		t.Fatalf("capabilityOptions and provider config diverged: options=%#v config=%#v", options, config)
	}
}

func TestResolveSystemChannelModelSelectionAppliesServerDefaults(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
	svc, _, channel, channelModel := createSystemChannelSelectionFixture(t, "image", model.ChannelInterfaceGrokImage, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("tier-default", `{"operation":"text_to_image","quality":"2k"}`, "provider-image-default", "fixed_request"),
	})

	resolved, err := svc.resolveSystemChannelModelSelection(map[string]any{
		"mode":   "image",
		"config": map[string]any{"channelId": channel.ID, "model": channelModel.ModelKey},
	}, "canvas_image", "")
	if err != nil {
		t.Fatalf("resolveSystemChannelModelSelection() error = %v", err)
	}
	config := resolved["config"].(map[string]any)
	if config["size"] != "1:1" || config["quality"] != "2k" || config["count"] != 1 || config["transparentBackground"] != false {
		t.Fatalf("server defaults were not applied: %#v", config)
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

	resolved, err := svc.resolveSystemChannelModelSelection(map[string]any{
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
			if _, err := svc.resolveSystemChannelModelSelection(test.input, "canvas_image", ""); err == nil {
				t.Fatal("resolveSystemChannelModelSelection() should reject a request outside the server capability contract")
			}
		})
	}

	videoProfile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceNewAPIVideo), "video-model")
	videoSvc, _, videoChannel, videoModel := createSystemChannelSelectionFixture(t, "video", model.ChannelInterfaceNewAPIVideo, videoProfile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("video-tier", `{}`, "provider-video", "per_second"),
	})
	if _, err := videoSvc.resolveSystemChannelModelSelection(map[string]any{
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
	if _, err := svc.resolveSystemChannelModelSelection(map[string]any{
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
