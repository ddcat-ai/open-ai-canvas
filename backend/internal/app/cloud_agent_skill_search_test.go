package app

import (
	"encoding/json"
	"strings"
	"testing"
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
	// 零命中降级：返回已启用技能索引而不是空列表——「没搜到」不该被模型
	// 解读成「没有适用技能」后直接放弃技能裸做任务。
	degraded := result["matches"].([]map[string]any)
	if len(degraded) != 1 {
		t.Fatalf("zero-hit query must return one indexed skill at limit 1, got %v", result["matches"])
	}
	if result["total"].(int) != 3 {
		t.Fatalf("expected total 3 on degraded index, got %v", result["total"])
	}
	if guidance, _ := result["guidance"].(string); !strings.Contains(guidance, "skill_read_file") {
		t.Fatalf("no-hit guidance must point at skill_read_file: %q", guidance)
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
	s, db, _, _ := creationTestService(t)
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
	pool, err := s.cloudAgentBuildSkillPool("u1", "", nil, defaultCloudAgentContextBudget())
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
