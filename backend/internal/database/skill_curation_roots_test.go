package database

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"path/filepath"
	"testing"
)

func TestSkillCurationRootsMigration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "roots.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err := db.Transaction(migrateSkillCuration); err != nil {
		t.Fatal(err)
	}
	db.Create(&model.SkillCurationCategory{ID: "old", Name: "Existing", NormalizedName: "existing", RootTag: "drama", Enabled: true})
	if err := db.Transaction(migrateSkillCurationRoots); err != nil {
		t.Fatal(err)
	}
	var roots []model.SkillCurationRoot
	db.Find(&roots)
	if len(roots) != 5 {
		t.Fatalf("neutral defaults: %d", len(roots))
	}
	db.Model(&model.SkillCurationRoot{}).Where("id = ?", "drama").Updates(map[string]any{"name": "Edited", "enabled": false})
	if err := db.Transaction(migrateSkillCurationRoots); err != nil {
		t.Fatal(err)
	}
	var root model.SkillCurationRoot
	db.First(&root, "id = ?", "drama")
	if root.Name != "Edited" || root.Enabled {
		t.Fatal("migration overwrote root")
	}
	var category model.SkillCurationCategory
	db.First(&category, "id = ?", "old")
	if category.RootTag != "drama" {
		t.Fatal("migration changed U39 categories")
	}
	found := false
	for _, m := range schemaMigrations {
		if m.version == 47 {
			found = m.name == "skill_curation_roots" && m.checksum == "sha256:skill-curation-roots-v47-20261005"
		}
	}
	if !found {
		t.Fatal("migration 47 is not registered")
	}
}
