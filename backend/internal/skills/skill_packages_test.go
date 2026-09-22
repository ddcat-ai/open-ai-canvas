package skills

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestArchiveFromMarkdownInfersMetadata(t *testing.T) {
	archive, err := archiveFromMarkdown([]byte("# 小说转分镜\n\n把小说段落拆成可拍摄的镜头。\n"), "", "")
	if err != nil {
		t.Fatal(err)
	}
	if archive.Metadata.Name != "小说转分镜" || archive.Metadata.Description != "把小说段落拆成可拍摄的镜头。" {
		t.Fatalf("metadata = %#v", archive.Metadata)
	}
	if string(archive.Files["SKILL.md"]) == "" || archive.ContentHash == "" {
		t.Fatal("archive did not preserve the entry file or compute a hash")
	}
}

func TestBuiltinSkillPackageBoundsMetadata(t *testing.T) {
	skill := builtinSkillDefinition{
		SkillID:     "test-builtin-skill",
		SkillName:   "测试技能",
		Description: strings.Repeat("描述内容。", 140),
		Instruction: "# 测试技能\n\n保留完整正文。\n",
	}
	archive, err := archiveFromMarkdown([]byte(skill.Instruction), skill.SkillName, skill.Description)
	if err != nil {
		t.Fatal(err)
	}
	if got := len([]rune(archive.Metadata.Description)); got > 500 {
		t.Fatalf("builtin skill metadata description length = %d, want <= 500", got)
	}
	if string(archive.Files["SKILL.md"]) != skill.Instruction {
		t.Fatal("builtin skill package must preserve the complete instruction")
	}
}

func TestEnsureSkillPackagesBoundsLegacyFallbackMetadata(t *testing.T) {
	for _, source := range []int{3, skillSourceUser} {
		db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = sqlDB.Close() })
		if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
			t.Fatal(err)
		}
		svc := New(repository.New(db), t.TempDir(), nil)
		skill := model.Skill{ID: kernel.NewID(), Name: strings.Repeat("名", 81), Description: strings.Repeat("文", 503), Instruction: "## 旧技能\n", Status: skillStatusEnabled, Source: source}
		if err := db.Create(&skill).Error; err != nil {
			t.Fatal(err)
		}
		for range 2 {
			if err := svc.EnsureSkillPackages(); err != nil {
				t.Fatal(err)
			}
		}
		assertSkillVersionCount(t, db, skill.ID, 1)
		var saved model.Skill
		if err := db.First(&saved, "id = ?", skill.ID).Error; err != nil {
			t.Fatal(err)
		}
		if saved.Name != skill.Name || saved.Description != skill.Description || saved.Instruction != skill.Instruction {
			t.Fatal("migration changed original skill fields")
		}
		version, err := svc.repo.SkillVersion(saved.CurrentVersionID)
		if err != nil {
			t.Fatal(err)
		}
		body, err := svc.readSkillArchiveEntry(version, "SKILL.md")
		if err != nil || string(body) != skill.Instruction {
			t.Fatalf("original instruction not preserved: %v", err)
		}
	}
	if _, err := archiveFromMarkdown([]byte("## 旧技能\n"), strings.Repeat("名", 81), strings.Repeat("文", 503)); err == nil {
		t.Fatal("non-migration archive input must still reject oversized fallback metadata")
	}
}

