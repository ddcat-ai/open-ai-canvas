package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestOrchestrationCatalogRejectsMissingVisionAndPrivateModel(t *testing.T) {
	catalog := &ModelCatalogResponse{Channels: []PublicChannelCatalog{{ID: "system", Models: []PublicChannelModel{
		{ID: "vision", Capability: "text", Available: true, CapabilityConfig: map[string]any{"text": map[string]any{"references": map[string]any{"maxImages": float64(1)}}}},
		{ID: "text", Capability: "text", Available: true, CapabilityConfig: map[string]any{"text": map[string]any{"references": map[string]any{"maxImages": float64(0)}}}},
		{ID: "unknown", Capability: "text", Available: true},
	}}}}
	for _, tc := range []struct {
		id         string
		vision, ok bool
	}{{"vision", true, true}, {"text", false, true}, {"text", true, false}, {"unknown", true, false}, {"private", false, false}} {
		err := validateOrchestrationCatalogModel(catalog, EcommerceOrchestrationModel{ChannelModelID: tc.id}, tc.vision)
		if (err == nil) != tc.ok {
			t.Fatalf("%s vision=%v: %v", tc.id, tc.vision, err)
		}
	}
}

func TestOrchestrationSettingSaveIsAdminOnlyAndRequiresImageModels(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	ordinary := &model.User{ID: "user", Role: model.UserRoleUser}
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	profile.Text.References.MaxImages = 1
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
		t.Fatal(err)
	}
	choice := EcommerceOrchestrationModel{ChannelModelID: "cm"}
	setting := EcommerceOrchestrationSetting{
		Version:   1,
		Vision:    EcommerceOrchestrationRole{Model: choice, ThinkingLevel: "high"},
		Marketing: EcommerceOrchestrationRole{Model: choice, ThinkingLevel: "deep"},
		Director:  EcommerceOrchestrationRole{Reuse: "marketing"},
	}
	if _, err := svc.UpdateEcommerceOrchestrationSetting(ordinary, setting); err == nil {
		t.Fatal("ordinary user changed configuration")
	}
	if _, err := svc.EcommerceOrchestrationSetting(ordinary); err == nil {
		t.Fatal("ordinary user read configuration")
	}
	if _, err := svc.UpdateEcommerceOrchestrationSetting(admin, setting); err != nil {
		t.Fatal(err)
	}
	stored, err := svc.EcommerceOrchestrationSetting(admin)
	if err != nil || stored != setting {
		t.Fatalf("round trip failed: %+v %v", stored, err)
	}
	setting.Enabled = true
	if _, err := svc.UpdateEcommerceOrchestrationSetting(admin, setting); err == nil {
		t.Fatal("unapproved calls enabled")
	}
	stored, _ = svc.EcommerceOrchestrationSetting(admin)
	if stored.Enabled {
		t.Fatal("failed update changed stored configuration")
	}
	// Marketing writes the plan from the product images, so it must read images.
	textProfile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-only")
	textProfile.Text.References.MaxImages = 0
	for _, record := range []any{
		&model.ChannelModel{ID: "cm-text", ChannelID: "channel", ModelKey: "text-only", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, textProfile), BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "tier-text", ChannelModelID: "cm-text", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	setting.Enabled = false
	textOnly := setting
	textOnly.Marketing = EcommerceOrchestrationRole{Model: EcommerceOrchestrationModel{ChannelModelID: "cm-text"}}
	if _, err := svc.UpdateEcommerceOrchestrationSetting(admin, textOnly); err == nil || !strings.Contains(err.Error(), "整套策划") {
		t.Fatalf("text-only marketing model accepted: %v", err)
	}
	setting.Director = EcommerceOrchestrationRole{Model: choice, Fallback: choice}
	if _, err := svc.UpdateEcommerceOrchestrationSetting(admin, setting); err == nil {
		t.Fatal("duplicate fallback accepted")
	}
	resolved, err := svc.EcommerceAgentSetting()
	if err != nil {
		t.Fatalf("stage setting affected: %v", err)
	}
	if resolved.ThinkingLevel != "deep" || resolved.VisionThinkingLevel != "high" {
		t.Fatalf("stage thinking settings were not resolved: %+v", resolved)
	}
	invalidThinking := setting
	invalidThinking.Vision.ThinkingLevel = "ultra"
	if _, err := svc.UpdateEcommerceOrchestrationSetting(admin, invalidThinking); err == nil {
		t.Fatal("invalid stage thinking level accepted")
	}
}
