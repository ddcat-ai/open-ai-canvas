package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

type builtinPackForTest struct {
	ID          string
	Name        string
	Description string
	Files       []string
}

// loadBuiltinPacksForTest 直接从仓库里的内置包读取名称、描述与文件清单，
// 让冲突测试面对真实技能库，而不是手写的替身。
func loadBuiltinPacksForTest(t *testing.T) []builtinPackForTest {
	t.Helper()
	root := filepath.Join("..", "..", "builtin")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("read builtin dir: %v", err)
	}
	packs := make([]builtinPackForTest, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(root, entry.Name())
		skillFile := filepath.Join(dir, cloudAgentSkillEntryPath)
		raw, err := os.ReadFile(skillFile)
		if err != nil {
			continue
		}
		pack := builtinPackForTest{Name: entry.Name()}
		lines := strings.Split(string(raw), "\n")
		for index, line := range lines {
			if index >= 16 {
				break
			}
			line = strings.TrimSpace(line)
			switch {
			case strings.HasPrefix(line, "name:"):
				pack.Name = trimFrontmatterValue(strings.TrimPrefix(line, "name:"))
			case strings.HasPrefix(line, "description:"):
				pack.Description = trimFrontmatterValue(strings.TrimPrefix(line, "description:"))
			case strings.HasPrefix(line, "skillId:"):
				pack.ID = trimFrontmatterValue(strings.TrimPrefix(line, "skillId:"))
			}
		}
		err = filepath.WalkDir(dir, func(path string, d os.DirEntry, walkErr error) error {
			if walkErr != nil || d.IsDir() {
				return walkErr
			}
			if !strings.HasSuffix(strings.ToLower(path), ".md") {
				return nil
			}
			rel, relErr := filepath.Rel(dir, path)
			if relErr != nil {
				return relErr
			}
			pack.Files = append(pack.Files, filepath.ToSlash(rel))
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", dir, err)
		}
		packs = append(packs, pack)
	}
	if len(packs) == 0 {
		t.Fatal("no builtin packs loaded")
	}
	return packs
}

func trimFrontmatterValue(value string) string {
	return strings.Trim(strings.TrimSpace(value), `"'`)
}

func TestCloudAgentSkillProfilesMatchBuiltinPackages(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	byID := make(map[string]cloudAgentSkillProfile, len(cloudAgentSkillProfiles))
	for _, profile := range cloudAgentSkillProfiles {
		if _, exists := byID[profile.ID]; exists {
			t.Fatalf("duplicate profile for skill %q", profile.ID)
		}
		byID[profile.ID] = profile
	}
	seen := make(map[string]struct{}, len(packs))
	for _, pack := range packs {
		if pack.ID == "" {
			t.Fatalf("builtin pack %q has no skillId in frontmatter", pack.Name)
		}
		if _, dup := seen[pack.ID]; dup {
			t.Fatalf("duplicate builtin skillId %q", pack.ID)
		}
		seen[pack.ID] = struct{}{}
		profile, ok := byID[pack.ID]
		if !ok {
			t.Errorf("技能 %q(%s) 没有登记角色与互斥组", pack.Name, pack.ID)
			continue
		}
		if profile.Name != pack.Name {
			t.Errorf("技能 %s 名称不一致：内置包=%q 注册表=%q（改名后要同步注册表）", pack.ID, pack.Name, profile.Name)
		}
		if profile.Role == "" {
			t.Errorf("技能 %s 缺少 role", pack.ID)
		}
	}
	for id := range byID {
		if _, ok := seen[id]; !ok {
			t.Errorf("注册表里的 %s 已不在内置包中，需要删除或改名", id)
		}
	}
}

