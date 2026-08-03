package service

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDefaultDrawingEngineUsesExcalidraw(t *testing.T) {
	setting := defaultDrawingEngineSetting()
	if setting.DefaultEngine != DrawingEngineExcalidraw {
		t.Fatalf("default engine = %q, want %q", setting.DefaultEngine, DrawingEngineExcalidraw)
	}
}

func TestValidateDrawingEngineSetting(t *testing.T) {
	for _, engine := range []string{DrawingEngineTldraw, DrawingEngineExcalidraw} {
		if err := validateDrawingEngineSetting(DrawingEngineSetting{DefaultEngine: engine}); err != nil {
			t.Fatalf("validate engine %q: %v", engine, err)
		}
	}
	if err := validateDrawingEngineSetting(DrawingEngineSetting{DefaultEngine: "unknown"}); err == nil {
		t.Fatal("validate unknown engine = nil")
	}
}

func TestUpdateDrawingEngineSettingKeepsDefaultEngineAndStoresTldrawLicenseSeparately(t *testing.T) {
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
	repo := repository.New(db)
	svc := New(repo, t.TempDir())
	actor := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}

	setting, err := svc.UpdateDrawingEngineSetting(actor, DrawingEngineSetting{
		DefaultEngine:    DrawingEngineExcalidraw,
		TldrawLicenseKey: "license-key-for-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if setting.DefaultEngine != DrawingEngineExcalidraw {
		t.Fatalf("default engine = %q, want %q", setting.DefaultEngine, DrawingEngineExcalidraw)
	}
	if setting.TldrawLicenseKey != "license-key-for-test" {
		t.Fatalf("license key = %q", setting.TldrawLicenseKey)
	}

	licenseSetting, err := repo.SystemSetting(tldrawLicenseKeySettingKey)
	if err != nil {
		t.Fatal(err)
	}
	var savedLicenseKey string
	if err := json.Unmarshal([]byte(licenseSetting.ValueJSON), &savedLicenseKey); err != nil {
		t.Fatal(err)
	}
	if savedLicenseKey != "license-key-for-test" {
		t.Fatalf("stored license key = %q", savedLicenseKey)
	}

	engineSetting, err := repo.SystemSetting(drawingEngineSettingKey)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(engineSetting.ValueJSON, "license-key-for-test") {
		t.Fatalf("drawing engine setting must not contain the license key: %s", engineSetting.ValueJSON)
	}
}
