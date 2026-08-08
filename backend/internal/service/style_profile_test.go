package service

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestStyleProfileCreateAndUpdateOwnsIdentityAndRevision(t *testing.T) {
	svc := newStyleProfileTestService(t)
	created, err := svc.CreateStyleProfile("user-1", styleProfileTestRequest(t, "志怪暗彩", 88))
	if err != nil {
		t.Fatal(err)
	}
	var createdDocument styleProfileDocument
	if err := json.Unmarshal([]byte(created.ProfileJSON), &createdDocument); err != nil {
		t.Fatal(err)
	}
	if created.Revision != 1 || createdDocument.PresetID != created.ID || createdDocument.SourceProfileID != created.ID || createdDocument.Source != "user" || createdDocument.Revision != 1 {
		t.Fatalf("created profile identity was not normalized: model=%+v document=%+v", created, createdDocument)
	}
	if createdDocument.Selection["medium"] != "工笔暗彩" || len(createdDocument.Assets) != 1 || createdDocument.Assets[0].License == nil || createdDocument.Assets[0].License.Note != "需保留来源记录" {
		t.Fatalf("created profile metadata was not preserved: document=%+v", createdDocument)
	}

	updated, err := svc.UpdateStyleProfile("user-1", created.ID, styleProfileTestRequest(t, "志怪暗彩二版", 300))
	if err != nil {
		t.Fatal(err)
	}
	var updatedDocument styleProfileDocument
	if err := json.Unmarshal([]byte(updated.ProfileJSON), &updatedDocument); err != nil {
		t.Fatal(err)
	}
	if updated.Revision != 2 || updatedDocument.Revision != 2 || updatedDocument.PresetID != created.ID || updatedDocument.Title != "志怪暗彩二版" {
		t.Fatalf("updated profile revision was not server controlled: model=%+v document=%+v", updated, updatedDocument)
	}
}

func TestStyleProfileMutationsRejectOtherUsers(t *testing.T) {
	svc := newStyleProfileTestService(t)
	created, err := svc.CreateStyleProfile("user-1", styleProfileTestRequest(t, "用户一风格", 1))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateStyleProfile("user-2", created.ID, styleProfileTestRequest(t, "越权修改", 1)); err == nil {
		t.Fatal("expected cross-user update to fail")
	}
	if err := svc.SetStyleProfileFavorite("user-2", created.ID, true); err == nil {
		t.Fatal("expected cross-user favorite to fail")
	}
	if err := svc.TouchStyleProfile("user-2", created.ID); err == nil {
		t.Fatal("expected cross-user use tracking to fail")
	}
	if err := svc.DeleteStyleProfile("user-2", created.ID); err == nil {
		t.Fatal("expected cross-user delete to fail")
	}
	profiles, err := svc.ListStyleProfiles("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 1 || profiles[0].ID != created.ID {
		t.Fatalf("owner profile was changed by rejected mutations: %+v", profiles)
	}
}

func newStyleProfileTestService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.StyleProfile{}); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir())
}

func styleProfileTestRequest(t *testing.T, title string, revision int) StyleProfileRequest {
	t.Helper()
	document := styleProfileDocument{
		SchemaVersion: 1, PresetID: "client-controlled-id", Title: title, Description: "可复用风格",
		Tags: []string{"志怪", "暗彩"}, Prompt: "统一使用工笔线条、暗彩矿物色和克制光影。", NegativePrompt: "禁止媒介漂移和随机文字。",
		Selection: map[string]string{"world": "东方志怪", "medium": "工笔暗彩"},
		Assets: []styleProfileAsset{{
			ID: "license-snapshot", Kind: "prompt", Provider: "manual", Title: "材质约束", PromptFragment: "矿物色与宣纸肌理", Status: "validated",
			License: &styleProfileAssetLicense{Note: "需保留来源记录", Source: "内部规范"},
		}},
		ExecutionPolicy: "compatible-fallback", Source: "external", Revision: revision,
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		t.Fatal(err)
	}
	return StyleProfileRequest{ProfileJSON: string(encoded)}
}
