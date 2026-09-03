package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newSkillVersionTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}, &model.UserSkillState{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func createPublicSkill(t *testing.T, db *gorm.DB) *model.Skill {
	t.Helper()
	skill := &model.Skill{ID: newID(), Name: "版本技能", Description: "测试", Status: skillStatusEnabled, Source: skillSourceUser}
	if err := db.Create(skill).Error; err != nil {
		t.Fatal(err)
	}
	return skill
}

// 相同内容重复写入应幂等：只保留一个版本，不重复落盘。
func TestSkillVersionIdempotentByContentHash(t *testing.T) {
	db := newSkillVersionTestDB(t)
	svc := New(repository.New(db), t.TempDir())
	skill := createPublicSkill(t, db)

	archive, err := archiveFromMarkdown([]byte("# 技能\n\n同一版内容"), skill.Name, skill.Description)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := svc.addSkillArchiveVersion(skill, archive, "markdown", "", "", "", "", false); err != nil {
			t.Fatalf("addSkillArchiveVersion #%d: %v", i, err)
		}
	}
	assertSkillVersionCount(t, db, skill.ID, 1)

	var refreshed model.Skill
	if err := db.First(&refreshed, "id = ?", skill.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.CurrentVersionID != skill.CurrentVersionID || refreshed.ContentHash != archive.ContentHash {
		t.Fatalf("current version not pointed at reused version: %#v", refreshed)
	}
}

// 不同内容产生新版本；列表倒序、当前版本标记正确；可激活（回滚）到历史版本。
func TestSkillVersionListAndActivate(t *testing.T) {
	db := newSkillVersionTestDB(t)
	svc := New(repository.New(db), t.TempDir())
	skill := createPublicSkill(t, db)

	archiveV1, err := archiveFromMarkdown([]byte("# 技能\n\n第一版"), skill.Name, skill.Description)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.addSkillArchiveVersion(skill, archiveV1, "markdown", "", "", "", "", false); err != nil {
		t.Fatal(err)
	}
	v1ID := skill.CurrentVersionID

	archiveV2, err := archiveFromMarkdown([]byte("# 技能\n\n第二版，内容不同"), skill.Name, skill.Description)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.addSkillArchiveVersion(skill, archiveV2, "markdown", "", "", "", "", false); err != nil {
		t.Fatal(err)
	}
	v2ID := skill.CurrentVersionID
	if v1ID == v2ID {
		t.Fatal("different content should create a new version")
	}
	assertSkillVersionCount(t, db, skill.ID, 2)

	versions, err := svc.ListSkillVersions("user-1", skill.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 {
		t.Fatalf("versions len = %d, want 2", len(versions))
	}
	// 倒序：最新（当前）版本在最前，且只有它被标记为 current。
	if versions[0].ID != v2ID || !versions[0].IsCurrent || versions[1].IsCurrent {
		t.Fatalf("version order/current flag wrong: %+v", versions)
	}

	// 回滚到 v1。
	activated, err := svc.ActivateSkillVersion("user-1", skill.ID, v1ID)
	if err != nil {
		t.Fatal(err)
	}
	if !activated.IsCurrent || activated.ID != v1ID {
		t.Fatalf("activate v1 failed: %+v", activated)
	}
	var refreshed model.Skill
	if err := db.First(&refreshed, "id = ?", skill.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.CurrentVersionID != v1ID || refreshed.ContentHash != archiveV1.ContentHash {
		t.Fatalf("current pointer not rolled back: %#v", refreshed)
	}
}

// 不能把别的技能的版本激活到当前技能。
func TestActivateSkillVersionRejectsForeignVersion(t *testing.T) {
	db := newSkillVersionTestDB(t)
	svc := New(repository.New(db), t.TempDir())
	skillA := createPublicSkill(t, db)
	skillB := createPublicSkill(t, db)

	archiveA, _ := archiveFromMarkdown([]byte("# A"), skillA.Name, skillA.Description)
	archiveB, _ := archiveFromMarkdown([]byte("# B"), skillB.Name, skillB.Description)
	if err := svc.addSkillArchiveVersion(skillA, archiveA, "markdown", "", "", "", "", false); err != nil {
		t.Fatal(err)
	}
	if err := svc.addSkillArchiveVersion(skillB, archiveB, "markdown", "", "", "", "", false); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.ActivateSkillVersion("user-1", skillA.ID, skillB.CurrentVersionID); err == nil {
		t.Fatal("expected rejection when activating a version belonging to another skill")
	}
}
