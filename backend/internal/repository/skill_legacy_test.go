package repository

import (
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	_ "modernc.org/sqlite"
)

func legacySkillRepositoryFixture(t *testing.T) (*Repository, *gorm.DB) {
	t.Helper()
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
	return New(db), db
}

func seedLegacySkillPair(t *testing.T, db *gorm.DB) {
	t.Helper()
	skills := []model.Skill{
		{ID: "legacy-skill", Name: "旧技能", Status: 1, SourceType: "builtin", CurrentVersionID: "legacy-v1"},
		{ID: "target-skill", Name: "稳定技能", Status: 1, SourceType: "builtin", CurrentVersionID: "target-v1"},
	}
	if err := db.Create(&skills).Error; err != nil {
		t.Fatal(err)
	}
	versions := []model.SkillVersion{
		{ID: "legacy-v1", SkillID: "legacy-skill", VersionLabel: "1.0.0"},
		{ID: "target-v1", SkillID: "target-skill", VersionLabel: "2.0.0"},
	}
	if err := db.Create(&versions).Error; err != nil {
		t.Fatal(err)
	}
	files := []model.SkillFile{
		{ID: "legacy-file", SkillVersionID: "legacy-v1", Path: "SKILL.md", Kind: "text"},
		{ID: "target-file", SkillVersionID: "target-v1", Path: "SKILL.md", Kind: "text"},
	}
	if err := db.Create(&files).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SkillCurationAssignment{SkillID: "legacy-skill", CategoryID: "legacy-category"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SkillCurationRootAssignment{SkillID: "legacy-skill", RootID: "legacy-root"}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestRetireLegacyBuiltinSkillsMigratesAndMergesUserState(t *testing.T) {
	repo, db := legacySkillRepositoryFixture(t)
	seedLegacySkillPair(t, db)

	older := time.Date(2026, 1, 1, 8, 0, 0, 0, time.UTC)
	middle := time.Date(2026, 3, 1, 8, 0, 0, 0, time.UTC)
	later := time.Date(2026, 5, 1, 8, 0, 0, 0, time.UTC)
	now := time.Date(2026, 11, 27, 8, 0, 0, 0, time.UTC)
	states := []model.UserSkillState{
		{
			ID: "state-only-legacy", UserID: "user-a", SkillID: "legacy-skill",
			LibraryCategoryID: "category-a", InstalledVersionID: "legacy-v1",
			AutoUpdate: true, Added: true, Liked: true, AgentMode: model.UserSkillAgentModeManual,
			AgentUseCount: 3, AgentLastUsedAt: &middle, CreatedAt: older, UpdatedAt: older,
		},
		{
			ID: "state-legacy-b", UserID: "user-b", SkillID: "legacy-skill",
			LibraryCategoryID: "category-legacy", InstalledVersionID: "legacy-v1",
			AutoUpdate: true, Added: true, AgentMode: model.UserSkillAgentModeManual,
			AgentUseCount: 2, AgentLastUsedAt: &middle, CreatedAt: older, UpdatedAt: older,
		},
		{
			ID: "state-target-b", UserID: "user-b", SkillID: "target-skill",
			LibraryCategoryID: "category-target", InstalledVersionID: "target-v1",
			Liked: true, AgentMode: model.UserSkillAgentModeAuto,
			AgentUseCount: 5, AgentLastUsedAt: &later, CreatedAt: middle, UpdatedAt: middle,
		},
	}
	if err := db.Create(&states).Error; err != nil {
		t.Fatal(err)
	}

	report, err := repo.RetireLegacyBuiltinSkills([]LegacySkillRetirement{{
		LegacyID: "legacy-skill",
		TargetID: "target-skill",
	}}, now)
	if err != nil {
		t.Fatal(err)
	}
	if report.CreatedStates != 1 || report.MergedStates != 1 {
		t.Fatalf("report = %#v, want created=1 merged=1", report)
	}
	if len(report.RetiredSkills) != 1 || report.RetiredSkills[0] != "legacy-skill" {
		t.Fatalf("retired = %v, want legacy-skill", report.RetiredSkills)
	}

	var onlyLegacy model.UserSkillState
	if err := db.First(&onlyLegacy, "user_id = ? AND skill_id = ?", "user-a", "target-skill").Error; err != nil {
		t.Fatal(err)
	}
	if !onlyLegacy.Added || !onlyLegacy.Liked || !onlyLegacy.AutoUpdate {
		t.Fatalf("only-legacy flags not inherited: %#v", onlyLegacy)
	}
	if onlyLegacy.LibraryCategoryID != "category-a" || onlyLegacy.InstalledVersionID != "target-v1" {
		t.Fatalf("only-legacy references not migrated: %#v", onlyLegacy)
	}
	if onlyLegacy.AgentMode != model.UserSkillAgentModeManual || onlyLegacy.AgentUseCount != 3 {
		t.Fatalf("only-legacy agent state not migrated: %#v", onlyLegacy)
	}
	if onlyLegacy.AgentLastUsedAt == nil || !onlyLegacy.AgentLastUsedAt.Equal(middle) {
		t.Fatalf("only-legacy last used = %v, want %v", onlyLegacy.AgentLastUsedAt, middle)
	}
	if !onlyLegacy.CreatedAt.Equal(older) || !onlyLegacy.UpdatedAt.Equal(now) {
		t.Fatalf("only-legacy timestamps = %v/%v", onlyLegacy.CreatedAt, onlyLegacy.UpdatedAt)
	}

	var merged model.UserSkillState
	if err := db.First(&merged, "user_id = ? AND skill_id = ?", "user-b", "target-skill").Error; err != nil {
		t.Fatal(err)
	}
	if !merged.Added || !merged.Liked || !merged.AutoUpdate {
		t.Fatalf("merged flags not accumulated: %#v", merged)
	}
	if merged.AgentMode != model.UserSkillAgentModeManual {
		t.Fatalf("merged agent mode = %q, want manual", merged.AgentMode)
	}
	if merged.AgentUseCount != 7 {
		t.Fatalf("merged use count = %d, want 7", merged.AgentUseCount)
	}
	if merged.AgentLastUsedAt == nil || !merged.AgentLastUsedAt.Equal(later) {
		t.Fatalf("merged last used = %v, want %v", merged.AgentLastUsedAt, later)
	}
	if merged.LibraryCategoryID != "category-target" {
		t.Fatalf("merged category = %q, want target category", merged.LibraryCategoryID)
	}
	if merged.InstalledVersionID != "target-v1" || !merged.CreatedAt.Equal(older) {
		t.Fatalf("merged references/timestamps = %#v", merged)
	}

	assertCount(t, db, &model.UserSkillState{}, 0, "skill_id = ?", "legacy-skill")
	assertCount(t, db, &model.Skill{}, 0, "id = ?", "legacy-skill")
	assertCount(t, db, &model.SkillVersion{}, 0, "skill_id = ?", "legacy-skill")
	assertCount(t, db, &model.SkillFile{}, 0, "skill_version_id = ?", "legacy-v1")
	assertCount(t, db, &model.SkillCurationAssignment{}, 0, "skill_id = ?", "legacy-skill")
	assertCount(t, db, &model.SkillCurationRootAssignment{}, 0, "skill_id = ?", "legacy-skill")
	assertCount(t, db, &model.Skill{}, 1, "id = ?", "target-skill")
	assertCount(t, db, &model.SkillVersion{}, 1, "skill_id = ?", "target-skill")
	assertCount(t, db, &model.SkillFile{}, 1, "skill_version_id = ?", "target-v1")

	second, err := repo.RetireLegacyBuiltinSkills([]LegacySkillRetirement{{
		LegacyID: "legacy-skill",
		TargetID: "target-skill",
	}}, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if second.CreatedStates != 0 || second.MergedStates != 0 {
		t.Fatalf("second run changed states: %#v", second)
	}
	if err := db.First(&merged, "user_id = ? AND skill_id = ?", "user-b", "target-skill").Error; err != nil {
		t.Fatal(err)
	}
	if merged.AgentUseCount != 7 {
		t.Fatalf("second run re-counted agent usage: %d", merged.AgentUseCount)
	}
}

func TestRetireLegacyBuiltinSkillsKeepsLegacyDataWhenTargetUnavailable(t *testing.T) {
	cases := []struct {
		name      string
		target    *model.Skill
		tombstone bool
	}{
		{name: "target missing"},
		{name: "target disabled", target: &model.Skill{ID: "target-skill", Status: 0, CurrentVersionID: "target-v1"}},
		{name: "target has no current version", target: &model.Skill{ID: "target-skill", Status: 1}},
		{name: "target tombstoned", target: &model.Skill{ID: "target-skill", Status: 1, CurrentVersionID: "target-v1"}, tombstone: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo, db := legacySkillRepositoryFixture(t)
			legacy := model.Skill{ID: "legacy-skill", Name: "旧技能", Status: 1, SourceType: "builtin", CurrentVersionID: "legacy-v1"}
			if err := db.Create(&legacy).Error; err != nil {
				t.Fatal(err)
			}
			if tc.target != nil {
				if err := db.Create(tc.target).Error; err != nil {
					t.Fatal(err)
				}
			}
			if tc.tombstone {
				if err := db.Create(&model.BuiltinSkillTombstone{SkillID: "target-skill", DeletedBy: "admin", DeletedAt: time.Now().UTC()}).Error; err != nil {
					t.Fatal(err)
				}
			}
			state := model.UserSkillState{ID: "legacy-state", UserID: "user-a", SkillID: "legacy-skill", Added: true, Liked: true, InstalledVersionID: "legacy-v1"}
			if err := db.Create(&state).Error; err != nil {
				t.Fatal(err)
			}

			report, err := repo.RetireLegacyBuiltinSkills([]LegacySkillRetirement{{
				LegacyID: "legacy-skill",
				TargetID: "target-skill",
			}}, time.Now().UTC())
			if err != nil {
				t.Fatal(err)
			}
			if len(report.SkippedSkills) != 1 || report.SkippedSkills[0] != "legacy-skill" {
				t.Fatalf("skipped = %v, want legacy-skill", report.SkippedSkills)
			}
			if len(report.RetiredSkills) != 0 {
				t.Fatalf("retired = %v, want none", report.RetiredSkills)
			}
			assertCount(t, db, &model.Skill{}, 1, "id = ?", "legacy-skill")
			assertCount(t, db, &model.UserSkillState{}, 1, "skill_id = ?", "legacy-skill")
			assertCount(t, db, &model.UserSkillState{}, 0, "skill_id = ?", "target-skill")
		})
	}
}

func TestRetireLegacyBuiltinSkillsRollsBackWhenLegacyStatesRemain(t *testing.T) {
	repo, db := legacySkillRepositoryFixture(t)
	seedLegacySkillPair(t, db)

	state := model.UserSkillState{
		ID:                 "legacy-state",
		UserID:             "user-a",
		SkillID:            "legacy-skill",
		InstalledVersionID: "legacy-v1",
		Added:              true,
		Liked:              true,
	}
	if err := db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}

	report, err := repo.retireLegacyBuiltinSkills([]LegacySkillRetirement{{
		LegacyID: "legacy-skill",
		TargetID: "target-skill",
	}}, time.Now().UTC(), 0)
	if err == nil {
		t.Fatalf("retirement succeeded with residual legacy states: %#v", report)
	}
	if len(report.RetiredSkills) != 0 {
		t.Fatalf("retired = %v, want transaction rollback", report.RetiredSkills)
	}

	assertCount(t, db, &model.UserSkillState{}, 1, "skill_id = ?", "legacy-skill")
	assertCount(t, db, &model.UserSkillState{}, 0, "skill_id = ?", "target-skill")
	assertCount(t, db, &model.Skill{}, 1, "id = ?", "legacy-skill")
	assertCount(t, db, &model.SkillVersion{}, 1, "skill_id = ?", "legacy-skill")
	assertCount(t, db, &model.SkillFile{}, 1, "skill_version_id = ?", "legacy-v1")
}

func assertCount(t *testing.T, db *gorm.DB, value any, want int64, query string, args ...any) {
	t.Helper()
	var count int64
	if err := db.Model(value).Where(query, args...).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("count = %d, want %d", count, want)
	}
}
