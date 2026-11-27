package database

import (
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
)

func TestNodeToolbarPreferenceMigrationUpgrades111(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "migration.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.UserNodeToolbarPreference{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("DELETE FROM schema_migrations WHERE version = ?", 112).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasTable(&model.UserNodeToolbarPreference{}) {
		t.Fatal("schema 111 upgrade omitted node toolbar preferences")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil {
		t.Fatal(err)
	}
	if status.Current != 112 {
		t.Fatalf("schema version = %d, want 112", status.Current)
	}
}