func TestCloudAgentSkillConflictGroupsOnlyHoldSameRole(t *testing.T) {
	expectedRole := map[string]string{
		cloudAgentSkillGroupStoryKnowledge:     cloudAgentSkillRoleKnowledge,
		cloudAgentSkillGroupMarketingKnowledge: cloudAgentSkillRoleKnowledge,
		cloudAgentSkillGroupProduction:         cloudAgentSkillRoleProduction,
		cloudAgentSkillGroupVideoModel:         cloudAgentSkillRolePrompt,
		cloudAgentSkillGroupPromptSchema:       cloudAgentSkillRolePrompt,
	}
	seenName := make(map[string]string, len(cloudAgentSkillProfiles))
	for _, profile := range cloudAgentSkillProfiles {
		if role, ok := expectedRole[profile.Group]; ok && profile.Role != role {
			t.Errorf("%s 在互斥组 %s 里但角色是 %s，期望 %s", profile.Name, profile.Group, profile.Role, role)
		}
		key := cloudAgentSkillProfileKey(profile.Name)
		if other, dup := seenName[key]; dup {
			t.Errorf("技能名重复：%q 同时属于 %s", profile.Name, other)
		}
		seenName[key] = profile.ID
	}
	// 重型生产包必须都在同一个互斥组里，漏登记等于允许两套流程并行。
	heavy := []string{
		"14811816970252", "14811816983308", "14811816981772", "14811816970508",
		"14811816960780", "14519800321292", "14811816980748",
		"14889292802060", "14811816961036", "14811816962060", "14811816962316",
		"14811816961804", "14811816961292", "14811816969996", "14889292801804",
		"14811816982028", "14811816960268", "14811816962572", "14811816981516",
		"14811816969484", "yingce-short-drama-workflow",
	}
	for _, id := range heavy {
		profile, ok := cloudAgentSkillProfileByID[id]
		if !ok {
			t.Errorf("重型技能 %s 没有登记角色", id)
			continue
		}
		if profile.Group != cloudAgentSkillGroupProduction {
			t.Errorf("重型技能 %s 不在生产互斥组，当前是 %q", profile.Name, profile.Group)
		}
	}
}

func TestCloudAgentSkillPresetsDoNotStackExclusiveGroups(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "skills", "seed", "presets.json"))
	if err != nil {
		t.Fatalf("read presets: %v", err)
	}
	var seed struct {
		Presets []struct {
			PresetID string   `json:"presetId"`
			SkillIDs []string `json:"skillIds"`
		} `json:"presets"`
	}
	if err := json.Unmarshal(raw, &seed); err != nil {
		t.Fatalf("parse presets: %v", err)
	}
	if len(seed.Presets) == 0 {
		t.Fatal("presets.json is empty")
	}
	for _, preset := range seed.Presets {
		groups := make(map[string]string, len(preset.SkillIDs))
		for _, id := range preset.SkillIDs {
			profile, ok := cloudAgentSkillProfileByID[id]
			if !ok {
				t.Errorf("预设 %s 引用了未登记角色的技能 %s", preset.PresetID, id)
				continue
			}
			if profile.Group == "" {
				continue
			}
			if other, dup := groups[profile.Group]; dup {
				t.Errorf("预设 %s 同时挂了同组技能 %s 和 %s（组 %s），同一轮会互相抢主控",
					preset.PresetID, other, profile.Name, profile.Group)
				continue
			}
			groups[profile.Group] = profile.Name
		}
	}
}

func TestCloudAgentSkillRecommendationStartersDoNotStackExclusiveGroups(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "skills", "seed", "recommendations.json"))
	if err != nil {
		t.Fatalf("read recommendations: %v", err)
	}
	var seed struct {
		Industries []struct {
			IndustryID      string   `json:"industryId"`
			StarterSkillIDs []string `json:"starterSkillIds"`
			Skills          []struct {
				SkillID string `json:"skillId"`
			} `json:"skills"`
		} `json:"industries"`
	}
	if err := json.Unmarshal(raw, &seed); err != nil {
		t.Fatalf("parse recommendations: %v", err)
	}
	if len(seed.Industries) == 0 {
		t.Fatal("recommendations.json is empty")
	}
	for _, industry := range seed.Industries {
		if len(industry.StarterSkillIDs) == 0 || len(industry.StarterSkillIDs) > 3 {
			t.Errorf("行业 %s 的起步技能数为 %d，应在 1-3 个", industry.IndustryID, len(industry.StarterSkillIDs))
		}
		allowed := make(map[string]struct{}, len(industry.Skills))
		for _, skill := range industry.Skills {
			allowed[skill.SkillID] = struct{}{}
		}
		groups := make(map[string]string, len(industry.StarterSkillIDs))
		for _, id := range industry.StarterSkillIDs {
			if _, ok := allowed[id]; !ok {
				t.Errorf("行业 %s 的起步技能 %s 不在推荐目录中", industry.IndustryID, id)
				continue
			}
			profile, ok := cloudAgentSkillProfileByID[id]
			if !ok {
				t.Errorf("行业 %s 的起步技能 %s 没有登记角色", industry.IndustryID, id)
				continue
			}
			if profile.Group == "" {
				continue
			}
			if other, dup := groups[profile.Group]; dup {
				t.Errorf("行业 %s 的起步组合同时包含同组技能 %s 和 %s（组 %s）",
					industry.IndustryID, other, profile.Name, profile.Group)
				continue
			}
			groups[profile.Group] = profile.Name
		}
	}
}

