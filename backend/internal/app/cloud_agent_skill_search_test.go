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
	req := CloudAgentRequest{SkillIDs: []string{"s1"}}
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

func TestCloudAgentSkillSearchClampsLimitAndHandlesNoHit(t *testing.T) {
	skills := skillSearchTestSkills()
	result, err := cloudAgentSearchSkills(skills, "钩子", 99)
	if err != nil {
		t.Fatal(err)
	}
	if len(result["matches"].([]map[string]any)) != 1 {
		t.Fatalf("expected single hit for 钩子, got %v", result["matches"])
	}
	result, err = cloudAgentSearchSkills(skills, "量子纠缠炒菜", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(result["matches"].([]map[string]any)) != 0 {
		t.Fatalf("expected no matches, got %v", result["matches"])
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
	if guidance, _ := result["guidance"].(string); !strings.Contains(guidance, "没有已启用") {
		t.Fatalf("guidance mismatch: %q", guidance)
	}
}

func TestCloudAgentSkillSearchToleratesStraySkillIDArgument(t *testing.T) {
	// 实测回归：step-5 首次调用时按 skill_read_file 的参数习惯顺手带上 skillId，
	// 被 decodeCloudAgentJSONObject（DisallowUnknownFields）拒绝 → tool_failed，
	// 检索一次都没成功。这里走完整的工具分发路径，确保解码层真的容忍该字段。
	state := &cloudAgentRuntime{Skills: skillSearchTestSkills()}
	call := cloudAgentCall{ID: "c1"}
	call.Function.Name = "skill_search"
	call.Function.Arguments = `{"keyword":"反转 钩子 结构 便利店","skillId":"s1"}`
	result, err := cloudAgentReadTool(nil, "u1", state, call)
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
	// 该字段仅接收不生效：检索范围恒为本轮全部已启用技能，
	// 传了 s1 也必须能命中 name/description 在 s2 上的结果。
	if matches[0]["skillId"] != "s2" {
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
