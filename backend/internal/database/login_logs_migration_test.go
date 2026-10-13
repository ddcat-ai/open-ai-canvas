package database

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"path/filepath"
	"testing"
	"yingce/backend/internal/model"
)

func TestLoginLogMigrationUpgradesExistingSchema(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "migration.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.LoginLog{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("DELETE FROM schema_migrations WHERE version = 53").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&model.LoginLog{}) {
		t.Fatal("existing schema lacks login logs")
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal("migration is not repeatable", err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("schema status: %#v %v", status, err)
	}
}
