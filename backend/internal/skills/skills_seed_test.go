package skills

import (
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDoubaoAudioBuiltinUsesSupportedCategory(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range packages {
		if item.skill.ID == "doubao-audio-prompt" {
			if item.skill.Tag != "creative" {
				t.Fatalf("doubao audio category = %q, want creative", item.skill.Tag)
			}
			return
		}
	}
	t.Fatal("doubao-audio-prompt builtin is missing")
}

// 总纲名录里写死的 `cards/…`、`references/…` 路径会被 Agent 直接交给 skill_read_file；
// 包里缺卡时只会在运行时报「读取参考资料失败」，所以在这里提前拦住。
func TestBuiltinPackagesShipReferencedCards(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	// 只认具体文件名；`cards/<slug>.md` 这类占位写法不算引用。
	reference := regexp.MustCompile("`((?:cards|references)/[^`<>\\s]+\\.md)`")
	for _, item := range packages {
		for name, body := range item.archive.Files {
			// Agent 会直接读取根入口、cards/ 卡和 references/ 资料；
			// 其他历史分层文档有自己的引用约定，不能把它们当成统一入口来扫描。
			if name != "SKILL.md" &&
				!strings.HasPrefix(name, "cards/") &&
				!strings.HasPrefix(name, "references/") {
				continue
			}
			for _, match := range reference.FindAllStringSubmatch(string(body), -1) {
				referenced, ok := item.archive.Files[match[1]]
				if !ok {
					t.Errorf("builtin skill %s (%s) references missing %s from %s", item.skill.ID, item.skill.Name, match[1], name)
					continue
				}
				if len(strings.TrimSpace(string(referenced))) == 0 {
					t.Errorf("builtin skill %s (%s) ships empty %s referenced from %s", item.skill.ID, item.skill.Name, match[1], name)
				}
			}
		}
	}
}

// 核心生产技能的入口会随技能一起加载；完整流程和知识库必须放到 references/，
// 否则整合后仍然会占用大量上下文。
func TestCoreProductionEntryPointsStayCompact(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]builtinSkillPackage, len(packages))
	for _, item := range packages {
		byID[item.skill.ID] = item
	}
	limit := 24 * 1024
	for _, skillID := range []string{
		"14811816982540", // 世界观美术设定
		"14811816981772", // 一图成片-电影广告全能导演
		"14811816982028", // 系列套图生成
		"14811816970508", // 叙事短片导演分镜
	} {
		item, ok := byID[skillID]
		if !ok {
			t.Errorf("core production skill %s is missing", skillID)
			continue
		}
		entry := item.archive.Files["SKILL.md"]
		if len(entry) > limit {
			t.Errorf("core production skill %s (%s) entry is %d bytes, want <= %d",
				item.skill.ID, item.skill.Name, len(entry), limit)
		}
	}
}

// 迁移卡是旧名和旧 ID 唯一的落点，必须保留来源与许可，不能变成匿名空壳。
func TestConsolidatedMigrationCardsPreserveSourceAndLicense(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	found := 0
	for _, item := range packages {
		for name, body := range item.archive.Files {
			if !strings.HasSuffix(name, "-migration.md") {
				continue
			}
			found++
			text := string(body)
			if !strings.Contains(text, "\nsource:") {
				t.Errorf("%s/%s is missing a source field", item.skill.ID, name)
			}
			if !strings.Contains(strings.ToLower(text), "mit") {
				t.Errorf("%s/%s is missing a license declaration", item.skill.ID, name)
			}
		}
	}
	if found == 0 {
		t.Fatal("no migration cards were found")
	}
}

func TestConsolidatedBuiltinMarkdownHasNoNumberedReferencePaths(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	consolidated := map[string]bool{
		"AI 表演实验室":   true,
		"剧本撰写":       true,
		"故事与影像制作-源起": true,
		"角色设计":       true,
		"视觉提示词工程":    true,
	}
	legacyReference := regexp.MustCompile(`references/0[1-4]`)
	for _, item := range packages {
		if !consolidated[item.skill.Name] {
			continue
		}
		for name, body := range item.archive.Files {
			if !strings.HasSuffix(strings.ToLower(name), ".md") {
				continue
			}
			if match := legacyReference.Find(body); match != nil {
				t.Errorf("consolidated skill %s (%s) has legacy reference path %q in %s",
					item.skill.ID, item.skill.Name, match, name)
			}
		}
	}
}

func TestBuiltinMarkdownHasNoShellSubexpressionPlaceholders(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`\$\(System\.[A-Za-z][A-Za-z0-9_.]*\)`),
		regexp.MustCompile(`\$\(\$[A-Za-z_][A-Za-z0-9_.]*\)`),
	}
	for _, item := range packages {
		for name, body := range item.archive.Files {
			if !strings.HasSuffix(strings.ToLower(name), ".md") {
				continue
			}
			for _, pattern := range patterns {
				if match := pattern.Find(body); match != nil {
					t.Errorf("builtin skill %s (%s) ships unresolved shell placeholder %q in %s",
						item.skill.ID, item.skill.Name, match, name)
				}
			}
		}
	}
}