func TestCloudAgentSkillProductionProfilesCarryTier(t *testing.T) {
	full, category := 0, 0
	for _, profile := range cloudAgentSkillProfiles {
		if profile.Role != cloudAgentSkillRoleProduction {
			if profile.Tier != "" {
				t.Errorf("%s 不是出片位，却带了 productionTier=%q", profile.Name, profile.Tier)
			}
			continue
		}
		switch profile.Tier {
		case cloudAgentSkillTierFull:
			full++
		case cloudAgentSkillTierCategory:
			category++
		default:
			t.Errorf("出片位 %s 缺少分级，full 与 category 必须二选一", profile.Name)
		}
	}
	if full == 0 || category == 0 {
		t.Fatalf("分级样本异常：full=%d category=%d", full, category)
	}
	// 完整主控是少数派；如果这个数字猛涨，说明又把品类工位写成了主控。
	if full > 8 {
		t.Errorf("完整主控有 %d 个，品类工位只有 %d 个，分级可能又混了", full, category)
	}
}

func TestCloudAgentSkillFullProductionProfilesMatchApprovedSet(t *testing.T) {
	// 本地 chaoge 是第六个完整主控，但不属于可随上游发布的 Judian 包。
	approved := map[string]struct{}{
		"14811816970252":              {},
		"14811816983308":              {},
		"14811816981772":              {},
		"14811816970508":              {},
		"yingce-short-drama-workflow": {},
	}
	seen := make(map[string]struct{}, len(approved))
	for _, profile := range cloudAgentSkillProfiles {
		if profile.Role != cloudAgentSkillRoleProduction || profile.Tier != cloudAgentSkillTierFull {
			continue
		}
		if _, ok := approved[profile.ID]; !ok {
			t.Errorf("未批准的重型包被登记成完整主控：%s(%s)", profile.Name, profile.ID)
			continue
		}
		seen[profile.ID] = struct{}{}
	}
	for id := range approved {
		if _, ok := seen[id]; !ok {
			t.Errorf("已批准的完整主控 %s 没有登记为 production/full", id)
		}
	}
}

func TestCloudAgentSkillSearchExposesProductionTier(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs, "14811816970508", "14811816969484")
	result, err := cloudAgentSearchSkills(pool, "按森海风格做一支叙事短片", 20)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, match := range result["matches"].([]map[string]any) {
		if match["skillId"] != "14811816970508" {
			continue
		}
		found = true
		if match["productionTier"] != cloudAgentSkillTierFull {
			t.Fatalf("完整主控应下发 productionTier=full，得到 %v", match["productionTier"])
		}
	}
	if !found {
		t.Fatal("叙事短片请求应命中叙事短片导演分镜")
	}
}

func searchPacksSubset(t *testing.T, packs []builtinPackForTest, ids ...string) []cloudAgentSkill {
	t.Helper()
	want := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		want[id] = struct{}{}
	}
	out := make([]cloudAgentSkill, 0, len(ids))
	for _, pack := range packs {
		if _, ok := want[pack.ID]; !ok {
			continue
		}
		files := make(map[string]string, len(pack.Files))
		for _, path := range pack.Files {
			files[path] = ""
		}
		out = append(out, cloudAgentSkill{ID: pack.ID, Name: pack.Name, Description: pack.Description, Files: files})
		delete(want, pack.ID)
	}
	if len(want) > 0 {
		t.Fatalf("测试引用了不存在的内置技能: %v", want)
	}
	return out
}

func searchPrimaryForGroup(t *testing.T, pool []cloudAgentSkill, keyword, group string) (map[string]any, map[string]any) {
	t.Helper()
	result, err := cloudAgentSearchSkills(pool, keyword, 20)
	if err != nil {
		t.Fatal(err)
	}
	var primary, candidate map[string]any
	for _, match := range result["matches"].([]map[string]any) {
		if match["conflictGroup"] != group {
			continue
		}
		if match["primary"] == true && primary == nil {
			primary = match
			continue
		}
		if match["primary"] == false && candidate == nil {
			candidate = match
		}
	}
	return primary, candidate
}

