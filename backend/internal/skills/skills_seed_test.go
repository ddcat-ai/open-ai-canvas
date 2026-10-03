package skills

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// 总纲名录里写死的 `cards/…` 路径会被 Agent 直接交给 skill_read_file；
// 包里缺卡时只会在运行时报「读取参考资料失败」，所以在这里提前拦住。
func TestBuiltinPackagesShipReferencedCards(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	legacyMissing := map[string]bool{}
	for _, name := range []string{
		"broken-windows", "connectors", "emotion-arousal-model", "emotion-injection",
		"maven-trap", "mavens", "message-over-messenger", "motivation-crowding",
		"power-of-context", "prospect-theory-packaging", "publicity-backfire",
		"rule-of-100", "rule-of-150", "salesmen", "social-currency",
		"stepps-diagnostic", "stickiness-factor", "tipping-point", "toxic-parasite",
		"translator-role", "trigger-evaluation", "trigger-habitat", "trojan-horse",
		"visibility-design", "werther-effect", "wom-diagnosis", "x-account-pitfalls",
		"x-account-setup", "x-benchmark-research", "x-cold-start-playbook",
		"x-comment-engagement", "x-content-archetypes", "x-data-review",
		"x-five-piece-checklist", "x-foryou-algorithm", "x-four-saves",
		"x-longtail-strategy", "x-monetization-pyramid", "x-positioning-tradeoff",
		"x-short-content-craft", "x-three-translations",
	} {
		legacyMissing["cards/"+name+".md"] = false
	}
	// 只认具体文件名；`cards/<slug>.md` 这类占位写法不算引用。
	reference := regexp.MustCompile("`(cards/[^`<>\\s]+\\.md)`")
	for _, item := range packages {
		for _, match := range reference.FindAllStringSubmatch(string(item.archive.Files["SKILL.md"]), -1) {
			if _, ok := item.archive.Files[match[1]]; !ok {
				if item.skill.ID == "16000000000106" {
					if _, known := legacyMissing[match[1]]; known {
						legacyMissing[match[1]] = true
						continue
					}
				}
				t.Errorf("builtin skill %s (%s) references missing %s", item.skill.ID, item.skill.Name, match[1])
			}
		}
	}
	for path, found := range legacyMissing {
		if !found {
			t.Errorf("legacy STEPPS missing-card exception no longer matches %s", path)
		}
	}
}