func TestArchiveFromMarkdownTruncatesInferredDescriptionWithinLimit(t *testing.T) {
	longDescription := bytes.Repeat([]byte("描述内容。"), 140)
	data := append([]byte("# 风格库四级匹配序\n\n"), longDescription...)

	archive, err := archiveFromMarkdown(data, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if got := len([]rune(archive.Metadata.Description)); got > 500 {
		t.Fatalf("inferred description length = %d, want <= 500", got)
	}
	if archive.Metadata.Description == "" {
		t.Fatal("inferred description is empty")
	}
	if !bytes.Equal(archive.Files["SKILL.md"], data) {
		t.Fatal("metadata truncation changed the original instruction")
	}
}

func TestSkillMetadataLengthBoundaries(t *testing.T) {
	for _, length := range []int{499, 500, 501, 553} {
		value := strings.Repeat("文", length)
		markdown := []byte("# 技能\n\n" + value)
		archive, err := archiveFromMarkdown(markdown, "", "")
		if err != nil {
			t.Fatalf("description length %d: %v", length, err)
		}
		want := value
		if length > 500 {
			want = strings.Repeat("文", 497) + "..."
		}
		if archive.Metadata.Description != want {
			t.Fatalf("description length %d: unexpected truncation", length)
		}
	}
	metadata := parseSkillPackageMetadata([]byte("---\nname: " + strings.Repeat("名", 81) + "\ndescription: " + strings.Repeat("文", 501) + "\nmetadata:\n  version: " + strings.Repeat("版", 65) + "\n---\n"))
	if len([]rune(metadata.Name)) != 80 || len([]rune(metadata.Description)) != 500 || len([]rune(metadata.Version)) != 64 {
		t.Fatalf("metadata exceeds bounds: %#v", metadata)
	}
	// Supplied metadata still goes through strict validation; no widening of
	// the archive contract is needed to fix inferred display metadata.
	if _, err := finalizeSkillArchive(map[string][]byte{"SKILL.md": []byte("# 技能")}, skillPackageMetadata{Name: "技能", Description: strings.Repeat("文", 501)}); err == nil {
		t.Fatal("expected overlong archive metadata to be rejected")
	}
}

func TestArchiveFromZipNormalizesWrapperAndNestedFiles(t *testing.T) {
	data := skillZip(t, map[string]string{
		"director-main/SKILL.md":             "---\nname: AI 导演\ndescription: 导演工作流\nmetadata:\n  version: 2.1\n---\n",
		"director-main/references/camera.md": "# Camera",
		"director-main/scripts/check.js":     "export default true",
	})
	archive, err := archiveFromZip(data, "")
	if err != nil {
		t.Fatal(err)
	}
	if archive.Metadata.Version != "2.1" || len(archive.Files) != 3 {
		t.Fatalf("archive = %#v", archive)
	}
	if string(archive.Files["references/camera.md"]) != "# Camera" {
		t.Fatalf("nested file missing: %#v", archive.Files)
	}
}

func TestArchiveFromZipRejectsTraversalAndMultipleSkills(t *testing.T) {
	for name, files := range map[string]map[string]string{
		"traversal": {"../SKILL.md": "# Bad"},
		"multiple": {
			"one/SKILL.md": "# One\n\nFirst",
			"two/SKILL.md": "# Two\n\nSecond",
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := archiveFromZip(skillZip(t, files), ""); err == nil {
				t.Fatal("expected package validation error")
			}
		})
	}
}

func TestParseGitHubSkillURL(t *testing.T) {
	spec, err := parseGitHubSkillURL("https://github.com/ddcat-ai/open-ai-canvas/tree/main/skills/canvas-context", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if spec.Owner != "ddcat-ai" || spec.Repo != "open-ai-canvas" || spec.Ref != "main" || spec.Subdir != "skills/canvas-context" {
		t.Fatalf("spec = %#v", spec)
	}
	if _, err := parseGitHubSkillURL("https://github.com/ddcat-ai/open-ai-canvas/blob/main/SKILL.md", "", ""); err == nil {
		t.Fatal("expected blob URL to be rejected")
	}
}

func TestEnsureSkillPackagesMigratesAndRefreshesBuiltinSkills(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Skill{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	builtin := model.Skill{ID: kernel.NewID(), Name: "内置导演", Description: "内置工作流", Instruction: "# 内置导演\n\n第一版", Status: skillStatusEnabled, Source: 3}
	userSkill := model.Skill{ID: kernel.NewID(), Name: "用户技能", Description: "用户工作流", Instruction: "# 用户技能\n\n第一版", Status: skillStatusEnabled, Source: skillSourceUser}
	if err := db.Create(&builtin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&userSkill).Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	assertSkillVersionCount(t, db, builtin.ID, 1)
	assertSkillVersionCount(t, db, userSkill.ID, 1)

	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	assertSkillVersionCount(t, db, builtin.ID, 1)
	assertSkillVersionCount(t, db, userSkill.ID, 1)

	if err := db.Model(&model.Skill{}).Where("id = ?", builtin.ID).Update("instruction", "# 内置导演\n\n第二版").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", userSkill.ID).Update("instruction", "# 用户技能\n\n不应在启动时重建").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	assertSkillVersionCount(t, db, builtin.ID, 2)
	assertSkillVersionCount(t, db, userSkill.ID, 1)

	var refreshed model.Skill
	if err := db.First(&refreshed, "id = ?", builtin.ID).Error; err != nil {
		t.Fatal(err)
	}
	wantArchive, err := archiveFromMarkdown([]byte(refreshed.Instruction), refreshed.Name, refreshed.Description)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.ContentHash != wantArchive.ContentHash || refreshed.CurrentVersionID == "" {
		t.Fatalf("builtin package was not refreshed: %#v", refreshed)
	}
}

func assertSkillVersionCount(t *testing.T, db *gorm.DB, skillID string, want int64) {
	t.Helper()
	var got int64
	if err := db.Model(&model.SkillVersion{}).Where("skill_id = ?", skillID).Count(&got).Error; err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("skill %s version count = %d, want %d", skillID, got, want)
	}
}

func skillZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for filePath, content := range files {
		entry, err := writer.Create(filePath)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}