func TestCloudAgentSkillSearchKeepsOnePrimaryPerProductionGroup(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	videoIDs := []string{
		"14811816970508", "14811816981772", "14811816970252",
		"14811816983308", "yingce-short-drama-workflow",
		"14811816983052", "16000000000094",
	}
	pool := searchPacksSubset(t, packs, videoIDs...)

	primary, candidate := searchPrimaryForGroup(t, pool, "按森海风格做一支哥特暗黑童话叙事短片", cloudAgentSkillGroupProduction)
	if primary == nil || primary["skillId"] != "14811816970508" {
		t.Fatalf("森海叙事短片应命中叙事短片导演分镜，得到 %v", primary)
	}
	if candidate == nil {
		t.Fatal("同轮其他生产主控应作为候选出现，而不是消失")
	}

}

func TestCloudAgentSkillOneShotPipelineStaysOutOfProductionSlot(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs,
		"16000000000077", "yingce-short-drama-workflow", "14811816970508")

	result, err := cloudAgentSearchSkills(pool,
		"一镜到底首尾帧接不上，时长也超了，后面交给影策短剧制作工作流出成片", 20)
	if err != nil {
		t.Fatal(err)
	}
	var sawMethod, sawProduction bool
	for _, match := range result["matches"].([]map[string]any) {
		switch match["skillId"] {
		case "16000000000077":
			sawMethod = true
			if match["role"] != cloudAgentSkillRoleMethod {
				t.Errorf("一镜到底流水线应以 method 出现，得到 %v", match)
			}
			if _, ok := match["productionTier"]; ok {
				t.Errorf("一镜到底流水线不应占用 productionTier: %v", match)
			}
		case "yingce-short-drama-workflow":
			sawProduction = true
			if match["role"] != cloudAgentSkillRoleProduction || match["primary"] != true {
				t.Errorf("影策短剧制作工作流应是生产主控，得到 %v", match)
			}
		}
	}
	if !sawMethod || !sawProduction {
		t.Fatalf("应同时保留一镜到底方法卡与影策生产主控，得到 %v", result["matches"])
	}
}

func TestCloudAgentSkillSearchKeepsDomainPacksOutOfProductionSlot(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs, "14811816983052", "yingce-short-drama-workflow")

	result, err := cloudAgentSearchSkills(pool, "短剧故事结构和分镜，最后用影策短剧制作工作流出成片", 20)
	if err != nil {
		t.Fatal(err)
	}
	var sawDomain, sawProduction bool
	for _, match := range result["matches"].([]map[string]any) {
		switch match["skillId"] {
		case "14811816983052":
			sawDomain = true
			if match["role"] != cloudAgentSkillRoleKnowledge {
				t.Errorf("故事与影像制作-源起应以 knowledge 出现，得到 %v", match["role"])
			}
			if match["conflictGroup"] != cloudAgentSkillGroupStoryKnowledge {
				t.Errorf("故事与影像制作-源起应在知识组，得到 %v", match["conflictGroup"])
			}
			if _, ok := match["productionTier"]; ok {
				t.Errorf("知识包不应带 productionTier: %v", match)
			}
		case "yingce-short-drama-workflow":
			sawProduction = true
			if match["role"] != cloudAgentSkillRoleProduction || match["primary"] != true {
				t.Errorf("影策短剧制作工作流应是唯一的生产主控，得到 %v", match)
			}
		}
	}
	if !sawDomain || !sawProduction {
		t.Fatalf("查询应同时保留知识包与生产主控，得到 %v", result["matches"])
	}
}