func TestConsolidatedLegacySkillPackagesAreRemoved(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	legacy := map[string]string{
		"14889899552012":           "AI演员微表情导演",
		"16000000000075":           "对白工坊",
		"16000000000076":           "剧本工业化机器",
		"16000000000084":           "故事结构引擎",
		"16000000000080":           "短片五阶段结构",
		"16000000000073":           "角色锻造工坊",
		"16000000000089":           "Freestyle 风格库",
		"16000000000103":           "提示词工程模式",
		"14811816981260":           "15秒极致夸张反转提示词",
		"14811816981004":           "15秒视觉特效",
		"16000000000082":           "情景喜剧工坊",
		"16000000000083":           "脱口秀手艺",
		"16000000000085":           "相声手艺",
		"14811816969740":           "珠宝设计进化",
		"yingce-image-annotation":  "图片标注编辑",
		"yingce-image-layer-split": "图片图层拆分",
	}
	for _, item := range packages {
		if name, ok := legacy[item.skill.ID]; ok {
			t.Errorf("legacy skill %s (%s) is still a top-level package", item.skill.ID, name)
		}
		for id, name := range legacy {
			if item.skill.Name == name {
				t.Errorf("legacy skill directory %s is still present as %s", name, id)
			}
		}
	}
}

func TestConsolidatedLegacyIndexCardsAreCompactAndResolvable(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]builtinSkillPackage, len(packages))
	for _, item := range packages {
		byID[item.skill.ID] = item
	}
	indexes := []struct {
		skillID string
		path    string
	}{
		{"16000000000086", "cards/microexpression-director-migration.md"},
		{"14811816982796", "cards/dialogue-workshop-migration.md"},
		{"14811816982796", "cards/factory-script-machine-migration.md"},
		{"14811816983052", "cards/story-structure-engine-migration.md"},
		{"14811816983052", "cards/shortfilm-5stage-structure.md"},
		{"14811816983052", "cards/shortfilm-micro-drama.md"},
		{"14811816983052", "cards/shortfilm-multi-shot-lock.md"},
		{"14811816983052", "cards/shortfilm-template-branch.md"},
		{"14811816983052", "cards/shortfilm-ip-safety.md"},
		{"14811816982284", "cards/character-forge-migration.md"},
		{"16000000000095", "cards/freestyle-style-library-migration.md"},
		{"16000000000095", "cards/prompt-engineering-patterns-migration.md"},
		{"16000000000095", "cards/video-reversal-prompt-migration.md"},
		{"16000000000095", "cards/video-visual-effect-prompt-migration.md"},
		{"16000000000074", "cards/sitcom-lab-migration.md"},
		{"16000000000074", "cards/standup-craft-migration.md"},
		{"16000000000074", "cards/xiangsheng-craft-migration.md"},
		{"14811816969484", "cards/evolution-migration.md"},
		{"yingce-image-editing", "cards/image-annotation-migration.md"},
		{"yingce-image-editing", "cards/image-layer-split-migration.md"},
	}
	reference := regexp.MustCompile("`(cards/[^`<>\\s]+\\.md)`")
	// These cards retain the original shortfilm text byte-for-byte for old
	// collections and deep links. They are compatibility payloads, not new
	// navigation indexes, so the compact-index cap does not apply.
	verbatimCompatibilityCards := map[string]bool{
		"cards/shortfilm-5stage-structure.md": true,
		"cards/shortfilm-micro-drama.md":      true,
		"cards/shortfilm-multi-shot-lock.md":  true,
		"cards/shortfilm-template-branch.md":  true,
		"cards/shortfilm-ip-safety.md":        true,
	}
	for _, index := range indexes {
		item, ok := byID[index.skillID]
		if !ok {
			t.Errorf("consolidated target skill %s is missing", index.skillID)
			continue
		}
		body, ok := item.archive.Files[index.path]
		if !ok {
			t.Errorf("skill %s (%s) is missing legacy index %s", index.skillID, item.skill.Name, index.path)
			continue
		}
		if !verbatimCompatibilityCards[index.path] && len(body) > 3*1024 {
			t.Errorf("legacy index %s/%s is %d bytes, want <= 3072", index.skillID, index.path, len(body))
		}
		for _, match := range reference.FindAllStringSubmatch(string(body), -1) {
			if _, ok := item.archive.Files[match[1]]; !ok {
				t.Errorf("legacy index %s/%s references missing card %s", index.skillID, index.path, match[1])
			}
		}
	}
}

