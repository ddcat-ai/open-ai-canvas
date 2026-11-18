package database

import (
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestExternalMCPMigrationAndTaskIdempotencyIndex(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "external-mcp.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	var step migration
	for _, candidate := range schemaMigrations {
		if candidate.name == "external_mcp_access" {
			step = candidate
			break
		}
	}
	if step.apply == nil {
		t.Fatal("missing external MCP migration")
	}
	for i := 0; i < 2; i++ {
		if err := step.apply(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, entity := range []any{&model.UserAPIKey{}, &model.MCPClient{}, &model.MCPAuthorizationCode{}, &model.Task{}, &model.Project{}} {
		if !db.Migrator().HasTable(entity) {
			t.Fatalf("missing migrated table for %T", entity)
		}
	}
	key := "same-request"
	for _, task := range []model.Task{{ID: "one", UserID: "owner", ExternalIdempotencyKey: &key}, {ID: "two", UserID: "owner"}, {ID: "three", UserID: "owner"}} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.Task{ID: "duplicate", UserID: "owner", ExternalIdempotencyKey: &key}).Error; err == nil {
		t.Fatal("duplicate external task key accepted")
	}
	if err := db.Create(&model.Task{ID: "other-user", UserID: "other", ExternalIdempotencyKey: &key}).Error; err != nil {
		t.Fatalf("cross-user key rejected: %v", err)
	}
}