func TestCloudAgentSkillSearchUnregisteredHeavyPacksDoNotClaimPrimary(t *testing.T) {
	pool := []cloudAgentSkill{
		{
			ID: "local-hg", Name: "HG 纯 AI 长片产线",
			Description: "长片工业化制作方法，负责方法论与流程建议。",
			Files:       map[string]string{cloudAgentSkillEntryPath: ""},
		},
		{
			ID: "local-xingbiao", Name: "行镖 AI 影视工业化",
			Description: "影视工业化方法，负责方法论与流程建议。",
			Files:       map[string]string{cloudAgentSkillEntryPath: ""},
		},
		{
			ID: "local-chaoge", Name: "chaoge-film-director-flex",
			Description: "个人导演工作流，能够独立完成分镜、生成与剪辑。",
			Files:       map[string]string{cloudAgentSkillEntryPath: ""},
		},
		{
			ID: "local-screenwriter", Name: "screenwriter",
			Description: "个人剧本诊断方法，负责结构、场景与对白建议。",
			Files:       map[string]string{cloudAgentSkillEntryPath: ""},
		},
		{
			ID: "local-canghe", Name: "manga-drama",
			Description: "个人漫剧生产方式，能够从主角图生成分镜并直接生成视频。",
			Files:       map[string]string{cloudAgentSkillEntryPath: ""},
		},
		{
			ID: "local-solo", Name: "solo-island-director",
			Description: "个人电商品类总控，承接商品短视频、详情页和主图并调用生成主链。",
			Files:       map[string]string{cloudAgentSkillEntryPath: ""},
		},
		{
			ID: "yingce-short-drama-workflow", Name: "影策短剧制作工作流",
			Description: "小说或剧本到短剧成片与资产核验。",
			Files:       map[string]string{cloudAgentSkillEntryPath: ""},
		},
	}

	result, err := cloudAgentSearchSkills(pool, "影策短剧制作工作流加上长片工业化方法、导演工作流、剧本诊断、漫剧生成和电商总控", 20)
	if err != nil {
		t.Fatal(err)
	}
	var sawProduction bool
	personalIDs := []string{"local-hg", "local-xingbiao", "local-chaoge", "local-screenwriter", "local-canghe", "local-solo"}
	seenPersonal := make(map[string]bool, len(personalIDs))
	for _, match := range result["matches"].([]map[string]any) {
		switch match["skillId"] {
		case "local-hg", "local-xingbiao", "local-chaoge", "local-screenwriter", "local-canghe", "local-solo":
			seenPersonal[match["skillId"].(string)] = true
			if _, ok := match["role"]; ok {
				t.Errorf("个人重型包不应被伪造 role: %v", match)
			}
			if _, ok := match["conflictGroup"]; ok {
				t.Errorf("个人重型包不应占用冲突组: %v", match)
			}
			if _, ok := match["primary"]; ok {
				t.Errorf("个人重型包不能被标成 primary: %v", match)
			}
		case "yingce-short-drama-workflow":
			sawProduction = true
			if match["role"] != cloudAgentSkillRoleProduction || match["primary"] != true {
				t.Errorf("影策包应保留生产主控身份，得到 %v", match)
			}
		}
	}
	if !sawProduction {
		t.Fatal("查询没有返回影策生产主控")
	}
	for _, id := range personalIDs {
		if !seenPersonal[id] {
			t.Errorf("个人重型包 %s 应仍可检索，但不能进入 Judian 主控槽位", id)
		}
	}
}

func TestCloudAgentSkillSearchKeepsStoryKnowledgeExclusive(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs,
		"14811816983052", "yingshi-drama-workshop", "16000000000081")

	primary, candidate := searchPrimaryForGroup(t, pool, "短剧钩子、三幕结构和分集大纲", cloudAgentSkillGroupStoryKnowledge)
	if primary == nil {
		t.Fatal("故事知识搜索应命中一个主知识包")
	}
	if candidate == nil {
		t.Fatal("其余故事知识包应保留为候选，不能同时作为主知识包")
	}
}

func TestCloudAgentSkillSearchKeepsMarketingKnowledgeExclusive(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs,
		"16000000000105", "16000000000097", "16000000000098",
		"16000000000102", "16000000000104")

	primary, candidate := searchPrimaryForGroup(t, pool, "广告文案、价格锚点、品牌定位和故事营销", cloudAgentSkillGroupMarketingKnowledge)
	if primary == nil {
		t.Fatal("营销知识搜索应命中一个主知识包")
	}
	if candidate == nil {
		t.Fatal("其余营销知识包应保留为候选，不能同时作为主知识包")
	}
}

