package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestMigratePoseLibraryKindPreservesLegacyRowsAndIsIdempotent(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{
		`CREATE TABLE pose_library_sources (key TEXT PRIMARY KEY, name TEXT)`,
		`CREATE TABLE pose_library_items (id TEXT PRIMARY KEY, name TEXT)`,
		`INSERT INTO pose_library_sources (key, name) VALUES ('legacy', 'Legacy source')`,
		`INSERT INTO pose_library_items (id, name) VALUES ('legacy-item', 'Legacy pose')`,
	} {
		if err := db.Exec(query).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := migratePoseLibraryKind(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, table := range []string{"pose_library_sources", "pose_library_items"} {
		var row struct{ Library, Name string }
		if err := db.Table(table).First(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.Library != model.PoseLibraryKindPose || row.Name == "" {
			t.Fatalf("%s legacy row = %#v", table, row)
		}
	}
	if !db.Migrator().HasIndex(&model.PoseLibraryItem{}, "Library") {
		t.Fatal("library index missing")
	}
}
