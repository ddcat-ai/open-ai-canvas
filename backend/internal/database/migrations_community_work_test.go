package database

import (
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
)

func TestCommunityWorkMigrationIsAdditiveAndIdempotent(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "migration.db") + "?_foreign_keys=on"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, table := range []any{&model.CommunityWorkLike{}, &model.CommunityWorkResource{}, &model.CommunityWorkReview{}, &model.CommunityWork{}} {
		if err := db.Migrator().DropTable(table); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Where("version = ?", 106).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	oldProject := model.CanvasProject{ID: "existing-canvas", UserID: "existing-user", Title: "已有画布", PayloadJSON: `{"id":"existing-canvas","nodes":[],"connections":[]}`}
	oldResource := model.Resource{ID: "existing-resource", UserID: "existing-user", Kind: "image", Provider: "local", ObjectKey: "existing.png", Status: model.ResourceStatusReady, Size: 100}
	if err := db.Create(&oldProject).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&oldResource).Error; err != nil {
		t.Fatal(err)
	}
	for run := 0; run < 2; run++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var project model.CanvasProject
	var resource model.Resource
	if err := db.First(&project, "id = ?", oldProject.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&resource, "id = ?", oldResource.ID).Error; err != nil {
		t.Fatal(err)
	}
	if project.PayloadJSON != oldProject.PayloadJSON || project.UserID != oldProject.UserID || resource.ObjectKey != oldResource.ObjectKey || resource.Size != oldResource.Size {
		t.Fatal("migration changed existing canvas or resource data")
	}
	for _, table := range []any{&model.CommunityWork{}, &model.CommunityWorkResource{}, &model.CommunityWorkReview{}, &model.CommunityWorkLike{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing community table: %T", table)
		}
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("schema receipt: %+v %v", status, err)
	}
}
