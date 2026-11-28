package app

import (
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	_ "modernc.org/sqlite"
)

func newPureGoAppTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Dialector{
		DriverName: "sqlite",
		DSN:        filepath.Join(t.TempDir(), "app.db"),
	}, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func TestDramaWritingSkillReadsRetiredSkillWithHistoricalName(t *testing.T) {
	service, db, _, _ := creationTestServiceOnDatabase(t, newPureGoAppTestDB(t))
	if err := db.AutoMigrate(
		&model.SkillCurationAssignment{},
		&model.SkillCurationRootAssignment{},
	); err != nil {
		t.Fatal(err)
	}
	if err := service.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := service.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}

	const (
		legacyID   = "16000000000084"
		targetID   = "14811816983052"
		legacyName = "故事结构引擎"
		cardPath   = "cards/mckee-story-structure.md"
	)
	expected, err := service.SkillPackageFile("user", targetID, cardPath)
	if err != nil {
		t.Fatal(err)
	}
	writing, err := service.dramaWritingSkill("user", &DramaSkillRef{
		SkillID:   legacyID,
		SkillName: legacyName,
		Path:      cardPath,
	}, "写作")
	if err != nil {
		t.Fatal(err)
	}
	if writing == nil || writing.Name != legacyName || writing.Path != cardPath || writing.Content != expected.Content {
		t.Fatalf("historical drama skill = %#v", writing)
	}
}

func TestDramaWritingSkillReadsRetiredShortfilmWithHistoricalName(t *testing.T) {
	service, db, _, _ := creationTestServiceOnDatabase(t, newPureGoAppTestDB(t))
	if err := db.AutoMigrate(
		&model.SkillCurationAssignment{},
		&model.SkillCurationRootAssignment{},
	); err != nil {
		t.Fatal(err)
	}
	if err := service.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := service.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}

	const (
		legacyID   = "16000000000080"
		targetID   = "14811816983052"
		legacyName = "短片五阶段结构"
		cardPath   = "cards/shortfilm-multi-shot-lock.md"
	)
	expected, err := service.SkillPackageFile("user", targetID, cardPath)
	if err != nil {
		t.Fatal(err)
	}
	writing, err := service.dramaWritingSkill("user", &DramaSkillRef{
		SkillID:   legacyID,
		SkillName: legacyName,
		Path:      cardPath,
	}, "写作")
	if err != nil {
		t.Fatal(err)
	}
	if writing == nil || writing.Name != legacyName || writing.Path != cardPath || writing.Content != expected.Content {
		t.Fatalf("historical shortfilm skill = %#v", writing)
	}
}