func TestBuiltinMarkdownPackagesPreserveHistoryAndUserState(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}, &model.User{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	const historyID = "16000000000081"
	state := model.UserSkillState{ID: "test-state", UserID: "test-user", SkillID: historyID, Added: true, Liked: true}
	if err := db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.Skill{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != int64(len(packages)) {
		t.Fatalf("builtin skill count = %d, want %d", count, len(packages))
	}
	var saved model.UserSkillState
	if err := db.First(&saved, "id = ?", state.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !saved.Added || !saved.Liked {
		t.Fatalf("user state lost: %#v", saved)
	}
	var skill model.Skill
	if err := db.First(&skill, "id = ?", historyID).Error; err != nil {
		t.Fatal(err)
	}
	if skill.CurrentVersionID == "" || skill.FileCount < 1 {
		t.Fatalf("history skill package not initialized: %#v", skill)
	}
}

func TestBuiltinSkillPackageMetadataParser(t *testing.T) {
	body := []byte("---\nname: 测试\ndescription: 描述\nmetadata:\n  version: \"1.0.0\"\n  tag: drama\n---\n\n正文\n")
	metadata, err := parseBuiltinSkillMetadata(body)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Name != "测试" || metadata.Description != "描述" || metadata.Version != "1.0.0" || metadata.Tag != "drama" {
		t.Fatalf("metadata = %#v", metadata)
	}
	if _, err := parseBuiltinSkillMetadata([]byte("# no frontmatter")); err == nil {
		t.Fatal("expected missing frontmatter error")
	}
}

func TestBuiltinMarkdownSeedPreservesDisabledPrivateCollision(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}, &model.User{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil || len(packages) == 0 {
		t.Fatalf("read builtin packages: %v", err)
	}
	id := packages[0].skill.ID
	existing := model.Skill{ID: id, OwnerID: "custom-owner", AuthorName: "Custom author", Name: "Saved title", Description: "Saved description", Instruction: "# Saved body", Status: 0, IsPrivate: true, Source: 3, Tag: "creative", ShowcaseMediaJSON: "[]"}
	if err := db.Create(&existing).Error; err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	for i := 0; i < 2; i++ {
		svc = New(repository.New(db), svc.dataDir, nil)
		if err := svc.EnsureBuiltinSkills(); err != nil {
			t.Fatal(err)
		}
		if err := svc.EnsureSkillPackages(); err != nil {
			t.Fatal(err)
		}
	}
	var saved model.Skill
	if err := db.First(&saved, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	if saved.OwnerID != existing.OwnerID || saved.AuthorName != existing.AuthorName || saved.Name != existing.Name || saved.Instruction != existing.Instruction || saved.Status != 0 || !saved.IsPrivate {
		t.Fatalf("builtin seed overwrote disabled private collision: %+v", saved)
	}
	if _, err := svc.SkillDetail("reader", id); err == nil {
		t.Fatal("disabled private collision became readable")
	}
}

func TestBuiltinMarkdownSeedPreservesExistingVersionAndReferenceFile(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}, &model.User{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil || len(packages) < 2 {
		t.Fatalf("load builtin catalog: %v", err)
	}
	id := packages[0].skill.ID
	svc := New(repository.New(db), t.TempDir(), nil)
	archive, err := archiveFromZip(skillZip(t, map[string]string{
		"SKILL.md":             "---\nname: Saved custom entry\ndescription: Saved package policy\n---\n\n# Saved custom entry\n",
		"references/policy.md": "Saved owner's reference",
	}), "")
	if err != nil {
		t.Fatal(err)
	}
	_, version, files, err := svc.persistSkillArchive(id, "saved-version", archive, "saved-commit")
	if err != nil {
		t.Fatal(err)
	}
	previousArchive, err := archiveFromMarkdown([]byte("# Saved previous edition\n\nOwner's older instructions\n"), "Saved previous edition", "Owner's older instructions")
	if err != nil {
		t.Fatal(err)
	}
	_, previousVersion, previousFiles, err := svc.persistSkillArchive(id, "saved-previous-version", previousArchive, "previous-commit")
	if err != nil {
		t.Fatal(err)
	}
	skill := model.Skill{ID: id, OwnerID: "saved-owner", AuthorName: "Saved author", Name: "Saved title", Instruction: "# Saved body", Status: skillStatusEnabled, Source: 3, SourceType: "github", SourceCommit: "saved-commit", IsPrivate: true, CurrentVersionID: version.ID, ContentHash: archive.ContentHash, FileCount: len(files), TotalBytes: archive.TotalBytes}
	state := model.UserSkillState{ID: "saved-state", UserID: "saved-owner", SkillID: id, Added: true, Liked: true, InstalledVersionID: previousVersion.ID}
	for _, value := range []any{&skill, previousVersion, &previousFiles, version, &files, &state} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	for run := 0; run < 2; run++ {
		svc = New(repository.New(db), svc.dataDir, nil)
		if err := svc.EnsureBuiltinSkills(); err != nil {
			t.Fatal(err)
		}
		if err := svc.EnsureSkillPackages(); err != nil {
			t.Fatal(err)
		}
		var saved model.Skill
		if err := db.First(&saved, "id = ?", id).Error; err != nil {
			t.Fatal(err)
		}
		if saved.OwnerID != skill.OwnerID || saved.AuthorName != skill.AuthorName || saved.Instruction != skill.Instruction || saved.CurrentVersionID != version.ID || saved.ContentHash != archive.ContentHash || !saved.IsPrivate {
			t.Fatalf("run %d changed saved skill: %+v", run, saved)
		}
		assertSkillVersionCount(t, db, id, 2)
		var fileCount, previousFileCount, stateCount int64
		if err := db.Model(&model.SkillFile{}).Where("skill_version_id = ?", version.ID).Count(&fileCount).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.SkillFile{}).Where("skill_version_id = ?", previousVersion.ID).Count(&previousFileCount).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.UserSkillState{}).Where("id = ? AND installed_version_id = ? AND added = ? AND liked = ?", state.ID, previousVersion.ID, true, true).Count(&stateCount).Error; err != nil {
			t.Fatal(err)
		}
		if fileCount != 2 || previousFileCount != 1 || stateCount != 1 {
			t.Fatalf("run %d lost package history or user state: current=%d previous=%d state=%d", run, fileCount, previousFileCount, stateCount)
		}
		oldEntry, err := svc.readSkillArchiveEntry(previousVersion, "SKILL.md")
		if err != nil || string(oldEntry) != "# Saved previous edition\n\nOwner's older instructions\n" {
			t.Fatalf("run %d changed installed historical package: %q, %v", run, oldEntry, err)
		}
		if _, err := svc.SkillPackageBundle("reader", id); err == nil {
			t.Fatal("private bundle became public")
		}
		bundle, err := svc.SkillPackageBundle("saved-owner", id)
		if err != nil || bundle.VersionID != version.ID || len(bundle.Files) != 2 {
			t.Fatalf("run %d changed saved package: %+v, %v", run, bundle, err)
		}
		entry, err := base64.StdEncoding.DecodeString(bundle.Files[0].ContentBase64)
		if err != nil || bundle.Files[0].Path != "SKILL.md" || string(entry) != "---\nname: Saved custom entry\ndescription: Saved package policy\n---\n\n# Saved custom entry\n" {
			t.Fatalf("run %d changed saved entry: %v", run, err)
		}
		file, err := svc.SkillPackageFile("saved-owner", id, "references/policy.md")
		if err != nil || file.Content != "Saved owner's reference" {
			t.Fatalf("run %d changed saved reference: %+v, %v", run, file, err)
		}
	}
}

func TestBuiltinMarkdownTombstoneRequiresAdminAndDoesNotReseed(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}, &model.User{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil || len(packages) == 0 {
		t.Fatalf("load builtin packages: %v", err)
	}
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	id := packages[0].skill.ID
	if err := svc.DeleteBuiltinSkill(&model.User{ID: "reader", Role: model.UserRoleUser}, id); err == nil {
		t.Fatal("nonadmin deleted builtin skill")
	}
	if err := svc.DeleteBuiltinSkill(&model.User{ID: "admin", Role: model.UserRoleAdmin}, id); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.Skill{}).Where("id = ?", id).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("deleted builtin was reseeded: count=%d err=%v", count, err)
	}
	for _, packageItem := range packages[1:] {
		if err := db.Create(&model.BuiltinSkillTombstone{SkillID: packageItem.skill.ID, DeletedBy: "admin"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc = New(repository.New(db), svc.dataDir, nil)
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatalf("all builtin IDs tombstoned: %v", err)
	}
	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatalf("all builtin IDs tombstoned during package ensure: %v", err)
	}
}