func TestCloudAgentSkillSearchDoesNotTreatGenericLensTalkAsOnlyShot(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs, "16000000000077", "16000000000094", "14811816970508", "14811816981772")
	result, err := cloudAgentSearchSkills(pool, "一般镜头怎么运镜，机位怎么摆", 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, match := range result["matches"].([]map[string]any) {
		if match["conflictGroup"] == cloudAgentSkillGroupProduction {
			t.Fatalf("普通运镜问题不应拉起生产主控，命中 %v", match["skillName"])
		}
	}
	if len(result["matches"].([]map[string]any)) == 0 {
		t.Fatal("普通运镜问题至少应命中分镜语法")
	}
}

func TestCloudAgentSkillSearchSeparatesJewelryDesignFromListing(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs, "14811816969484", "14811816960780")

	primary, candidate := searchPrimaryForGroup(t, pool, "设计一款戒指，参考这个风格延展", cloudAgentSkillGroupProduction)
	if primary == nil || primary["skillId"] != "14811816969484" {
		t.Fatalf("设计请求应先命中珠宝设计出款，得到 %v", primary)
	}
	if candidate == nil || candidate["skillId"] != "14811816960780" {
		t.Fatalf("珠宝电商应作为候选，得到 %v", candidate)
	}

	primary, candidate = searchPrimaryForGroup(t, pool, "珠宝亚马逊九图，上架素材一起出", cloudAgentSkillGroupProduction)
	if primary == nil || primary["skillId"] != "14811816960780" {
		t.Fatalf("上架请求应命中珠宝电商一站式，得到 %v", primary)
	}
	if candidate == nil || candidate["skillId"] != "14811816969484" {
		t.Fatalf("珠宝设计应作为候选，得到 %v", candidate)
	}
}

func TestCloudAgentSkillSearchKeepsModelPromptPacksExclusive(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs,
		"16000000000090", "16000000000091", "16000000000092", "16000000000093")

	cases := []struct {
		keyword string
		want    string
	}{
		{"Seedance 2.5 多镜连续性怎么锁", "16000000000092"},
		{"H3 六段式提示词怎么写", "16000000000090"},
		{"不知道该选哪个模型出片", "16000000000091"},
	}
	for _, tc := range cases {
		primary, candidate := searchPrimaryForGroup(t, pool, tc.keyword, cloudAgentSkillGroupVideoModel)
		if primary == nil || primary["skillId"] != tc.want {
			t.Fatalf("%q 应命中 %s，得到 %v", tc.keyword, tc.want, primary)
		}
		if candidate == nil {
			t.Fatalf("%q 命中后，同组其他提示词包应保留为候选", tc.keyword)
		}
	}
}

func TestCloudAgentSkillSearchKeepsPromptSchemaExclusive(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs,
		"16000000000095", "14811816960524", "15507072002828", "15434297644556")

	cases := []struct {
		keyword string
		want    string
	}{
		{"视觉提示词的四层结构怎么拆", "16000000000095"},
		{"把参考图的视觉基因延展成十五秒提示词资产", "14811816960524"},
		{"按脸谱和三庭五眼做一套人像捏脸 prompt", "15507072002828"},
		{"先锋服装商拍的五段短 prompt", "15434297644556"},
	}
	for _, tc := range cases {
		primary, candidate := searchPrimaryForGroup(t, pool, tc.keyword, cloudAgentSkillGroupPromptSchema)
		if primary == nil || primary["skillId"] != tc.want {
			t.Fatalf("%q 应命中 %s，得到 %v", tc.keyword, tc.want, primary)
		}
		if candidate == nil {
			t.Fatalf("%q 命中后，同组其他提示词结构应保留为候选", tc.keyword)
		}
	}
}

func TestCloudAgentSkillSearchPrefersCategoryWorkstationForNarrowAsk(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs,
		"14811816962316", "14811816981772", "14811816970252", "14811816983308")

	primary, candidate := searchPrimaryForGroup(t, pool, "这条裙子做一条十五秒竖版上身试穿视频", cloudAgentSkillGroupProduction)
	if primary == nil || primary["skillId"] != "14811816962316" {
		t.Fatalf("穿搭试穿请求应命中文案工位，得到 %v", primary)
	}
	if primary["productionTier"] != cloudAgentSkillTierCategory {
		t.Fatalf("穿搭试穿工位应标为品类工位，得到 %v", primary["productionTier"])
	}
	if candidate == nil {
		t.Fatal("同轮完整主控应保留为候选，方便用户改主意换整片方案")
	}
}

