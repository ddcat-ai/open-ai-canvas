package database

import (
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
)

func TestResourceContentSHA256Migration(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "resource-digest.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := migrateResourceContentSHA256(db); err != nil {
		t.Fatal("missing table should be skipped", err)
	}
	if err := db.Exec("CREATE TABLE resources (id text PRIMARY KEY, user_id text, upload_key text)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO resources (id, user_id, upload_key) VALUES ('legacy', 'owner', 'existing-key')").Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := migrateResourceContentSHA256(db); err != nil {
			t.Fatal("migration must be repeatable", err)
		}
	}
	var row model.Resource
	if err := db.First(&row, "id = ?", "legacy").Error; err != nil {
		t.Fatal(err)
	}
	if row.UserID != "owner" || row.UploadKey == nil || *row.UploadKey != "existing-key" || row.ContentSHA256 != "" {
		t.Fatalf("migration rewrote legacy identity: %+v", row)
	}
	if !db.Migrator().HasColumn(&model.Resource{}, "ContentSHA256") {
		t.Fatal("content digest column is missing")
	}
}