func TestConsolidatedEntryPointsUseDirectNavigationLanguage(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]builtinSkillPackage, len(packages))
	for _, item := range packages {
		byID[item.skill.ID] = item
	}
	for _, skillID := range []string{
		"16000000000086",
		"14811816982796",
		"14811816983052",
		"14811816982284",
		"16000000000095",
		"16000000000074",
		"14811816969484",
		"yingce-image-editing",
	} {
		item, ok := byID[skillID]
		if !ok {
			t.Errorf("consolidated target skill %s is missing", skillID)
			continue
		}
		entry := string(item.archive.Files["SKILL.md"])
		if strings.Contains(entry, "完整入口") {
			t.Errorf("consolidated skill %s (%s) still advertises a complete legacy entry", skillID, item.skill.Name)
		}
	}
	concierge, ok := byID["16000000000107"]
	if !ok {
		t.Fatal("skill concierge package is missing")
	}
	entry := string(concierge.archive.Files["SKILL.md"])
	for _, stale := range []string{"skills/singles/", "34 个域包", "56 个 singles", "35 个"} {
		if strings.Contains(entry, stale) {
			t.Errorf("skill concierge still contains stale catalog detail %q", stale)
		}
	}
}

func TestBuiltinMarkdownHasNoLegacyOriginFooter(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	const marker = "**完整版**：本条目为域包总纲。"
	for _, item := range packages {
		for name, body := range item.archive.Files {
			if strings.Contains(string(body), marker) {
				t.Errorf("skill %s (%s) still ships legacy origin footer in %s", item.skill.ID, item.skill.Name, name)
			}
		}
	}
}

func TestConsolidatedCardsShipInBuiltinPackages(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]builtinSkillPackage, len(packages))
	for _, item := range packages {
		byID[item.skill.ID] = item
	}
	want := map[string][]string{
		"14811816982284": {"cards/drama-character-asset-board.md"},
		"16000000000095": {
			"cards/video-reversal-prompt.md",
			"cards/video-visual-effect-prompt.md",
			"cards/video-reversal-prompt-migration.md",
			"cards/video-visual-effect-prompt-migration.md",
		},
		"14811816983052": {
			"cards/short-narrative-structure.md",
			"cards/shortfilm-5stage-structure.md",
			"cards/shortfilm-micro-drama.md",
			"cards/shortfilm-multi-shot-lock.md",
			"cards/shortfilm-template-branch.md",
			"cards/shortfilm-ip-safety.md",
		},
		"16000000000094": {"cards/drama-shot-card-14.md"},
		"16000000000093": {"cards/drama-four-tier-prompt.md"},
		"16000000000092": {"cards/drama-frame-bridge.md"},
		"16000000000088": {"cards/drama-assembly-acceptance.md"},
		"14811816982028": {
			"cards/ec-product-image.md",
			"cards/ec-detail-page.md",
			"cards/ec-quality-scrub.md",
		},
		"14811816981772": {"cards/ec-product-video.md"},
	}
	for skillID, paths := range want {
		item, ok := byID[skillID]
		if !ok {
			t.Errorf("consolidated target skill %s is missing", skillID)
			continue
		}
		for _, path := range paths {
			body, ok := item.archive.Files[path]
			if !ok {
				t.Errorf("skill %s (%s) is missing %s", item.skill.ID, item.skill.Name, path)
				continue
			}
			if len(strings.TrimSpace(string(body))) == 0 {
				t.Errorf("skill %s (%s) ships empty %s", item.skill.ID, item.skill.Name, path)
			}
		}
	}
}

func TestConsolidatedThirdPartyLicensesPreserveSources(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]builtinSkillPackage, len(packages))
	for _, item := range packages {
		byID[item.skill.ID] = item
	}
	item, ok := byID["16000000000095"]
	if !ok {
		t.Fatal("visual prompt skill is missing")
	}
	license := string(item.archive.Files["THIRD-PARTY-LICENSES.md"])
	for _, source := range []string{
		"visual-skills",
		"CC BY 4.0",
		"Serge Shima — github.com/smixs/visual-skills",
		"awesome-gpt-image-2",
		"freestylefly",
	} {
		if !strings.Contains(license, source) {
			t.Errorf("consolidated visual prompt license is missing source marker %q", source)
		}
	}

	story, ok := byID["14811816983052"]
	if !ok {
		t.Fatal("story skill is missing")
	}
	storyLicense := string(story.archive.Files["THIRD-PARTY-LICENSES.md"])
	for _, marker := range []string{
		"jnMetaCode/ai-shortfilm-prompts",
		"MIT",
		"Copyright (c) 2026 jnMetaCode",
		"剧典技能库（itsWyatt-K）",
	} {
		if !strings.Contains(storyLicense, marker) {
			t.Errorf("consolidated story license is missing source marker %q", marker)
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
	if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}, &model.SkillCurationAssignment{}, &model.SkillCurationRootAssignment{}, &model.User{}, &model.UserIdentity{}); err != nil {
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
