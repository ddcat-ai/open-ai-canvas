package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestMigrateDramaCastStylesImport(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	for _, sql := range []string{
		"CREATE TABLE drama_casts (id text PRIMARY KEY, project_id text, appearance text)",
		"INSERT INTO drama_casts (id, project_id, appearance) VALUES ('hero', 'first', '白衬衫')",
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	found := false
	for _, migration := range schemaMigrations {
		if migration.version != 94 {
			continue
		}
		found = true
		for i := 0; i < 2; i++ {
			if err := migration.apply(db); err != nil {
				t.Fatal(err)
			}
		}
	}
	if !found || CurrentSchemaVersion < 94 {
		t.Fatal("migration must be registered")
	}
	var cast model.DramaCast
	if err := db.First(&cast, "id = ?", "hero").Error; err != nil {
		t.Fatal(err)
	}
	if cast.Appearance != "白衬衫" || cast.ImageStyleID != "" || cast.ImageStyleName != "" || cast.ImageStylePrompt != "" || cast.SourceProjectID != "" || cast.SourceCastID != "" {
		t.Fatalf("migration damaged legacy row: %+v", cast)
	}
	for _, sql := range []string{
		"INSERT INTO drama_casts (id, project_id, source_cast_id) VALUES ('local1', 'second', '')",
		"INSERT INTO drama_casts (id, project_id, source_cast_id) VALUES ('local2', 'second', '')",
		"INSERT INTO drama_casts (id, project_id, source_cast_id) VALUES ('import1', 'second', 'hero')",
		"INSERT INTO drama_casts (id, project_id, source_cast_id) VALUES ('import2', 'third', 'hero')",
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec("INSERT INTO drama_casts (id, project_id, source_cast_id) VALUES ('duplicate', 'second', 'hero')").Error; err == nil {
		t.Fatal("source must be unique within the target project")
	}
}
