package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"yingce/backend/internal/skills"
)

// skill_search 的契约测试：注册、分词打分、索引兜底、边界与空集。
// 沿用 #577 的同文件断言风格（含 sentinel 泄漏检查）。

func skillSearchTestSkills() []cloudAgentSkill {
	return []cloudAgentSkill{
		{ID: "s1", Name: "consumer-psychology", Description: "当写带货口播、广告脚本、详情页与直播话术，需要设计转化结构时调用。核心能力：价格锚点/比价阻断/社会证据。"},
		{ID: "s2", Name: "shortform-drama-playbook", Description: "当写 3 分钟以内反转短剧的分镜脚本时调用。核心能力：钩子/因果/反转收束。"},
		{ID: "s3", Name: "h3-video-prompt-suite", Description: "当为 H3 视频模型写生成提示词时调用。核心能力：六段式/运镜三段式/负向提示词。"},
	}
}

func TestCloudAgentPolicyRegistersSkillSearchAlongsideReadFile(t *testing.T) {
	req := CloudAgentRequest{SkillsEnabled: true}
	names := map[string]bool{}
	for _, tool := range cloudAgentTools(req) {
		fn, ok := tool["function"].(map[string]any)
		if !ok {
			t.Fatalf("tool without function: %v", tool)
		}
		names[fn["name"].(string)] = true
		if fn["name"] == "skill_search" {
			parameters := fn["parameters"].(map[string]any)
			if required, ok := parameters["required"].([]string); ok && len(required) > 0 {
				t.Fatalf("index lookup must allow an empty argument object: %v", required)
			}
		}
	}
	if !names["skill_read_file"] || !names["skill_search"] {
		t.Fatalf("skill tools not registered together: %v", names)
	}
	// 无技能时两个工具都不该出现
	for _, tool := range cloudAgentTools(CloudAgentRequest{}) {
		fn := tool["function"].(map[string]any)
		if fn["name"] == "skill_search" || fn["name"] == "skill_read_file" {
			t.Fatalf("skill tool leaked without skills: %v", fn["name"])
		}
	}
}

func TestCloudAgentSkillSearchRanksNameHitsAboveDescriptionHits(t *testing.T) {
	result, err := cloudAgentSearchSkills(skillSearchTestSkills(), "口播 转化", 0)
	if err != nil {
		t.Fatal(err)
	}
	matches := result["matches"].([]map[string]any)
	if len(matches) == 0 {
		t.Fatal("no matches for 口播/转化")
	}
	if matches[0]["skillId"] != "s1" {
		t.Fatalf("expected consumer-psychology first, got %v", matches[0]["skillId"])
	}
	if matches[0]["path"] != cloudAgentSkillEntryPath {
		t.Fatalf("expected entry path, got %v", matches[0]["path"])
	}
	if matches[0]["score"].(int) <= 0 {
		t.Fatalf("expected positive score, got %v", matches[0]["score"])
	}
	if snippet, _ := matches[0]["snippet"].(string); strings.Contains(snippet, "PRIVATE") || len(snippet) > 200 {
		t.Fatalf("snippet unsafe or oversized: %q", snippet)
	}
}

func TestCloudAgentSkillSearchWithoutKeywordListsIndex(t *testing.T) {
	result, err := cloudAgentSearchSkills(skillSearchTestSkills(), "  ", 0)
	if err != nil {
		t.Fatal(err)
	}
	matches := result["matches"].([]map[string]any)
	if len(matches) != 3 {
		t.Fatalf("expected full index of 3, got %d", len(matches))
	}
	if result["total"].(int) != 3 {
		t.Fatalf("expected total 3, got %v", result["total"])
	}
}

