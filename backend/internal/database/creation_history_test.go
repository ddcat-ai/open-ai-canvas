package database

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"path/filepath"
	"testing"
	"yingce/backend/internal/model"
)

func TestCreationHistoryMigration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "migration.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err = db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	var migration60 migration
	for _, step := range schemaMigrations {
		if step.version == 101 {
			migration60 = step
		}
	}
	if migration60.apply == nil {
		t.Fatal("missing migration 101")
	}
	for i := 0; i < 2; i++ {
		if err := migration60.apply(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []any{&model.CreationConversation{}, &model.CreationConversationMessage{}, &model.CreationConversationResource{}} {
		if !db.Migrator().HasTable(row) {
			t.Fatal("missing creation history table")
		}
	}
}