func TestBuiltinMarkdownInitialInsertFailureLeavesNoHalfPackage(t *testing.T) {
	for _, failure := range []struct {
		name, table string
	}{
		{"version", "skill_versions"},
		{"file", "skill_files"},
	} {
		t.Run(failure.name, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.db")), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}); err != nil {
				t.Fatal(err)
			}
			packages, err := loadBuiltinSkillPackages(nil)
			if err != nil || len(packages) == 0 {
				t.Fatalf("load builtin packages: %v", err)
			}
			id := packages[0].skill.ID
			trigger := "task3_reject_builtin_" + failure.name
			if err := db.Exec("CREATE TRIGGER " + trigger + " BEFORE INSERT ON " + failure.table + " BEGIN SELECT RAISE(FAIL, 'synthetic " + failure.name + " insert failure'); END").Error; err != nil {
				t.Fatal(err)
			}
			dataDir := t.TempDir()
			svc := New(repository.New(db), dataDir, nil)
			if err := svc.EnsureBuiltinSkills(); err == nil || !strings.Contains(err.Error(), "synthetic "+failure.name+" insert failure") {
				t.Fatalf("forced %s insert failure not observed: %v", failure.name, err)
			}
			var skills, versions, files, orphanVersions, orphanFiles int64
			if err := db.Model(&model.Skill{}).Where("id = ?", id).Count(&skills).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.SkillVersion{}).Where("skill_id = ?", id).Count(&versions).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Table("skill_files").Where("skill_version_id IN (SELECT id FROM skill_versions WHERE skill_id = ?)", id).Count(&files).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.SkillVersion{}).Count(&orphanVersions).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.SkillFile{}).Count(&orphanFiles).Error; err != nil {
				t.Fatal(err)
			}
			if skills != 0 || versions != 0 || files != 0 || orphanVersions != 0 || orphanFiles != 0 {
				t.Fatalf("%s failure retained rows: skill=%d versions=%d files=%d orphanVersions=%d orphanFiles=%d", failure.name, skills, versions, files, orphanVersions, orphanFiles)
			}
			entries, err := os.ReadDir(filepath.Join(dataDir, "skill-packages", id))
			if err != nil && !os.IsNotExist(err) {
				t.Fatal(err)
			}
			if len(entries) != 0 {
				t.Fatalf("failed package file was not removed: %d", len(entries))
			}
			if err := db.Exec("DROP TRIGGER " + trigger).Error; err != nil {
				t.Fatal(err)
			}
			if err := svc.EnsureBuiltinSkills(); err != nil {
				t.Fatal(err)
			}
			if _, err := svc.SkillPackageBundle("reader", id); err != nil {
				t.Fatalf("retry package unreadable: %v", err)
			}
		})
	}
}
