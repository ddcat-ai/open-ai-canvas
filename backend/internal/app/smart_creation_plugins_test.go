package app

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSmartCreationPluginsFollowUserActivation(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.PluginPlatformState{}, &model.UserPluginState{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), pluginRuntime: center}
	user := &model.User{ID: "smart-user", Role: model.UserRoleUser}

	disabled, err := svc.SmartCreationPluginsForUser(user)
	if err != nil {
		t.Fatal(err)
	}
	if len(disabled) != 0 {
		t.Fatalf("smart creation plugins before user enable = %#v", disabled)
	}
	if _, err := svc.SetUserPluginEnabled(user, PluginIgoStudio, true); err != nil {
		t.Fatal(err)
	}
	enabled, err := svc.SmartCreationPluginsForUser(user)
	if err != nil {
		t.Fatal(err)
	}
	if len(enabled) != 1 || enabled[0].ID != PluginIgoStudio || enabled[0].SmartCreation == nil {
		t.Fatalf("smart creation plugins after user enable = %#v", enabled)
	}
	var planner struct {
		SystemPrompt []string `json:"systemPrompt"`
		Tool         struct {
			Name string `json:"name"`
		} `json:"tool"`
	}
	if err := json.Unmarshal(enabled[0].SmartCreation.Planner, &planner); err != nil {
		t.Fatalf("official planner is not valid JSON: %v", err)
	}
	if len(planner.SystemPrompt) == 0 || planner.Tool.Name != "create_smart_creation_plan" {
		t.Fatalf("official planner = %#v", planner)
	}
}
