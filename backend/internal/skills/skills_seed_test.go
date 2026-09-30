package skills

import (
	"path/filepath"
	"regexp"
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
	// 只认具体文件名；`cards/<slug>.md` 这类占位写法不算引用。
	reference := regexp.MustCompile("`(cards/[^`<>\\s]+\\.md)`")
	for _, item := range packages {
		for _, match := range reference.FindAllStringSubmatch(string(item.archive.Files["SKILL.md"]), -1) {
			if _, ok := item.archive.Files[match[1]]; !ok {
				t.Errorf("builtin skill %s (%s) references missing %s", item.skill.ID, item.skill.Name, match[1])
			}
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
