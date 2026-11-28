package skills

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	_ "modernc.org/sqlite"
)

func TestLegacySkillMigrationsMatchBuiltinCatalog(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(legacySkillMigrations) != 16 {
		t.Fatalf("legacy migration count = %d, want 16", len(legacySkillMigrations))
	}
	builtinByID := make(map[string]string, len(packages))
	for _, item := range packages {
		builtinByID[item.skill.ID] = item.skill.Name
	}
	seen := make(map[string]struct{}, len(legacySkillMigrations))
	for _, migration := range legacySkillMigrations {
		if _, duplicate := seen[migration.LegacyID]; duplicate {
			t.Errorf("duplicate legacy skill ID %s", migration.LegacyID)
		}
		seen[migration.LegacyID] = struct{}{}
		if _, stillShipped := builtinByID[migration.LegacyID]; stillShipped {
			t.Errorf("legacy skill %s is still shipped as a standalone package", migration.LegacyID)
		}
		name, exists := builtinByID[migration.TargetID]
		if !exists {
			t.Errorf("legacy skill %s points at missing target %s", migration.LegacyID, migration.TargetID)
			continue
		}
		if name != migration.TargetName {
			t.Errorf("target %s name = %q, want %q", migration.TargetID, name, migration.TargetName)
		}
	}
}

func TestEnsureBuiltinSkillsRetiresLegacyPackageAndKeepsUserState(t *testing.T) {
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: ":memory:"}, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(
		&model.Skill{},
		&model.UserSkillState{},
		&model.SkillVersion{},
		&model.SkillFile{},
		&model.BuiltinSkillTombstone{},
		&model.SkillCurationAssignment{},
		&model.SkillCurationRootAssignment{},
	); err != nil {
		t.Fatal(err)
	}

	const (
		legacyID = "16000000000075"
		targetID = "14811816982796"
		userID   = "legacy-user"
	)
	if err := db.Create(&model.Skill{
		ID: legacyID, Name: "对白工坊", Status: 1, SourceType: "builtin",
		CurrentVersionID: "legacy-version", ContentHash: "legacy-hash",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SkillVersion{ID: "legacy-version", SkillID: legacyID, VersionLabel: "1.0.0"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SkillFile{ID: "legacy-file", SkillVersionID: "legacy-version", Path: "SKILL.md", Kind: "text"}).Error; err != nil {
		t.Fatal(err)
	}
	usedAt := time.Date(2026, 6, 1, 8, 0, 0, 0, time.UTC)
	state := model.UserSkillState{
		ID: "legacy-state", UserID: userID, SkillID: legacyID,
		LibraryCategoryID: "my-category", InstalledVersionID: "legacy-version",
		AutoUpdate: true, Added: true, Liked: true,
		AgentMode: model.UserSkillAgentModeManual, AgentUseCount: 4, AgentLastUsedAt: &usedAt,
	}
	if err := db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}

	service := New(repository.New(db), t.TempDir(), nil)
	if err := service.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}

	var target model.Skill
	if err := db.First(&target, "id = ?", targetID).Error; err != nil {
		t.Fatal(err)
	}
	if target.CurrentVersionID == "" {
		t.Fatal("target package has no current version")
	}
	var migrated model.UserSkillState
	if err := db.First(&migrated, "user_id = ? AND skill_id = ?", userID, targetID).Error; err != nil {
		t.Fatalf("legacy state was not migrated: %v", err)
	}
	if !migrated.Added || !migrated.Liked || !migrated.AutoUpdate {
		t.Fatalf("migrated flags = %#v", migrated)
	}
	if migrated.LibraryCategoryID != "my-category" || migrated.InstalledVersionID != target.CurrentVersionID {
		t.Fatalf("migrated references = %#v", migrated)
	}
	if migrated.AgentMode != model.UserSkillAgentModeManual || migrated.AgentUseCount != 4 {
		t.Fatalf("migrated agent state = %#v", migrated)
	}
	if migrated.AgentLastUsedAt == nil || !migrated.AgentLastUsedAt.Equal(usedAt) {
		t.Fatalf("migrated last used = %v, want %v", migrated.AgentLastUsedAt, usedAt)
	}

	var legacyCount int64
	if err := db.Model(&model.Skill{}).Where("id = ?", legacyID).Count(&legacyCount).Error; err != nil {
		t.Fatal(err)
	}
	if legacyCount != 0 {
		t.Fatalf("legacy skill rows = %d, want 0", legacyCount)
	}
	if err := db.Model(&model.SkillVersion{}).Where("skill_id = ?", legacyID).Count(&legacyCount).Error; err != nil {
		t.Fatal(err)
	}
	if legacyCount != 0 {
		t.Fatalf("legacy versions = %d, want 0", legacyCount)
	}
	if err := db.Model(&model.SkillFile{}).Where("skill_version_id = ?", "legacy-version").Count(&legacyCount).Error; err != nil {
		t.Fatal(err)
	}
	if legacyCount != 0 {
		t.Fatalf("legacy files = %d, want 0", legacyCount)
	}

	if err := service.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	var states []model.UserSkillState
	if err := db.Find(&states, "user_id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	if len(states) != 1 || states[0].SkillID != targetID {
		t.Fatalf("second ensure changed states: %#v", states)
	}
	if states[0].AgentUseCount != 4 {
		t.Fatalf("second ensure re-counted agent usage: %d", states[0].AgentUseCount)
	}
}
