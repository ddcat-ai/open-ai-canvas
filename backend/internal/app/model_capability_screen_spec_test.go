package app

import (
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func autoDLProfile(t *testing.T, subset bool) *ModelCapabilityConfig {
	t.Helper()
	profile := DefaultModelCapabilityConfigForModel("autodl-comfyui", "minimax_h3_zm_u24")
	profile.Video.Resolutions = []string{"480p竖", "768p竖", "480p横", "768p横", "480p(1:1)", "768p(1:1)"}
	profile.Video.DefaultResolution = "768p竖"
	if subset {
		profile.Video.Resolutions = []string{"480p横", "768p(1:1)"}
		profile.Video.DefaultResolution = "768p(1:1)"
	}
	return profile
}

func normalizeAutoDLProfile(t *testing.T, profile *ModelCapabilityConfig, name string) *ModelCapabilityConfig {
	t.Helper()
	result, err := NormalizeModelCapabilityConfigForModel("video", "autodl-comfyui", name, profile)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestAutoDLScreenSpecIgnoresRemovedSwitchAndDraft(t *testing.T) {
	for _, oldEnabled := range []bool{false, true} {
		data, _ := json.Marshal(autoDLProfile(t, false))
		var raw map[string]any
		if err := json.Unmarshal(data, &raw); err != nil {
			t.Fatal(err)
		}
		video := raw["video"].(map[string]any)
		video["customSizeEnabled"] = oldEnabled
		video["customScreenSpec"] = map[string]any{"resolutions": []string{"invalid"}, "defaultResolution": "invalid"}
		video["fixedScreenSpec"] = map[string]any{"resolutions": []string{"forged"}, "defaultResolution": "forged"}
		data, _ = json.Marshal(raw)
		profile, err := DecodeModelCapabilityConfig(string(data))
		if err != nil {
			t.Fatal(err)
		}
		result := normalizeAutoDLProfile(t, profile, "minimax_h3_zm_u24")
		if result.Video.DefaultResolution != "768p竖" || len(result.Video.Resolutions) != 6 || len(result.Video.Ratios) != 0 || result.Video.DefaultRatio != "" || len(result.Video.FixedScreenSpec.Resolutions) != 6 {
			t.Fatalf("selected spec = %#v", result.Video)
		}
		if !reflect.DeepEqual(result.Video.References, profile.Video.References) || !reflect.DeepEqual(result.Video.Duration, profile.Video.Duration) || !reflect.DeepEqual(result.Video.Operations, profile.Video.Operations) {
			t.Fatal("screen-spec normalization changed unrelated parameters")
		}
		data, _ = json.Marshal(result)
		if strings.Contains(string(data), "customSizeEnabled") || strings.Contains(string(data), "customScreenSpec") {
			t.Fatalf("removed fields remain in saved JSON: %s", data)
		}
		if profile.Video.DefaultRatio != "16:9" || profile.Video.FixedScreenSpec.DefaultResolution != "forged" {
			t.Fatal("normalization mutated the original profile")
		}
	}
}

func TestAutoDLScreenSpecSelectedValuesSurviveJSONReload(t *testing.T) {
	profile := autoDLProfile(t, true)
	profile.Video.Resolutions = []string{" 480p横 ", "768p(1:1)", "480P横", ""}
	profile.Video.DefaultResolution = " 768P(1:1) "
	selected := normalizeAutoDLProfile(t, profile, "minimax_h3_zm_u24")
	loaded, err := DecodeModelCapabilityConfig(mustEncodeModelCapabilityConfig(t, selected))
	if err != nil {
		t.Fatal(err)
	}
	restored := normalizeAutoDLProfile(t, loaded, "minimax_h3_zm_u24")
	if !reflect.DeepEqual(restored.Video.Resolutions, []string{"480p横", "768p(1:1)"}) || restored.Video.DefaultResolution != "768p(1:1)" {
		t.Fatalf("restored selected spec = %#v", restored.Video)
	}
}

func TestAutoDLScreenSpecRejectsInvalidSelectionsAndUnknownWorkflow(t *testing.T) {
	for _, values := range [][]string{nil, {"480p横"}, {"480p横", "768p(1:1)", "1080p横"}} {
		profile := autoDLProfile(t, true)
		profile.Video.Resolutions = values
		if _, err := NormalizeModelCapabilityConfigForModel("video", "autodl-comfyui", "minimax_h3_zm_u24", profile); err == nil {
			t.Fatal("invalid selection or default was accepted")
		}
	}
	if _, err := NormalizeModelCapabilityConfigForModel("video", "autodl-comfyui", "unknown", autoDLProfile(t, false)); err == nil {
		t.Fatal("unknown workflow invented preset values")
	}
}

func TestAutoDLScreenSpecUsesEachPackagedWorkflowExactly(t *testing.T) {
	dir, err := officialPluginPackageDir()
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := inspectOfficialPluginPackage(filepath.Join(dir, "autodl-comfyui.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	for _, workflow := range pkg.info.Manifest.Contributes.Workflows {
		t.Run(workflow.ID, func(t *testing.T) {
			for _, parameter := range workflow.Parameters {
				if parameter.Name == "resolution" {
					input := autoDLProfile(t, false)
					input.Video.Resolutions = parameter.Values
					input.Video.DefaultResolution = workflow.Defaults[parameter.Name].(string)
					profile := normalizeAutoDLProfile(t, input, workflow.ID)
					if !reflect.DeepEqual(profile.Video.Resolutions, parameter.Values) || profile.Video.DefaultResolution != workflow.Defaults[parameter.Name] {
						t.Fatalf("workflow contract mismatch: %#v", profile.Video)
					}
				}
			}
		})
	}
}

func TestAutoDLScreenSpecSubmissionUsesSameValueAsValidation(t *testing.T) {
	adapter, ok := loadOfficialFallbackRegistry().Resolve("autodl-comfyui")
	if !ok {
		t.Fatal("AutoDL adapter missing")
	}
	for _, subset := range []bool{false, true} {
		profile := normalizeAutoDLProfile(t, autoDLProfile(t, subset), "minimax_h3_zm_u24")
		input := canvasGenerationInput{Mode: "video", Prompt: "test", VideoCapability: profile.Video, Config: providerConfig{InterfaceType: "autodl-comfyui", Model: "minimax_h3_zm_u24", Size: "16:9", VQuality: "auto", VideoSeconds: "6"}}
		applyAutoDLVideoScreenSpec(&input, profile.Video)
		if err := validateVideoTask(profile.Video, input); err != nil {
			t.Fatal(err)
		}
		request := protocolRequestFromInput(input)
		spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
		if err != nil {
			t.Fatal(err)
		}
		body := spec.Body.(map[string]any)
		if body["resolution"] != profile.Video.DefaultResolution || body["resolution"] != input.Config.VQuality || request.AspectRatio != "" || body["duration"] != 6 {
			t.Fatalf("validated input and actual request differ: %#v, %#v", input.Config, body)
		}
		if _, exists := body["aspect_ratio"]; exists {
			t.Fatal("unsupported independent aspect ratio was sent")
		}
		input.Config.VQuality = "unsupported"
		applyAutoDLVideoScreenSpec(&input, profile.Video)
		if validateVideoTask(profile.Video, input) == nil {
			t.Fatal("accepted an undeclared explicit request value")
		}
	}
}

func TestAutoDLScreenSpecSystemSaveCatalogAndExecutionIgnoreClientOverride(t *testing.T) {
	svc, db := newChannelModelTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	channel := model.ModelChannel{ID: "autodl", UserID: admin.ID, Scope: model.ChannelScopeSystem, Enabled: true, Name: "AutoDL", BaseURL: "https://autodl.art", APIKey: "test", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	enabled := true
	priceTiers := make([]ChannelModelPriceTierRequest, 0, 6)
	for _, resolution := range autoDLProfile(t, false).Video.Resolutions {
		sale, cost := int64(6), int64(3)
		if resolution[:4] == "768p" {
			sale, cost = 8, 4
		}
		priceTiers = append(priceTiers, ChannelModelPriceTierRequest{Resolution: resolution, BillingMode: "per_second", UnitPriceMicrocredits: sale * CreditScale, CostPricing: model.CreditCostPricing{Configured: true, UnitPriceMicrocredits: cost * CreditScale}, PriceConfigured: true, Enabled: &enabled})
	}
	for _, subset := range []bool{true, false} {
		profile := autoDLProfile(t, subset)
		id := ""
		if item, err := svc.repo.ChannelModelByKey(channel.ID, "minimax_h3_zm_u24"); err == nil {
			id = item.ID
		}
		saved, err := svc.SaveAdminChannelModel(admin, channel.ID, id, ChannelModelRequest{
			ModelKey: "minimax_h3_zm_u24", ProviderModelKey: "minimax_h3_zm_u24", Capability: "video", Protocol: "autodl-comfyui", CapabilityConfig: profile, Enabled: &enabled,
			PriceTiers: priceTiers,
		})
		if err != nil {
			t.Fatal(err)
		}
		public, err := svc.sanitizeChannelModel(saved)
		if err != nil {
			t.Fatal(err)
		}
		catalogSpec, err := channelModelCapabilitySpec(*saved)
		if err != nil {
			t.Fatal(err)
		}
		if _, exists := catalogSpec.Options["size"]; exists {
			t.Fatal("catalog exposes an unsupported independent ratio")
		}
		if len(catalogSpec.Options["vquality"].Values) != len(profile.Video.Resolutions) {
			t.Fatalf("catalog choices ignored the selected list: %#v", catalogSpec)
		}
		for _, tier := range saved.PriceTiers {
			if !containsCapabilityString(profile.Video.Resolutions, tier.Resolution) {
				continue
			}
			priceInput := map[string]any{"mode": "video", "prompt": "test", "config": map[string]any{"channelId": channel.ID, "channelModelKey": saved.ModelKey, "model": saved.ModelKey, "vquality": tier.Resolution, "videoSeconds": "6"}}
			priced, err := svc.resolveSystemChannelModelSelection(priceInput, "canvas_video", "text_to_video")
			if err != nil {
				t.Fatal(err)
			}
			config := priced["config"].(map[string]any)
			if config["priceTierId"] != tier.ID || config["vquality"] != tier.Resolution || tier.BillingMode != "per_second" || tier.UnitPriceMicrocredits != tier.CostPricing.UnitPriceMicrocredits*2 {
				t.Fatalf("resolution and price diverged: %#v, %#v", config, tier)
			}
		}
		data, _ := json.Marshal(public.CapabilityConfig)
		catalog, err := DecodeModelCapabilityConfig(string(data))
		if err != nil || catalog.Video.DefaultResolution != profile.Video.DefaultResolution {
			t.Fatalf("catalog = %s, err = %v", data, err)
		}
		input := map[string]any{"mode": "video", "prompt": "test", "config": map[string]any{"channelId": channel.ID, "channelModelKey": saved.ModelKey, "model": saved.ModelKey, "interfaceType": "autodl-comfyui", "vquality": "auto", "size": "16:9", "videoSeconds": "6", "capabilityConfig": autoDLProfile(t, !subset)}}
		resolved, err := svc.resolveSystemChannelModelSelection(input, "canvas_video", "text_to_video")
		if err != nil {
			t.Fatal(err)
		}
		if err := svc.ValidateTaskCapability(resolved); err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(resolved)
		var execution canvasGenerationInput
		if err := json.Unmarshal(encoded, &execution); err != nil {
			t.Fatal(err)
		}
		if err := svc.validateResolvedVideoCapability(&execution); err != nil {
			t.Fatal(err)
		}
		if execution.Config.VQuality != catalog.Video.DefaultResolution || execution.Config.Size != "" || !reflect.DeepEqual(execution.VideoCapability.Resolutions, catalog.Video.Resolutions) {
			t.Fatalf("catalog and execution mismatch: %#v, %#v", catalog.Video, execution.Config)
		}
		if subset {
			rejected := map[string]any{"mode": "video", "prompt": "test", "config": map[string]any{"channelId": channel.ID, "model": saved.ModelKey, "vquality": "768p竖", "videoSeconds": "6"}}
			resolved, err = svc.resolveSystemChannelModelSelection(rejected, "canvas_video", "text_to_video")
			if err == nil && svc.ValidateTaskCapability(resolved) == nil {
				t.Fatal("unselected preset bypassed saved capability restrictions")
			}
		}
	}
}
