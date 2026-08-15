package service

import (
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestFeatureAvailabilityDefaultsToEnabled(t *testing.T) {
	svc, _ := newFeatureAvailabilityTestService(t)

	setting, err := svc.FeatureAvailability()
	if err != nil {
		t.Fatal(err)
	}
	if setting.Configured || !setting.ShortDramaEnabled || !setting.TaskCenterEnabled || !setting.CreditsEnabled || !setting.CustomChannelsEnabled {
		t.Fatalf("FeatureAvailability() = %#v", setting)
	}
}

func TestFeatureAvailabilityLegacySettingKeepsCustomChannelsEnabled(t *testing.T) {
	svc, db := newFeatureAvailabilityTestService(t)
	legacy := &model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"shortDramaEnabled":false,"taskCenterEnabled":true,"creditsEnabled":true}`}
	if err := db.Create(legacy).Error; err != nil {
		t.Fatal(err)
	}

	setting, err := svc.FeatureAvailability()
	if err != nil {
		t.Fatal(err)
	}
	if setting.ShortDramaEnabled || !setting.CustomChannelsEnabled {
		t.Fatalf("FeatureAvailability() = %#v", setting)
	}
}

func TestUpdateFeatureAvailabilityPersistsAndAudits(t *testing.T) {
	svc, db := newFeatureAvailabilityTestService(t)
	actor := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	want := FeatureAvailability{ShortDramaEnabled: false, TaskCenterEnabled: true, CreditsEnabled: false, CustomChannelsEnabled: true}

	setting, err := svc.UpdateFeatureAvailability(actor, want)
	if err != nil {
		t.Fatal(err)
	}
	if !setting.Configured || setting.ShortDramaEnabled || !setting.TaskCenterEnabled || setting.CreditsEnabled || !setting.CustomChannelsEnabled {
		t.Fatalf("UpdateFeatureAvailability() = %#v", setting)
	}
	if err := svc.RequireFeature(FeatureShortDrama); err == nil {
		t.Fatal("RequireFeature(shortDrama) error = nil")
	} else {
		var authErr *AuthError
		if !errors.As(err, &authErr) || authErr.Status != 403 {
			t.Fatalf("RequireFeature(shortDrama) error = %#v", err)
		}
	}
	var auditCount int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ?", "feature_availability.update").Count(&auditCount).Error; err != nil {
		t.Fatal(err)
	}
	if auditCount != 1 {
		t.Fatalf("audit count = %d, want 1", auditCount)
	}
}

func TestCustomChannelTaskInputRequiresFeature(t *testing.T) {
	svc, _ := newFeatureAvailabilityTestService(t)
	actor := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	if _, err := svc.UpdateFeatureAvailability(actor, FeatureAvailability{ShortDramaEnabled: true, TaskCenterEnabled: true, CreditsEnabled: true, CustomChannelsEnabled: false}); err != nil {
		t.Fatal(err)
	}

	customInput, err := normalizeTaskInput(map[string]any{"config": providerConfig{BaseURL: "https://example.com", APIKey: "private-key", Model: "text-model"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.requireCustomChannelsForTaskInput(customInput); err == nil {
		t.Fatal("custom channel task must be rejected when the feature is disabled")
	}
	systemInput, err := normalizeTaskInput(map[string]any{"config": providerConfig{ChannelID: "system-1", BaseURL: "/api/ai/system/system-1", APIKey: "system", Model: "text-model"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.requireCustomChannelsForTaskInput(systemInput); err != nil {
		t.Fatalf("system channel task error = %v", err)
	}
	legacySystemInput, err := normalizeTaskInput(map[string]any{"config": providerConfig{BaseURL: "/api/ai/system/system-1", APIKey: "system", Model: "text-model"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.requireCustomChannelsForTaskInput(legacySystemInput); err != nil {
		t.Fatalf("legacy system proxy task error = %v", err)
	}
}

func TestTaskBillingOrderSkipsPricingWhenCreditsDisabled(t *testing.T) {
	svc, _ := newFeatureAvailabilityTestService(t)
	actor := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	if _, err := svc.UpdateFeatureAvailability(actor, FeatureAvailability{ShortDramaEnabled: true, TaskCenterEnabled: true, CreditsEnabled: false, CustomChannelsEnabled: true}); err != nil {
		t.Fatal(err)
	}

	order, err := svc.taskBillingOrder("user-1", &model.Task{ID: "task-1"}, map[string]any{"config": map[string]any{"channelId": "missing", "model": "missing"}})
	if err != nil {
		t.Fatal(err)
	}
	if order != nil {
		t.Fatalf("taskBillingOrder() = %#v, want nil", order)
	}
}

func newFeatureAvailabilityTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir()), db
}
