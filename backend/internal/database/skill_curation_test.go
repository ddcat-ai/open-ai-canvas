package database

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"path/filepath"
	"testing"
)

func TestSkillCurationUpgradeAndRollback(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "upgrade.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, m := range schemaMigrations {
		if m.version > 43 {
			break
		}
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := m.apply(tx); err != nil {
				return err
			}
			return tx.Create(&schemaMigration{Version: m.version, Name: m.name, Checksum: m.checksum}).Error
		}); err != nil {
			t.Fatal(err)
		}
	}
	if db.Migrator().HasTable(&model.SkillCurationSetting{}) {
		t.Fatal("fixture is not an original schema")
	}
	if err := db.Create(&model.Skill{ID: "existing", Name: "Existing", Tag: "drama", Status: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TRIGGER reject_curation_migration BEFORE INSERT ON schema_migrations WHEN NEW.version = 46 BEGIN SELECT RAISE(ABORT, 'migration interrupted'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err == nil {
		t.Fatal("forced migration failure accepted")
	}
	if db.Migrator().HasTable(&model.SkillCurationSetting{}) {
		t.Fatal("failed migration left partial tables")
	}
	if err := db.Exec("DROP TRIGGER reject_curation_migration").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var skill model.Skill
	if err := db.First(&skill, "id = ?", "existing").Error; err != nil || skill.Tag != "drama" {
		t.Fatalf("existing skill changed: %#v %v", skill, err)
	}
	var setting model.SkillCurationSetting
	if err := db.First(&setting, 1).Error; err != nil || setting.Enabled {
		t.Fatalf("upgrade enabled curation: %#v %v", setting, err)
	}
}

func TestSkillCurationMigration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "migration.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	for i := 0; i < 2; i++ {
		if err := db.Transaction(migrateSkillCuration); err != nil {
			t.Fatal(err)
		}
	}
	var state model.SkillCurationSetting
	if err := db.First(&state, 1).Error; err != nil {
		t.Fatal(err)
	}
	if state.Enabled || state.Revision != 0 {
		t.Fatalf("migration must default off: %#v", state)
	}
	db.Model(&state).Updates(map[string]any{"enabled": true, "revision": 3})
	if err := db.Transaction(migrateSkillCuration); err != nil {
		t.Fatal(err)
	}
	db.First(&state, 1)
	if !state.Enabled || state.Revision != 3 {
		t.Fatal("migration overwrote settings")
	}
	found := false
	for _, m := range schemaMigrations {
		if m.version == 46 {
			found = m.name == "skill_curation" && m.checksum == "sha256:skill-curation-v46-20261005"
		}
	}
	if !found {
		t.Fatal("migration 46 is not registered")
	}
}
