package app

import (
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestEcommerceAgentTaskRejectsStalePlanningModel(t *testing.T) {
	t.Setenv("AI_MODE", "disabled")
	svc, _, _, _ := ecommerceCreationTestService(t)
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ecommerceAgentSettingKey, ValueJSON: `{"logicalModelId":"admin-selected-model"}`}); err != nil {
		t.Fatal(err)
	}
	setting, err := svc.EcommerceAgentSetting()
	if err != nil || setting.LogicalModelID != "admin-selected-model" {
		t.Fatalf("setting = %#v, %v", setting, err)
	}
	for _, stage := range []string{"planning", "product-understanding", "creative-directions"} {
		_, err := svc.CreateTask("user", CreateTaskRequest{Type: "canvas_text", Prompt: "plan", LogicalModelID: "outdated-model", Input: map[string]any{
			"mode": "text", "prompt": "plan", "metadata": map[string]any{"source": "ecommerce-agent", "stage": stage, "ecommerceProjectId": project.ID},
		}})
		if err == nil || !strings.Contains(err.Error(), "管理员更新") {
			t.Fatalf("%s task accepted stale model: %v", stage, err)
		}
	}
}

func TestAdminCatalogKeepsHealthyModelsWhenOneRevisionIsInvalid(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	good := seedAgentLogicalImageModel(t, svc, db)
	broken := model.LogicalModel{ID: "broken-ecommerce-catalog", Code: "broken-ecommerce-catalog", Name: "待修复模型", Capability: "text", Enabled: true, ActiveRevisionID: "broken-ecommerce-revision", PricePolicy: "channel", BillingMode: "token"}
	if err := db.Create(&broken).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.LogicalModelRevision{ID: broken.ActiveRevisionID, LogicalModelID: broken.ID, Version: 1, CapabilitySpecJSON: "{invalid", DefaultOptionsJSON: "{}"}).Error; err != nil {
		t.Fatal(err)
	}
	items, err := svc.AdminLogicalModels(&model.User{ID: "admin", Role: model.UserRoleAdmin})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("catalog lost models: %#v", items)
	}
	for _, item := range items {
		if item.ID == good.ID && !item.Available {
			t.Fatal("healthy model became unavailable")
		}
		if item.ID == broken.ID && (item.Available || item.ConfigurationError == "") {
			t.Fatal("broken model was not diagnosed and disabled")
		}
	}
}

// stageModelFixture seeds an administrator and three image-capable channel
// models that appear in the administrator's catalog.
func stageModelFixture(t *testing.T) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	t.Setenv("AI_MODE", "disabled")
	svc, db, _, _ := creationTestService(t)
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ModelChannel{ID: "stage-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "分阶段渠道"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"vision-a", "planner-b", "fallback-f"} {
		profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), key)
		profile.Text.References.MaxImages = 4
		item := model.ChannelModel{ID: key, ChannelID: "stage-channel", ModelKey: key, DisplayName: key, Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile), BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true}
		tier := model.ChannelModelPriceTier{ID: key + "-tier", ChannelModelID: key, SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 100, PriceConfigured: true, Enabled: true}
		for _, record := range []any{&item, &tier} {
			if err := db.Create(record).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	return svc, db, admin
}

func stageModelSetting() EcommerceOrchestrationSetting {
	return EcommerceOrchestrationSetting{
		Version:   1,
		Vision:    EcommerceOrchestrationRole{Model: EcommerceOrchestrationModel{ChannelModelID: "vision-a"}, Fallback: EcommerceOrchestrationModel{ChannelModelID: "fallback-f"}},
		Marketing: EcommerceOrchestrationRole{Model: EcommerceOrchestrationModel{ChannelModelID: "planner-b"}},
		Director:  EcommerceOrchestrationRole{Reuse: "marketing"},
	}
}

// The stage configuration drives the models every ecommerce Agent page uses,
// and each analysis stage is bound to its own model.
func TestEcommerceStageSettingDrivesAgentModels(t *testing.T) {
	svc, db, admin := stageModelFixture(t)
	features := defaultFeatureAvailability()
	features.EcommerceEnabled = true
	saveAdmissionFeatures(t, svc, features)
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateEcommerceOrchestrationSetting(admin, stageModelSetting()); err != nil {
		t.Fatal(err)
	}
	setting, err := svc.EcommerceAgentSetting()
	if err != nil || setting.planningRef().ChannelModelID != "planner-b" || setting.planningRef().ModelKey != "planner-b" || setting.visionRef().ChannelModelID != "vision-a" || setting.visionRef().ChannelID != "stage-channel" {
		t.Fatalf("resolved stage models = %#v, %v", setting, err)
	}
	task := func(stage, modelKey string) error {
		_, err := svc.CreateTask("user", CreateTaskRequest{Type: "canvas_text", Prompt: "analyze", Input: map[string]any{"mode": "text", "prompt": "analyze", "config": map[string]any{"channelId": "stage-channel", "model": modelKey}, "metadata": map[string]any{"source": "ecommerce-agent", "stage": stage, "ecommerceProjectId": project.ID}}})
		return err
	}
	if err := task("creative-directions", "planner-b"); err == nil || !strings.Contains(err.Error(), "管理员更新") {
		t.Fatalf("creative-directions accepted the planning model: %v", err)
	}
	if err := task("planning", "vision-a"); err == nil || !strings.Contains(err.Error(), "管理员更新") {
		t.Fatalf("planning accepted the vision model: %v", err)
	}
	if err := task("creative-directions", "vision-a"); err != nil && strings.Contains(err.Error(), "管理员更新") {
		t.Fatalf("creative-directions refused the configured vision model: %v", err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "vision-a").Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	setting, err = svc.EcommerceAgentSetting()
	if err != nil || setting.visionRef().ChannelModelID != "fallback-f" || setting.planningRef().ChannelModelID != "planner-b" {
		t.Fatalf("disabled vision model did not fall back: %#v, %v", setting, err)
	}
}

func TestEcommerceStageSettingRequiresAdminAndVisionModel(t *testing.T) {
	svc, _, admin := stageModelFixture(t)
	ordinary := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if _, err := svc.UpdateEcommerceOrchestrationSetting(ordinary, stageModelSetting()); err == nil {
		t.Fatal("ordinary user changed the stage models")
	}
	missingVision := stageModelSetting()
	missingVision.Vision = EcommerceOrchestrationRole{}
	if _, err := svc.UpdateEcommerceOrchestrationSetting(admin, missingVision); err == nil || !strings.Contains(err.Error(), "商品识别与视觉方向主模型") {
		t.Fatalf("stage setting without a vision model saved: %v", err)
	}
	if _, saved, err := svc.storedEcommerceOrchestrationSetting(); err != nil || saved {
		t.Fatalf("rejected update was stored: saved=%v err=%v", saved, err)
	}
}
