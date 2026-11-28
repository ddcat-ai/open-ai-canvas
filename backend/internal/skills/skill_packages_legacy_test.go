package skills

import (
	"net/http"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	_ "modernc.org/sqlite"
)

func newLegacySkillFileTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Dialector{
		DriverName: "sqlite",
		DSN:        filepath.Join(t.TempDir(), "skills.db"),
	}, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(
		&model.Skill{},
		&model.SkillVersion{},
		&model.SkillFile{},
		&model.UserSkillState{},
		&model.User{},
		&model.UserIdentity{},
		&model.BuiltinSkillTombstone{},
		&model.SkillCurationAssignment{},
		&model.SkillCurationRootAssignment{},
	); err != nil {
		t.Fatal(err)
	}
	service := New(repository.New(db), t.TempDir(), nil)
	if err := service.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := service.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	createSkillTestUser(t, db, "reader", model.UserRoleUser, model.UserStatusActive)
	return service, db
}

func createLegacySkillFileFixture(t *testing.T, db *gorm.DB, instruction string) {
	t.Helper()
	if err := db.Create(&model.Skill{
		ID:          "16000000000084",
		Name:        "故事结构引擎",
		Instruction: instruction,
		Status:      skillStatusEnabled,
		SourceType:  "builtin",
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestSkillPackageFileResolvesRetiredLegacyID(t *testing.T) {
	service, _ := newLegacySkillFileTestService(t)
	const (
		legacyID = "16000000000084"
		targetID = "14811816983052"
		cardPath = "cards/mckee-story-structure.md"
	)

	entry, err := service.SkillPackageFile("reader", legacyID, "SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	targetEntry, err := service.SkillPackageFile("reader", targetID, "SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Content != targetEntry.Content || !strings.Contains(entry.Content, `name: "故事与影像制作-源起"`) {
		t.Fatalf("legacy SKILL.md did not resolve to the stable package: %#v", entry.File)
	}

	card, err := service.SkillPackageFile("reader", legacyID, cardPath)
	if err != nil {
		t.Fatal(err)
	}
	targetCard, err := service.SkillPackageFile("reader", targetID, cardPath)
	if err != nil {
		t.Fatal(err)
	}
	if card.File.Path != cardPath || card.Content != targetCard.Content || strings.TrimSpace(card.Content) == "" {
		t.Fatalf("legacy card did not resolve by exact path: %#v", card.File)
	}

	files, err := service.SkillPackageFiles("reader", legacyID)
	if err != nil {
		t.Fatal(err)
	}
	targetFiles, err := service.SkillPackageFiles("reader", targetID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(files, targetFiles) {
		t.Fatalf("legacy file listing did not resolve to stable package")
	}

	raw, mimeType, fileName, err := service.SkillPackageRawFile("reader", legacyID, cardPath)
	if err != nil {
		t.Fatal(err)
	}
	targetRaw, targetMimeType, targetFileName, err := service.SkillPackageRawFile("reader", targetID, cardPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(targetRaw) || mimeType != targetMimeType || fileName != targetFileName {
		t.Fatalf("legacy raw file did not resolve to stable package")
	}

	bundle, err := service.SkillPackageBundle("reader", legacyID)
	if err != nil {
		t.Fatal(err)
	}
	targetBundle, err := service.SkillPackageBundle("reader", targetID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(bundle, targetBundle) || bundle.SkillID != targetID {
		t.Fatalf("legacy bundle did not resolve to stable package: %s", bundle.SkillID)
	}

	results, err := service.SearchSkillPackage("reader", legacyID, "故事")
	if err != nil {
		t.Fatal(err)
	}
	targetResults, err := service.SearchSkillPackage("reader", targetID, "故事")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) == 0 || !reflect.DeepEqual(results, targetResults) {
		t.Fatalf("legacy package search did not resolve to stable package")
	}
}

func TestSkillPackageFileResolvesRetiredShortfilmPaths(t *testing.T) {
	service, _ := newLegacySkillFileTestService(t)
	const (
		legacyID = "16000000000080"
		targetID = "14811816983052"
	)
	entry, err := service.SkillPackageFile("reader", legacyID, "SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	targetEntry, err := service.SkillPackageFile("reader", targetID, "SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if entry.Content != targetEntry.Content || !strings.Contains(entry.Content, `name: "故事与影像制作-源起"`) {
		t.Fatalf("shortfilm legacy SKILL.md did not resolve to the stable package: %#v", entry.File)
	}

	for _, cardPath := range []string{
		"cards/short-narrative-structure.md",
		"cards/shortfilm-5stage-structure.md",
		"cards/shortfilm-micro-drama.md",
		"cards/shortfilm-multi-shot-lock.md",
		"cards/shortfilm-template-branch.md",
		"cards/shortfilm-ip-safety.md",
	} {
		card, err := service.SkillPackageFile("reader", legacyID, cardPath)
		if err != nil {
			t.Fatalf("%s: %v", cardPath, err)
		}
		targetCard, err := service.SkillPackageFile("reader", targetID, cardPath)
		if err != nil {
			t.Fatalf("target %s: %v", cardPath, err)
		}
		if card.File.Path != cardPath || card.Content != targetCard.Content || strings.TrimSpace(card.Content) == "" {
			t.Fatalf("shortfilm legacy card %s did not resolve by exact path: %#v", cardPath, card.File)
		}
	}
}

func TestSkillPackageFileLegacyFallbackRejectsMissingFile(t *testing.T) {
	service, _ := newLegacySkillFileTestService(t)
	_, err := service.SkillPackageFile("reader", "16000000000084", "cards/not-shipped.md")
	requireAppError(t, err, http.StatusBadRequest, "")
	if !strings.Contains(err.Error(), "技能文件不存在") {
		t.Fatalf("error = %v, want missing file", err)
	}
}

func TestSkillPackageFilePrefersExistingLegacyPackage(t *testing.T) {
	service, db := newLegacySkillFileTestService(t)
	createLegacySkillFileFixture(t, db, "# 旧版故事结构\n\n旧包正文。\n")

	file, err := service.SkillPackageFile("reader", "16000000000084", "SKILL.md")
	if err != nil {
		t.Fatal(err)
	}
	if file.Content != "# 旧版故事结构\n\n旧包正文。\n" {
		t.Fatalf("existing legacy package was replaced: %q", file.Content)
	}

	files, err := service.SkillPackageFiles("reader", "16000000000084")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Path != "SKILL.md" {
		t.Fatalf("existing legacy file listing was replaced: %#v", files)
	}

	bundle, err := service.SkillPackageBundle("reader", "16000000000084")
	if err != nil {
		t.Fatal(err)
	}
	if bundle.SkillID != "16000000000084" || len(bundle.Files) != 1 {
		t.Fatalf("existing legacy bundle was replaced: %#v", bundle)
	}

	results, err := service.SearchSkillPackage("reader", "16000000000084", "旧包正文")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].Path != "SKILL.md" {
		t.Fatalf("existing legacy search was replaced: %#v", results)
	}
}

func TestSkillPackageFileDoesNotFallbackWhenLegacyPackageLacksFile(t *testing.T) {
	service, db := newLegacySkillFileTestService(t)
	createLegacySkillFileFixture(t, db, "# 旧版故事结构\n")

	_, err := service.SkillPackageFile("reader", "16000000000084", "cards/mckee-story-structure.md")
	requireAppError(t, err, http.StatusBadRequest, "")
	if !strings.Contains(err.Error(), "技能文件不存在") {
		t.Fatalf("error = %v, want legacy missing file", err)
	}
}

func TestSkillPackageFileLegacyFallbackPreservesAuthorization(t *testing.T) {
	t.Run("login required", func(t *testing.T) {
		service, _ := newLegacySkillFileTestService(t)
		for name, call := range legacyPackageCalls(service, "") {
			_, err := call()
			if err == nil {
				t.Fatalf("%s: expected error", name)
			}
			requireAppError(t, err, http.StatusUnauthorized, "")
		}
	})

	t.Run("disabled account", func(t *testing.T) {
		service, db := newLegacySkillFileTestService(t)
		createSkillTestUser(t, db, "banned", model.UserRoleUser, model.UserStatusDisabled)
		for name, call := range legacyPackageCalls(service, "banned") {
			_, err := call()
			if err == nil {
				t.Fatalf("%s: expected error", name)
			}
			requireAppError(t, err, http.StatusForbidden, "")
		}
	})

	t.Run("private target", func(t *testing.T) {
		service, db := newLegacySkillFileTestService(t)
		if err := db.Model(&model.Skill{}).Where("id = ?", "14811816983052").Update("is_private", true).Error; err != nil {
			t.Fatal(err)
		}
		for name, call := range legacyPackageCalls(service, "reader") {
			_, err := call()
			if err == nil {
				t.Fatalf("%s: expected error", name)
			}
			requireAppError(t, err, http.StatusForbidden, "")
		}
	})
}

func legacyPackageCalls(service *Service, userID string) map[string]func() (any, error) {
	const (
		legacyID = "16000000000084"
		cardPath = "cards/mckee-story-structure.md"
	)
	return map[string]func() (any, error){
		"files": func() (any, error) {
			return service.SkillPackageFiles(userID, legacyID)
		},
		"file": func() (any, error) {
			return service.SkillPackageFile(userID, legacyID, "SKILL.md")
		},
		"raw": func() (any, error) {
			data, _, _, err := service.SkillPackageRawFile(userID, legacyID, cardPath)
			return data, err
		},
		"bundle": func() (any, error) {
			return service.SkillPackageBundle(userID, legacyID)
		},
		"search": func() (any, error) {
			return service.SearchSkillPackage(userID, legacyID, "故事")
		},
	}
}