func TestCloudAgentSkillSearchClampsLimitAndDegradesNoHit(t *testing.T) {
	skills := skillSearchTestSkills()
	result, err := cloudAgentSearchSkills(skills, "钩子", 99)
	if err != nil {
		t.Fatal(err)
	}
	if len(result["matches"].([]map[string]any)) != 1 {
		t.Fatalf("expected single hit for 钩子, got %v", result["matches"])
	}
	limited, err := cloudAgentSearchSkills(skills, "当", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(limited["matches"].([]map[string]any)) != 1 || limited["total"].(int) != 3 {
		t.Fatalf("total must count all matches before limit, got %#v", limited)
	}
	result, err = cloudAgentSearchSkills(skills, "量子纠缠炒菜", 1)
	if err != nil {
		t.Fatal(err)
	}
	zeroHit := result["matches"].([]map[string]any)
	if len(zeroHit) != 0 {
		t.Fatalf("zero-hit query must return no indexed skills, got %v", result["matches"])
	}
	if result["total"].(int) != 0 {
		t.Fatalf("expected total 0 on zero-hit search, got %v", result["total"])
	}
	if guidance, _ := result["guidance"].(string); !strings.Contains(guidance, "没有匹配") {
		t.Fatalf("no-hit guidance must be explicit: %q", guidance)
	}
}

func TestCloudAgentSkillSearchEmptySkillsReturnsGuidance(t *testing.T) {
	result, err := cloudAgentSearchSkills(nil, "口播", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result["matches"].([]map[string]any)) != 0 {
		t.Fatal("expected empty matches without skills")
	}
	if guidance, _ := result["guidance"].(string); !strings.Contains(guidance, "没有可用的已安装技能") || !strings.Contains(guidance, "skill_market_search") {
		t.Fatalf("guidance mismatch: %q", guidance)
	}
}

func TestCloudAgentSkillSearchToleratesStraySkillIDArgument(t *testing.T) {
	// 实测回归：step-5 首次调用时按 skill_read_file 的参数习惯顺手带上 skillId，
	// 被 decodeCloudAgentJSONObject（DisallowUnknownFields）拒绝 → tool_failed，
	// 检索一次都没成功。这里走完整的工具分发路径，确保解码层真的容忍该字段。
	s, db, _, _ := creationTestServiceOnDatabase(t, newPureGoAppTestDB(t))
	skillAdministratorFixture(t, db, "u1")
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	ids := map[string]string{}
	for _, skill := range skillSearchTestSkills() {
		created, err := s.CreateSkill("u1", SkillMutationRequest{SkillName: skill.Name, Description: skill.Description, Instruction: "# " + skill.Name + "\n\n步骤", Tag: "drama", IsPrivate: true})
		if err != nil {
			t.Fatal(err)
		}
		ids[skill.ID] = created.SkillID
	}
	pool, err := s.cloudAgentBuildSkillPool("u1", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{SkillVersions: pool.Versions}
	call := cloudAgentCall{ID: "c1"}
	call.Function.Name = "skill_search"
	call.Function.Arguments = `{"keyword":"反转 钩子 结构 便利店","skillId":"` + ids["s1"] + `"}`
	result, err := cloudAgentReadTool(nil, "u1", state, call, s)
	if err != nil {
		t.Fatalf("stray skillId must be tolerated: %v", err)
	}
	payload, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("unexpected result type %T", result)
	}
	matches := payload["matches"].([]map[string]any)
	if len(matches) == 0 {
		t.Fatal("stray skillId argument must not break the search")
	}
	// 该字段仅接收不生效：检索范围恒为本轮全部可用技能，
	// 传了 s1 也必须能命中 name/description 在 s2 上的结果。
	if matches[0]["skillId"] != ids["s2"] {
		t.Fatalf("skillId argument must not narrow the search scope, got %v", matches[0]["skillId"])
	}
}

func skillSearchTestPackWithCards() cloudAgentSkill {
	return cloudAgentSkill{
		ID:          "p1",
		Name:        "shortform-drama-playbook",
		Description: "当写 3 分钟以内反转短剧的分镜脚本时调用。核心能力：钩子/因果/反转收束。",
		Files: map[string]string{
			cloudAgentSkillEntryPath:         "",
			"cards/czks-hook-paywall.md":     "",
			"cards/ssqr-twist-ending.md":     "",
			"cards/sushi-reveal-punch.md":    "",
			"cards/dxj-short-drama.md":       "",
			"cards/czks-structure-rhythm.md": "",
		},
	}
}

func TestCloudAgentSkillSearchReturnsCardPathWhenSlugHits(t *testing.T) {
	// 卡级检索的核心契约：命中卡片时直接返回卡路径，Agent 不必先读 SKILL.md 总纲。
	result, err := cloudAgentSearchSkills([]cloudAgentSkill{skillSearchTestPackWithCards()}, "hook", 0)
	if err != nil {
		t.Fatal(err)
	}
	matches := result["matches"].([]map[string]any)
	if len(matches) != 1 {
		t.Fatalf("expected one hit, got %v", matches)
	}
	if matches[0]["path"] != "cards/czks-hook-paywall.md" {
		t.Fatalf("expected card path, got %v", matches[0]["path"])
	}
	if matches[0]["score"].(int) < 4 {
		t.Fatalf("card hit must score at least 4, got %v", matches[0]["score"])
	}
}

func TestCloudAgentSkillSearchChineseKeywordSkipsStraightToCardIndex(t *testing.T) {
	// 中文关键词打不到英文卡名（czks-hook-paywall 之类），此时必须下发卡索引，
	// 让 Agent 能直奔某张卡而不必先读总纲——这才是「找到该读的那张卡」的兜底路径。
	result, err := cloudAgentSearchSkills([]cloudAgentSkill{skillSearchTestPackWithCards()}, "反转", 0)
	if err != nil {
		t.Fatal(err)
	}
	matches := result["matches"].([]map[string]any)
	if len(matches) != 1 {
		t.Fatalf("expected one hit, got %v", matches)
	}
	if matches[0]["path"] != cloudAgentSkillEntryPath {
		t.Fatalf("expected entry path fallback, got %v", matches[0]["path"])
	}
	cards, ok := matches[0]["cards"].([]string)
	if !ok || len(cards) != 5 {
		t.Fatalf("expected full card index of 5, got %v", matches[0]["cards"])
	}
	if matches[0]["cardCount"].(int) != 5 {
		t.Fatalf("expected cardCount 5, got %v", matches[0]["cardCount"])
	}
}

func TestCloudAgentSkillSearchCardIndexRespectsBudget(t *testing.T) {
	// 大包不能把上下文撑爆：卡索引跨条目共享预算，且永远不超过预算总量。
	big := cloudAgentSkill{ID: "b1", Name: "big-pack", Description: "覆盖大量卡片的包", Files: map[string]string{cloudAgentSkillEntryPath: ""}}
	for i := 0; i < 30; i++ {
		big.Files["cards/card-"+"abcdefghij"[i%10:]+"-"+"0123456789"[i%10:]+".md"] = ""
	}
	result, err := cloudAgentSearchSkills([]cloudAgentSkill{big, big}, "卡片", 0)
	if err != nil {
		t.Fatal(err)
	}
	total := 0
	for _, m := range result["matches"].([]map[string]any) {
		if cards, ok := m["cards"].([]string); ok {
			total += len(cards)
		}
	}
	if total > cloudAgentSkillSearchCardBudget {
		t.Fatalf("card index exceeded budget: %d > %d", total, cloudAgentSkillSearchCardBudget)
	}
	if total == 0 {
		t.Fatal("expected some card paths to be served")
	}
}

func TestCloudAgentSkillSearchSnippetHandlesMultibyteHitOffset(t *testing.T) {
	// 回归：曾把 strings.Index 的字节偏移当成 []rune 的下标使用，中文描述里
	// 关键词越靠后、字节偏移越远超 rune 数，start 未夹紧 →
	// panic: slice bounds out of range [249:233]，整个后端进程被打挂。
	// 触发条件：命中词的「字节偏移 - 40」必须大于描述的 rune 总数。
	// 本例 276 rune / 命中词字节偏移 483 → 旧逻辑 start=443 > end=276，直接 panic。
	long := strings.Repeat("本包由出版书方法论蒸馏重铸，覆盖短剧结构与节奏判断，", 6) +
		"核心能力：分镜、钩子与反转收束。" +
		strings.Repeat("工位边界：本包只负责创作方法论层，不处理提示词语法。", 4)
	skills := []cloudAgentSkill{{ID: "s1", Name: "demo-skill", Description: long}}
	result, err := cloudAgentSearchSkills(skills, "分镜", 0)
	if err != nil {
		t.Fatalf("multibyte description must not break the search: %v", err)
	}
	matches := result["matches"].([]map[string]any)
	if len(matches) != 1 {
		t.Fatalf("expected one hit, got %v", matches)
	}
	snippet, _ := matches[0]["snippet"].(string)
	if snippet == "" {
		t.Fatal("snippet must not be empty")
	}
	if !strings.Contains(snippet, "分镜") {
		t.Fatalf("snippet should be centred on the hit, got %q", snippet)
	}
}

func TestCloudAgentSkillSearchNeverInlinesSkillBody(t *testing.T) {
	skills := []cloudAgentSkill{{ID: "s1", Name: "demo", Description: "PRIVATE_SKILL_BODY_SENTINEL 只在正文，不在描述", Instruction: "PRIVATE_INSTRUCTION_SENTINEL"}}
	result, err := cloudAgentSearchSkills(skills, "demo", 0)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(result)
	if strings.Contains(string(encoded), "PRIVATE_INSTRUCTION_SENTINEL") {
		t.Fatal("skill_search leaked instruction body")
	}
}

func TestCloudAgentSkillSearchTokensKeepsSingleCJKRune(t *testing.T) {
	// 单字停用词过滤照拿英文逻辑（a / I）；汉字单字「梗」「钩」「戏」本身就是完整语义的
	// 最小单位。被 < 2 一刀切后 tokens 为空，cloudAgentSearchSkills 会把检索退化成
	// 「列全部已启用技能索引」——用户以为搜过了，拿到的却是未排序的全量清单。
	got := cloudAgentSkillSearchTokens("反转 钩子 梗 钩")
	want := []string{"反转", "钩子", "梗", "钩"}
	if len(got) != len(want) {
		t.Fatalf("切词结果 %v，期望 %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("切词结果 %v，期望 %v", got, want)
		}
	}
	// 只放行汉字单字：英文/数字单字与空串仍按停用词处理。
	for _, keyword := range []string{"a", "I", "7", "", "，、。；"} {
		if tokens := cloudAgentSkillSearchTokens(keyword); len(tokens) != 0 {
			t.Fatalf("%q 应无候选词，得到 %v", keyword, tokens)
		}
	}
	// 端到端：单个汉字 token 必须能对描述命中打分，否则放行也没有意义。
	skill := cloudAgentSkill{ID: "x1", Name: "comedy-beat-lab", Description: "专门讲「梗」的密度、预期违背与排布节奏"}
	if score, _ := cloudAgentSkillMatch(skill, []string{"梗"}); score == 0 {
		t.Fatal("单个汉字 token 应该能命中描述")
	}
}

func TestCloudAgentSkillSearchTokensExpandHanBigrams(t *testing.T) {
	// 中文自然语句没有分隔符时整句是一个 token，整串 Contains 必然落空；
	// 展开重叠 2-gram 后任一片段命中即可参与排序。整串 token 保留在最前，
	// 整串命中时全部 gram 命中，得分自然更高。
	got := cloudAgentSkillSearchTokens("给这个短剧设计反转结尾")
	want := []string{"给这个短剧设计反转结尾", "给这", "这个", "个短", "短剧", "剧设", "设计", "计反", "反转", "转结", "结尾"}
	if len(got) != len(want) {
		t.Fatalf("切词结果 %v，期望 %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("切词结果 %v，期望 %v", got, want)
		}
	}
	// 纯 ASCII token 不展开 gram，保持整串匹配。
	if got := cloudAgentSkillSearchTokens("hook-paywall"); len(got) != 1 || got[0] != "hook-paywall" {
		t.Fatalf("ASCII token 不应展开 gram，得到 %v", got)
	}
	// 中文句里夹英文时，只保留中中二字词；I/P 这类字母片段不能误撞英文卡名。
	got = cloudAgentSkillSearchTokens("给第三方IP小猪佩奇做授权风险评估")
	for _, token := range got {
		if token == "ip" || token == "方i" || token == "p小" {
			t.Fatalf("mixed-language gram leaked into tokens: %v", got)
		}
	}
}

func TestCloudAgentSkillSearchMatchesNaturalPhraseViaGrams(t *testing.T) {
	// 回归：模型把自然语句整句当关键词时，旧逻辑整串 Contains 落空 →
	// 「没有命中」→ 模型得出「没有适用技能」并放弃技能裸做任务。
	// 2-gram 展开后整句也必须命中描述含「短剧」「反转」的 s2。
	result, err := cloudAgentSearchSkills(skillSearchTestSkills(), "给这个短剧设计一个反转结尾", 0)
	if err != nil {
		t.Fatal(err)
	}
	matches := result["matches"].([]map[string]any)
	if len(matches) == 0 {
		t.Fatal("natural phrase must not produce an empty result")
	}
	if matches[0]["skillId"] != "s2" {
		t.Fatalf("expected shortform-drama-playbook first, got %v", matches[0]["skillId"])
	}
}

func skillSearchConsolidatedPacks() []cloudAgentSkill {
	return []cloudAgentSkill{
		{
			ID: "14811816982284", Name: "consolidated-character", Description: "Consolidated package.",
			Files: map[string]string{
				cloudAgentSkillEntryPath:               "",
				"cards/drama-character-asset-board.md": "",
				"cards/character-forge-migration.md":   "",
			},
		},
		{
			ID: "16000000000094", Name: "consolidated-shot", Description: "Consolidated package.",
			Files: map[string]string{cloudAgentSkillEntryPath: "", "cards/drama-shot-card-14.md": ""},
		},
		{
			ID: "16000000000093", Name: "consolidated-prompt", Description: "Consolidated package.",
			Files: map[string]string{cloudAgentSkillEntryPath: "", "cards/drama-four-tier-prompt.md": ""},
		},
		{
			ID: "16000000000092", Name: "consolidated-seedance", Description: "Consolidated package.",
			Files: map[string]string{
				cloudAgentSkillEntryPath:           "",
				"cards/drama-frame-bridge.md":      "",
				"cards/sd25-continuity-locks.md":   "",
				"cards/sd25-unrelated-existing.md": "",
			},
		},
		{
			ID: "16000000000088", Name: "consolidated-assembly", Description: "Consolidated package.",
			Files: map[string]string{cloudAgentSkillEntryPath: "", "cards/drama-assembly-acceptance.md": ""},
		},
		{
			ID: "14811816982028", Name: "consolidated-series-image", Description: "Consolidated package.",
			Files: map[string]string{
				cloudAgentSkillEntryPath:         "",
				"cards/ec-product-image.md":      "",
				"cards/ec-detail-page.md":        "",
				"cards/ec-quality-scrub.md":      "",
				"cards/ec-unrelated-existing.md": "",
			},
		},
		{
			ID: "14811816981772", Name: "consolidated-product-video", Description: "Consolidated package.",
			Files: map[string]string{cloudAgentSkillEntryPath: "", "cards/ec-product-video.md": ""},
		},
		{
			ID: "14811816983052", Name: "consolidated-story", Description: "Consolidated package.",
			Files: map[string]string{
				cloudAgentSkillEntryPath:                    "",
				"cards/story-structure-engine-migration.md": "",
				"cards/short-narrative-structure.md":        "",
				"cards/shortfilm-5stage-structure.md":       "",
				"cards/shortfilm-micro-drama.md":            "",
				"cards/shortfilm-multi-shot-lock.md":        "",
				"cards/shortfilm-template-branch.md":        "",
				"cards/shortfilm-ip-safety.md":              "",
			},
		},
		{
			ID: "14811816982796", Name: "剧本撰写",
			Description: "把故事蓝图写成剧本文本：场景写作、对白、动作描述，以及对现成剧本与对白的诊断修复。",
			Files: map[string]string{
				cloudAgentSkillEntryPath:                    "",
				"cards/factory-script-machine-migration.md": "",
				"cards/dialogue-workshop-migration.md":      "",
			},
		},
		{
			ID: "16000000000095", Name: "consolidated-visual-prompt", Description: "Consolidated package.",
			Files: map[string]string{
				cloudAgentSkillEntryPath:                         "",
				"cards/prompt-engineering-patterns-migration.md": "",
				"cards/freestyle-style-library-migration.md":     "",
				"cards/video-reversal-prompt-migration.md":       "",
				"cards/video-visual-effect-prompt-migration.md":  "",
				"cards/video-reversal-prompt.md":                 "",
				"cards/video-visual-effect-prompt.md":            "",
			},
		},
		{
			ID: "16000000000086", Name: "consolidated-ai-performance", Description: "Consolidated package.",
			Files: map[string]string{
				cloudAgentSkillEntryPath:                      "",
				"cards/microexpression-director-migration.md": "",
			},
		},
		{
			ID: "16000000000074", Name: "喜剧 Mechanics", Description: "把平淡素材磨成好笑的段子与喜剧桥段，覆盖通用段子、情景喜剧、脱口秀开放麦和相声捧逗。",
			Files: map[string]string{
				cloudAgentSkillEntryPath:              "",
				"cards/comedy-general-index.md":       "",
				"cards/sitcom-index.md":               "",
				"cards/standup-index.md":              "",
				"cards/xiangsheng-index.md":           "",
				"cards/sitcom-lab-migration.md":       "",
				"cards/standup-craft-migration.md":    "",
				"cards/xiangsheng-craft-migration.md": "",
			},
		},
		{
			ID: "14811816969484", Name: "珠宝设计出款", Description: "专业珠宝设计与批量出款技能，支持单款、批量出款和系列延展；纯电商上架素材（九图/详情页/短视频）请移交电商技能。",
			Files: map[string]string{
				cloudAgentSkillEntryPath:       "",
				"cards/design-batch.md":        "",
				"cards/design-evolution.md":    "",
				"cards/design-presets.md":      "",
				"cards/evolution-migration.md": "",
			},
		},
		{
			ID: "14811816960780", Name: "珠宝电商图文视频一站式", Description: "珠宝品类电商素材：商品主图、角度图、详情页、珠宝亚马逊九图和短视频一体交付。",
			Files: map[string]string{cloudAgentSkillEntryPath: ""},
		},
		{
			ID: "yingce-image-editing", Name: "图片编辑工作流", Description: "基于画布图片节点完成图片编辑：文字描述改图、标注点位批量修改、按主体拆分图层。",
			Files: map[string]string{
				cloudAgentSkillEntryPath:               "",
				"cards/image-annotation.md":            "",
				"cards/image-layer-split.md":           "",
				"cards/image-annotation-migration.md":  "",
				"cards/image-layer-split-migration.md": "",
			},
		},
		{
			ID: "16000000000105", Name: "营销与转化-源起", Description: "广告调研、战役规划、脚本与投放策略。",
			Files: map[string]string{cloudAgentSkillEntryPath: ""},
		},
		{
			ID: "16000000000107", Name: "技能选择指南", Description: "把模糊需求路由到具体技能卡。",
			Files: map[string]string{cloudAgentSkillEntryPath: ""},
		},
	}
}

func TestCloudAgentSkillAliasesRoutePreciseLegacyPrompts(t *testing.T) {
	expected := map[string]string{
		"14811816982284|cards/drama-character-asset-board.md":           "做角色三视图",
		"16000000000094|cards/drama-shot-card-14.md":                    "写个分镜表",
		"16000000000093|cards/drama-four-tier-prompt.md":                "提示词总是不稳定",
		"16000000000092|cards/drama-frame-bridge.md":                    "两段怎么接",
		"16000000000092|cards/sd25-continuity-locks.md":                 "把视频里的人换成另一个人",
		"16000000000088|cards/drama-assembly-acceptance.md":             "帮我出剪辑单",
		"14811816982028|cards/ec-product-image.md":                      "做三视图",
		"14811816982028|cards/ec-detail-page.md":                        "做详情页",
		"14811816982028|cards/ec-quality-scrub.md":                      "画质油腻",
		"14811816981772|cards/ec-product-video.md":                      "让产品转起来",
		"14811816983052|cards/story-structure-engine-migration.md":      "故事结构引擎",
		"14811816983052|cards/short-narrative-structure.md":             "短片五阶段结构",
		"14811816983052|SKILL.md":                                       "故事开发",
		"14811816982284|cards/character-forge-migration.md":             "角色锻造工坊",
		"14811816982796|cards/factory-script-machine-migration.md":      "剧本工业化机器",
		"14811816982796|cards/dialogue-workshop-migration.md":           "对白工坊",
		"16000000000095|cards/prompt-engineering-patterns-migration.md": "提示词工程模式",
		"16000000000095|cards/freestyle-style-library-migration.md":     "Freestyle 风格库",
		"16000000000095|cards/video-reversal-prompt-migration.md":       "15秒极致夸张反转提示词",
		"16000000000095|cards/video-visual-effect-prompt-migration.md":  "15秒视觉特效",
		"16000000000086|cards/microexpression-director-migration.md":    "AI演员微表情导演",
		"16000000000074|cards/comedy-general-index.md":                  "段子结构",
		"16000000000074|cards/sitcom-index.md":                          "情景喜剧",
		"16000000000074|cards/standup-index.md":                         "脱口秀",
		"16000000000074|cards/xiangsheng-index.md":                      "相声",
		"16000000000074|cards/sitcom-lab-migration.md":                  "情景喜剧工坊",
		"16000000000074|cards/standup-craft-migration.md":               "脱口秀手艺",
		"16000000000074|cards/xiangsheng-craft-migration.md":            "相声手艺",
		"14811816969484|cards/evolution-migration.md":                   "珠宝设计进化",
		"yingce-image-editing|cards/image-annotation-migration.md":      "图片标注编辑",
		"yingce-image-editing|cards/image-layer-split-migration.md":     "图片图层拆分",
		"yingce-image-editing|SKILL.md":                                 "把这张图的背景换成纯白",
		"yingce-image-editing|cards/image-layer-split.md":               "拆成独立图层",
		"16000000000105|SKILL.md":                                       "广告全链路打法",
		"16000000000107|SKILL.md":                                       "选包门房",
	}
	if len(cloudAgentSkillAliasRules) != len(expected) {
		t.Fatalf("alias rule count = %d, want %d", len(cloudAgentSkillAliasRules), len(expected))
	}
	skills := skillSearchConsolidatedPacks()
	for _, rule := range cloudAgentSkillAliasRules {
		key := rule.SkillID + "|" + rule.Path
		trigger, ok := expected[key]
		if !ok {
			t.Errorf("unexpected alias rule %s", key)
			continue
		}
		found := false
		for _, candidate := range rule.Triggers {
			if candidate == trigger {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("alias rule %s is missing representative trigger %q", key, trigger)
		}
		for _, candidate := range rule.Triggers {
			result, err := cloudAgentSearchSkills(skills, candidate, 0)
			if err != nil {
				t.Fatal(err)
			}
			matches := result["matches"].([]map[string]any)
			if len(matches) == 0 {
				t.Errorf("trigger %q matched nothing", candidate)
				continue
			}
			if rule.Exclusive && len(matches) != 1 {
				t.Errorf("exclusive trigger %q matched %d skills, want 1", candidate, len(matches))
				continue
			}
			if matches[0]["skillId"] != rule.SkillID || matches[0]["path"] != rule.Path {
				t.Errorf("trigger %q routed to %v/%v, want %s/%s",
					candidate, matches[0]["skillId"], matches[0]["path"], rule.SkillID, rule.Path)
			}
			if matches[0]["direct"] != true {
				t.Errorf("trigger %q did not mark its first route as direct", candidate)
			}
			if matches[0]["score"].(int) < cloudAgentSkillAliasScore {
				t.Errorf("trigger %q scored %v, want at least %d",
					candidate, matches[0]["score"], cloudAgentSkillAliasScore)
			}
		}
	}
}

func TestCloudAgentSkillAliasesRouteLegacyIDs(t *testing.T) {
	expected := map[string]string{
		"14889899552012":           "16000000000086|cards/microexpression-director-migration.md",
		"16000000000075":           "14811816982796|cards/dialogue-workshop-migration.md",
		"16000000000076":           "14811816982796|cards/factory-script-machine-migration.md",
		"16000000000084":           "14811816983052|cards/story-structure-engine-migration.md",
		"16000000000080":           "14811816983052|cards/short-narrative-structure.md",
		"16000000000073":           "14811816982284|cards/character-forge-migration.md",
		"16000000000089":           "16000000000095|cards/freestyle-style-library-migration.md",
		"16000000000103":           "16000000000095|cards/prompt-engineering-patterns-migration.md",
		"14811816981260":           "16000000000095|cards/video-reversal-prompt-migration.md",
		"14811816981004":           "16000000000095|cards/video-visual-effect-prompt-migration.md",
		"16000000000082":           "16000000000074|cards/sitcom-lab-migration.md",
		"16000000000083":           "16000000000074|cards/standup-craft-migration.md",
		"16000000000085":           "16000000000074|cards/xiangsheng-craft-migration.md",
		"14811816969740":           "14811816969484|cards/evolution-migration.md",
		"yingce-image-annotation":  "yingce-image-editing|cards/image-annotation-migration.md",
		"yingce-image-layer-split": "yingce-image-editing|cards/image-layer-split-migration.md",
	}
	for legacyID, target := range expected {
		result, err := cloudAgentSearchSkills(skillSearchConsolidatedPacks(), legacyID, 0)
		if err != nil {
			t.Fatal(err)
		}
		matches := result["matches"].([]map[string]any)
		if len(matches) != 1 {
			t.Errorf("legacy ID %s matched %d skills, want 1", legacyID, len(matches))
			continue
		}
		got := matches[0]["skillId"].(string) + "|" + matches[0]["path"].(string)
		if got != target {
			t.Errorf("legacy ID %s routed to %s, want %s", legacyID, got, target)
		}
	}
}

func TestCloudAgentSkillAliasRulesCoverAllLegacyMigrations(t *testing.T) {
	for _, migration := range skills.LegacySkillMigrations() {
		byID := false
		byName := false
		for _, rule := range cloudAgentSkillAliasRules {
			for _, trigger := range rule.Triggers {
				if trigger == migration.LegacyID {
					byID = true
					if rule.SkillID != migration.TargetID {
						t.Errorf("legacy ID %s routes to %s, want %s", migration.LegacyID, rule.SkillID, migration.TargetID)
					}
				}
				if trigger == migration.LegacyName {
					byName = true
					if rule.SkillID != migration.TargetID {
						t.Errorf("legacy name %s routes to %s, want %s", migration.LegacyName, rule.SkillID, migration.TargetID)
					}
				}
			}
		}
		if !byID {
			t.Errorf("legacy ID %s has no exact alias trigger", migration.LegacyID)
		}
		if !byName {
			t.Errorf("legacy name %s has no exact alias trigger", migration.LegacyName)
		}
	}
}

func TestCloudAgentSkillAliasesRequireInstalledSkillAndExistingCard(t *testing.T) {
	cases := []struct {
		name   string
		skills []cloudAgentSkill
	}{
		{
			name: "skill not installed",
			skills: []cloudAgentSkill{{
				ID: "other", Name: "opaque", Description: "Opaque package.",
				Files: map[string]string{cloudAgentSkillEntryPath: ""},
			}},
		},
		{
			name: "configured card missing",
			skills: []cloudAgentSkill{{
				ID: "14811816982284", Name: "opaque", Description: "Opaque package.",
				Files: map[string]string{cloudAgentSkillEntryPath: "", "cards/character-forge-migration.md": ""},
			}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := cloudAgentSearchSkills(tc.skills, "做角色三视图", 0)
			if err != nil {
				t.Fatal(err)
			}
			if matches := result["matches"].([]map[string]any); len(matches) != 0 {
				t.Fatalf("alias must not invent a route: %v", matches)
			}
		})
	}
}

func TestCloudAgentSkillAliasesDoNotCaptureUnrelatedWork(t *testing.T) {
	for _, keyword := range []string{
		"给第三方IP小猪佩奇做授权风险评估",
		"安排小虎IP的个人抖音直播运营排班",
		"帮我把宝宝照片配一段朋友圈文案",
		"把这段通知里的两个错别字改掉",
	} {
		result, err := cloudAgentSearchSkills(skillSearchConsolidatedPacks(), keyword, 0)
		if err != nil {
			t.Fatal(err)
		}
		if matches := result["matches"].([]map[string]any); len(matches) != 0 {
			t.Errorf("negative trigger %q was captured: %v", keyword, matches)
		}
	}
}

func TestCloudAgentSkillAliasesIgnoreBackgroundMusicAndActionScript(t *testing.T) {
	for _, keyword := range []string{
		"帮我找一段换背景音乐",
		"这段视频改背景音乐的节奏",
		"这场打戏怎么写得更紧张",
	} {
		if alias, ok := cloudAgentSkillBestAlias(skillSearchConsolidatedPacks(), keyword); ok {
			t.Errorf("keyword %q was captured by alias %s/%s", keyword, alias.SkillID, alias.Path)
		}
	}
}

func TestCloudAgentSkillAliasesRejectBroadStandaloneTriggers(t *testing.T) {
	broad := map[string]bool{
		"视频": true, "分镜": true, "商品图": true, "角色": true, "喜剧": true,
		"海报": true, "主图": true, "详情页": true, "提示词": true,
		"短片": true, "IP安全": true,
	}
	for _, rule := range cloudAgentSkillAliasRules {
		for _, trigger := range rule.Triggers {
			normalized := cloudAgentSkillAliasText(trigger)
			if normalized == "" {
				t.Errorf("alias rule %s has an empty trigger", rule.SkillID+"|"+rule.Path)
			}
			if rule.Exclusive && broad[normalized] {
				t.Errorf("alias rule %s uses broad trigger %q", rule.SkillID+"|"+rule.Path, trigger)
			}
		}
	}
}

func TestCloudAgentSkillAliasesTargetBuiltinFiles(t *testing.T) {
	_, testFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve test file path")
	}
	root := filepath.Join(filepath.Dir(testFile), "..", "..", "builtin")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	skillDirs := make(map[string]string, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(root, entry.Name())
		body, err := os.ReadFile(filepath.Join(dir, cloudAgentSkillEntryPath))
		if err != nil {
			t.Fatal(err)
		}
		for _, rule := range cloudAgentSkillAliasRules {
			if strings.Contains(string(body), `skillId: "`+rule.SkillID+`"`) {
				skillDirs[rule.SkillID] = dir
			}
		}
	}
	for _, rule := range cloudAgentSkillAliasRules {
		dir, ok := skillDirs[rule.SkillID]
		if !ok {
			t.Errorf("alias target skill %s is missing from builtin packages", rule.SkillID)
			continue
		}
		info, err := os.Stat(filepath.Join(dir, filepath.FromSlash(rule.Path)))
		if err != nil {
			t.Errorf("alias target %s/%s is unavailable: %v", rule.SkillID, rule.Path, err)
			continue
		}
		if info.Size() == 0 {
			t.Errorf("alias target %s/%s is empty", rule.SkillID, rule.Path)
		}
	}
}

func TestCloudAgentSkillAliasResponseStaysCompact(t *testing.T) {
	for _, rule := range cloudAgentSkillAliasRules {
		if len(rule.Triggers) == 0 {
			t.Fatalf("alias rule %s has no trigger", rule.SkillID+"|"+rule.Path)
		}
		result, err := cloudAgentSearchSkills(skillSearchConsolidatedPacks(), rule.Triggers[0], 0)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		if len(encoded) > 4096 {
			t.Errorf("alias response for %q is %d bytes, want <= 4096", rule.Triggers[0], len(encoded))
		}
	}
}

func TestCloudAgentSkillComedyModesDoNotCrossRoute(t *testing.T) {
	cases := []struct {
		keyword string
		path    string
	}{
		{"写一段情景喜剧", "cards/sitcom-index.md"},
		{"脱口秀开放麦怎么排段子", "cards/standup-index.md"},
		{"相声捧逗怎么铺包袱", "cards/xiangsheng-index.md"},
		{"段子结构怎么搭", "cards/comedy-general-index.md"},
	}
	for _, tc := range cases {
		result, err := cloudAgentSearchSkills(skillSearchConsolidatedPacks(), tc.keyword, 0)
		if err != nil {
			t.Fatal(err)
		}
		matches := result["matches"].([]map[string]any)
		if len(matches) == 0 {
			t.Errorf("%q matched nothing", tc.keyword)
			continue
		}
		if matches[0]["skillId"] != "16000000000074" || matches[0]["path"] != tc.path {
			t.Errorf("%q routed to %v/%v, want 16000000000074/%s",
				tc.keyword, matches[0]["skillId"], matches[0]["path"], tc.path)
		}
		if matches[0]["direct"] != true {
			t.Errorf("%q did not mark the comedy route as direct", tc.keyword)
		}
	}
}

// “喜剧”是题材词，不是完整工位说法。它一旦成为精确别名，会清空同句里的
// 其他候选，把“写喜剧剧本”这类请求强行锁死在喜剧包。
func TestCloudAgentSkillComedyGenreDoesNotSwallowScriptRequests(t *testing.T) {
	for _, keyword := range []string{
		"写一个喜剧短片剧本",
		"帮我把这个喜剧写成剧本",
	} {
		result, err := cloudAgentSearchSkills(skillSearchConsolidatedPacks(), keyword, 0)
		if err != nil {
			t.Fatal(err)
		}
		matches := result["matches"].([]map[string]any)
		if len(matches) == 0 {
			t.Errorf("%q matched nothing", keyword)
			continue
		}
		var screenplayOffered bool
		for _, match := range matches {
			if match["skillId"] == "14811816982796" {
				screenplayOffered = true
			}
		}
		if !screenplayOffered {
			t.Errorf("%q hid the screenplay skill behind the comedy genre alias: %v", keyword, matches)
		}
	}
}

func TestCloudAgentSkillJewelryModesDoNotCrossRoute(t *testing.T) {
	skills := skillSearchConsolidatedPacks()

	result, err := cloudAgentSearchSkills(skills, "帮我设计一款戒指", 0)
	if err != nil {
		t.Fatal(err)
	}
	matches := result["matches"].([]map[string]any)
	if len(matches) != 1 || matches[0]["skillId"] != "14811816969484" || matches[0]["path"] != cloudAgentSkillEntryPath {
		t.Fatalf("plain jewelry design must stay on the main entry, got %v", matches)
	}

	result, err = cloudAgentSearchSkills(skills, "珠宝设计进化", 0)
	if err != nil {
		t.Fatal(err)
	}
	matches = result["matches"].([]map[string]any)
	if len(matches) != 1 || matches[0]["path"] != "cards/evolution-migration.md" {
		t.Fatalf("legacy jewelry evolution must route to its migration card, got %v", matches)
	}

	result, err = cloudAgentSearchSkills(skills, "珠宝设计定稿后做亚马逊九图", 0)
	if err != nil {
		t.Fatal(err)
	}
	matches = result["matches"].([]map[string]any)
	if len(matches) == 0 || matches[0]["skillId"] != "14811816969484" {
		t.Fatalf("jewelry handoff query should keep the design pack first, got %v", matches)
	}
	for _, match := range matches {
		if match["path"] == "cards/evolution-migration.md" {
			t.Fatalf("handoff query must not fall into the evolution migration card: %v", matches)
		}
	}
}

func TestCloudAgentSkillImageEditingModesDoNotCrossRoute(t *testing.T) {
	skills := skillSearchConsolidatedPacks()
	for _, keyword := range []string{
		"把这张图的背景换成纯白",
		"把人物和商品拆成独立图层",
	} {
		result, err := cloudAgentSearchSkills(skills, keyword, 0)
		if err != nil {
			t.Fatal(err)
		}
		matches := result["matches"].([]map[string]any)
		if len(matches) == 0 || matches[0]["skillId"] != "yingce-image-editing" {
			t.Errorf("%q should stay in the image editing pack, got %v", keyword, matches)
			continue
		}
		if strings.Contains(matches[0]["path"].(string), "migration") {
			t.Errorf("%q was captured by a migration card: %v", keyword, matches)
		}
	}
}

func TestCloudAgentSkillAliasesKeepCollaborativeCandidates(t *testing.T) {
	cases := []struct {
		keyword  string
		skillID  string
		path     string
		required []string
	}{
		{
			keyword: "写一段相声剧本",
			skillID: "16000000000074", path: "cards/xiangsheng-index.md",
			required: []string{"14811816982796"},
		},
		{
			keyword: "给这张商品主图换背景",
			skillID: "14811816982028", path: "cards/ec-product-image.md",
			required: []string{"yingce-image-editing"},
		},
		{
			keyword: "做一张海报并换背景",
			skillID: "14811816982028", path: "cards/ec-product-image.md",
			required: []string{"yingce-image-editing"},
		},
	}
	for _, tc := range cases {
		result, err := cloudAgentSearchSkills(skillSearchConsolidatedPacks(), tc.keyword, 0)
		if err != nil {
			t.Fatal(err)
		}
		matches := result["matches"].([]map[string]any)
		if len(matches) == 0 {
			t.Errorf("%q matched nothing", tc.keyword)
			continue
		}
		first := matches[0]
		if first["skillId"] != tc.skillID || first["path"] != tc.path {
			t.Errorf("%q routed to %v/%v first, want %s/%s",
				tc.keyword, first["skillId"], first["path"], tc.skillID, tc.path)
		}
		if first["direct"] != true {
			t.Errorf("%q did not mark its first route as direct", tc.keyword)
		}
		offered := make(map[string]bool, len(matches))
		for _, match := range matches {
			offered[match["skillId"].(string)] = true
		}
		for _, skillID := range tc.required {
			if !offered[skillID] {
				t.Errorf("%q hid collaborative skill %s: %v", tc.keyword, skillID, matches)
			}
		}
	}
}

func TestCloudAgentSkillOrdinaryAliasesHoldCombinedResponseBudget(t *testing.T) {
	for _, keyword := range []string{
		"写一段相声剧本",
		"给这张商品主图换背景",
		"做一张海报并换背景",
	} {
		result, err := cloudAgentSearchSkills(skillSearchConsolidatedPacks(), keyword, 0)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		if len(encoded) > 4096 {
			t.Errorf("combined response for %q is %d bytes, want <= 4096", keyword, len(encoded))
		}
		cardCount := 0
		for _, match := range result["matches"].([]map[string]any) {
			if cards, ok := match["cards"].([]string); ok {
				cardCount += len(cards)
			}
		}
		if cardCount > cloudAgentSkillSearchCardBudget {
			t.Errorf("combined response for %q advertised %d cards, want <= %d",
				keyword, cardCount, cloudAgentSkillSearchCardBudget)
		}
	}
}

func TestCloudAgentSkillOrdinaryAliasHonorsExclusion(t *testing.T) {
	result, err := cloudAgentSearchSkills(skillSearchConsolidatedPacks(), "帮我找一段换背景音乐", 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, match := range result["matches"].([]map[string]any) {
		if match["skillId"] == "yingce-image-editing" && match["direct"] == true {
			t.Fatalf("background music request was treated as an image-editing alias: %v", match)
		}
	}
}

func TestCloudAgentSkillAliasNeedsMigrationCardToFire(t *testing.T) {
	skills := []cloudAgentSkill{{
		ID: "16000000000074", Name: "喜剧 Mechanics", Description: "喜剧与段子方法。",
		Files: map[string]string{
			cloudAgentSkillEntryPath: "",
			"cards/sitcom-index.md":  "",
		},
	}}
	result, err := cloudAgentSearchSkills(skills, "情景喜剧工坊", 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, match := range result["matches"].([]map[string]any) {
		if strings.Contains(match["path"].(string), "migration") {
			t.Fatalf("missing migration card must not be advertised: %v", result["matches"])
		}
	}
}

func TestCloudAgentSkillSearchResponseNeverExceedsByteBudget(t *testing.T) {
	description := strings.Repeat("影视制作方法说明，", 300)
	skills := make([]cloudAgentSkill, 0, 20)
	for skillIndex := 0; skillIndex < 20; skillIndex++ {
		files := map[string]string{cloudAgentSkillEntryPath: ""}
		for cardIndex := 0; cardIndex < 40; cardIndex++ {
			files[fmt.Sprintf("cards/shot-%02d-long-card-name.md", cardIndex)] = ""
		}
		skills = append(skills, cloudAgentSkill{
			ID:          fmt.Sprintf("long-skill-%02d", skillIndex),
			Name:        fmt.Sprintf("影视制作技能包%02d", skillIndex),
			Description: description,
			Files:       files,
		})
	}

	result, err := cloudAgentSearchSkills(skills, "影视", 0)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) > cloudAgentSkillSearchResponseBudget {
		t.Fatalf("response is %d bytes, want <= %d", len(encoded), cloudAgentSkillSearchResponseBudget)
	}
	if result["total"] != len(skills) {
		t.Fatalf("total = %v, want %d", result["total"], len(skills))
	}
}