func TestCloudAgentSkillSearchDoesNotEscalateStiffFaceToVideo(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs,
		"16000000000086", "14811816981772", "14811816980748", "16000000000077",
		"14811816970508")
	result, err := cloudAgentSearchSkills(pool, "AI 演员表情僵硬，眼神很假", 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, match := range result["matches"].([]map[string]any) {
		if match["conflictGroup"] == cloudAgentSkillGroupProduction {
			t.Fatalf("表演诊断不应拉起视频生产主控，命中 %v", match["skillName"])
		}
	}
	if len(result["matches"].([]map[string]any)) == 0 {
		t.Fatal("表演诊断至少应命中 AI 表演实验室")
	}
}

func TestCloudAgentSkillSearchMarksUnknownPacksWithoutRole(t *testing.T) {
	pool := []cloudAgentSkill{
		{ID: "local-1", Name: "本地自建包", Description: "本地私有方法。", Files: map[string]string{cloudAgentSkillEntryPath: ""}},
		{ID: "14811816981772", Name: "一图成片-电影广告全能导演", Description: "图片到广告视频。", Files: map[string]string{cloudAgentSkillEntryPath: ""}},
	}
	result, err := cloudAgentSearchSkills(pool, "本地方法", 20)
	if err != nil {
		t.Fatal(err)
	}
	matches := result["matches"].([]map[string]any)
	if len(matches) == 0 {
		t.Fatal("未登记的本地包仍应可检索")
	}
	if _, ok := matches[0]["role"]; ok {
		t.Fatal("未登记角色的包不应伪造 role")
	}
}

func TestCloudAgentSkillSearchUsesWholeAsciiTokenOnCardSlug(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs, "16000000000077")
	result, err := cloudAgentSearchSkills(pool, "AI 演员表情僵硬，眼神很假", 20)
	if err != nil {
		t.Fatal(err)
	}
	if matches := result["matches"].([]map[string]any); len(matches) != 0 {
		t.Fatalf("ai 不应命中 onlyshot-fail-triage 的 fail 片段，得到 %v", matches)
	}
}

func TestCloudAgentSkillLegacyNamesRouteToConsolidatedEntries(t *testing.T) {
	packs := loadBuiltinPacksForTest(t)
	pool := searchPacksSubset(t, packs, "14811816983052", "16000000000105", "16000000000107")
	cases := map[string]string{
		"故事开发":    "14811816983052",
		"广告全链路打法": "16000000000105",
		"选包门房":    "16000000000107",
	}
	for keyword, want := range cases {
		result, err := cloudAgentSearchSkills(pool, keyword, 20)
		if err != nil {
			t.Fatal(err)
		}
		matches := result["matches"].([]map[string]any)
		if len(matches) != 1 || matches[0]["skillId"] != want || matches[0]["direct"] != true {
			t.Fatalf("旧名 %q 应直达 %s，得到 %v", keyword, want, matches)
		}
	}
}

func TestCloudAgentSkillConflictResponseStaysWithinBudget(t *testing.T) {
	heavy := make([]cloudAgentSkill, 0, 20)
	for _, profile := range cloudAgentSkillProfiles {
		if profile.Role != cloudAgentSkillRoleProduction {
			continue
		}
		files := map[string]string{cloudAgentSkillEntryPath: ""}
		for i := 0; i < 6; i++ {
			files["cards/"+"视频"+strconv.Itoa(i)+"-"+profile.ID+".md"] = ""
		}
		heavy = append(heavy, cloudAgentSkill{
			ID: profile.ID, Name: profile.Name,
			Description: "视频成片生产主控：" + profile.Scope + "。当用户要做短视频、广告片或成片时调用。",
			Files:       files,
		})
	}
	result, err := cloudAgentSearchSkills(heavy, "视频成片广告短片怎么做", 20)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > cloudAgentSkillSearchResponseBudget {
		t.Fatalf("冲突场景响应 %d 字节，超过预算 %d", len(encoded), cloudAgentSkillSearchResponseBudget)
	}
	cards := 0
	for _, match := range result["matches"].([]map[string]any) {
		if list, ok := match["cards"].([]string); ok {
			cards += len(list)
		}
	}
	if cards > cloudAgentSkillSearchCardBudget {
		t.Fatalf("下发 %d 张卡，超过预算 %d", cards, cloudAgentSkillSearchCardBudget)
	}
}
