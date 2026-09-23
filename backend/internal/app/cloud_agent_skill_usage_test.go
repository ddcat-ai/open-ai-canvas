package app

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func cloudAgentUsageEvent(runID, kind, tool string, payload map[string]any) CloudAgentEvent {
	return CloudAgentEvent{RunID: runID, Type: kind, Payload: payload}
}

func TestCloudAgentSkillUsageAggregatesLoadSearchAndReads(t *testing.T) {
	events := []CloudAgentEvent{
		cloudAgentUsageEvent("run-1", "tool_completed", "skills_load", map[string]any{
			"toolName": "skills_load",
			"skillIds": []any{"s1", "s2"},
		}),
		cloudAgentUsageEvent("run-1", "tool_completed", "skill_search", map[string]any{
			"toolName": "skill_search",
			"result": map[string]any{"matches": []any{
				map[string]any{"skillId": "s1", "path": "SKILL.md", "score": 3},
			}},
		}),
		cloudAgentUsageEvent("run-1", "tool_completed", "skill_read_file", map[string]any{
			"toolName": "skill_read_file", "skillId": "s1", "skillName": "短剧手册", "path": "SKILL.md",
		}),
		cloudAgentUsageEvent("run-1", "tool_completed", "skill_read_file", map[string]any{
			"toolName": "skill_read_file", "skillId": "s1", "skillName": "短剧手册", "path": "cards/ssqr-twist-ending.md",
		}),
		cloudAgentUsageEvent("run-2", "tool_completed", "skills_load", map[string]any{
			"toolName": "skills_load",
			"skillIds": []any{"s1"},
		}),
	}

	usage := cloudAgentSkillUsageFromEvents(events)

	if usage.ScannedRuns != 2 {
		t.Fatalf("scannedRuns = %d, want 2", usage.ScannedRuns)
	}
	if usage.SearchCalls != 1 {
		t.Fatalf("searchCalls = %d, want 1", usage.SearchCalls)
	}
	if len(usage.Skills) != 2 {
		t.Fatalf("skills = %d, want 2", len(usage.Skills))
	}
	// s1 has more runs enabled, so it sorts first.
	first := usage.Skills[0]
	if first.SkillID != "s1" {
		t.Fatalf("first skill = %s, want s1", first.SkillID)
	}
	if first.SkillName != "短剧手册" {
		t.Fatalf("skillName = %q, want 短剧手册", first.SkillName)
	}
	if first.RunsEnabled != 2 || first.SearchHits != 1 || first.ReadCalls != 2 {
		t.Fatalf("s1 counters = %+v", first)
	}
	if first.EntryReads != 1 || first.CardReads != 1 {
		t.Fatalf("s1 entry/card reads = %d/%d, want 1/1", first.EntryReads, first.CardReads)
	}
	if len(first.TopCards) != 1 || first.TopCards[0].Path != "cards/ssqr-twist-ending.md" {
		t.Fatalf("s1 topCards = %+v", first.TopCards)
	}
	if usage.Skills[1].RunsEnabled != 1 {
		t.Fatalf("s2 runsEnabled = %d, want 1", usage.Skills[1].RunsEnabled)
	}
}

func TestCloudAgentSkillUsageSeparatesEntryAndCardReads(t *testing.T) {
	events := []CloudAgentEvent{
		cloudAgentUsageEvent("run-1", "tool_completed", "skill_read_file", map[string]any{
			"toolName": "skill_read_file", "skillId": "s1", "path": cloudAgentSkillEntryPath,
		}),
		cloudAgentUsageEvent("run-1", "tool_completed", "skill_read_file", map[string]any{
			"toolName": "skill_read_file", "skillId": "s1", "path": "",
		}),
		cloudAgentUsageEvent("run-1", "tool_completed", "skill_read_file", map[string]any{
			"toolName": "skill_read_file", "skillId": "s1", "path": "cards/a.md",
		}),
	}
	usage := cloudAgentSkillUsageFromEvents(events)
	if len(usage.Skills) != 1 {
		t.Fatalf("skills = %d, want 1", len(usage.Skills))
	}
	got := usage.Skills[0]
	if got.EntryReads != 2 {
		t.Fatalf("entryReads = %d, want 2 (SKILL.md plus directory listing)", got.EntryReads)
	}
	if got.CardReads != 1 || got.ReadCalls != 3 {
		t.Fatalf("cardReads/readCalls = %d/%d, want 1/3", got.CardReads, got.ReadCalls)
	}
}

func TestCloudAgentSkillUsageCountsReadFailures(t *testing.T) {
	events := []CloudAgentEvent{
		cloudAgentUsageEvent("run-1", "tool_failed", "skill_read_file", map[string]any{
			"toolName": "skill_read_file", "skillId": "s1", "path": "cards/missing.md",
		}),
		cloudAgentUsageEvent("run-1", "tool_completed", "skill_read_file", map[string]any{
			"toolName": "skill_read_file", "skillId": "s1", "path": "cards/a.md",
		}),
	}
	usage := cloudAgentSkillUsageFromEvents(events)
	got := usage.Skills[0]
	if got.ReadFailures != 1 {
		t.Fatalf("readFailures = %d, want 1", got.ReadFailures)
	}
	if got.ReadCalls != 1 || got.CardReads != 1 {
		t.Fatalf("readCalls/cardReads = %d/%d, want 1/1", got.ReadCalls, got.CardReads)
	}
	if len(got.TopCards) != 1 || got.TopCards[0].Path != "cards/a.md" {
		t.Fatalf("topCards must only count successful reads, got %+v", got.TopCards)
	}
}

func TestCloudAgentSkillUsageTopCardsCappedAndOrdered(t *testing.T) {
	// Six distinct cards with strictly decreasing counts, so the cap has an
	// unambiguous coldest card to drop.
	counts := []struct {
		path  string
		count int
	}{
		{"cards/a.md", 6},
		{"cards/b.md", 5},
		{"cards/c.md", 4},
		{"cards/d.md", 3},
		{"cards/e.md", 2},
		{"cards/f.md", 1},
	}
	var events []CloudAgentEvent
	total := 0
	for _, card := range counts {
		for i := 0; i < card.count; i++ {
			events = append(events, cloudAgentUsageEvent("run-1", "tool_completed", "skill_read_file", map[string]any{
				"toolName": "skill_read_file", "skillId": "s1", "path": card.path,
			}))
		}
		total += card.count
	}
	usage := cloudAgentSkillUsageFromEvents(events)
	got := usage.Skills[0]
	if got.CardReads != total {
		t.Fatalf("cardReads = %d, want %d", got.CardReads, total)
	}
	if len(got.TopCards) != cloudAgentSkillUsageTopCards {
		t.Fatalf("topCards = %d, want cap %d", len(got.TopCards), cloudAgentSkillUsageTopCards)
	}
	// The cap keeps the hottest cards, so the lowest-count card is dropped.
	for _, card := range got.TopCards {
		if card.Path == "cards/f.md" {
			t.Fatalf("topCards kept the coldest card: %+v", got.TopCards)
		}
	}
	if got.TopCards[0].Path != "cards/a.md" {
		t.Fatalf("topCards[0] = %s, want the hottest card", got.TopCards[0].Path)
	}
	for i := 1; i < len(got.TopCards); i++ {
		if got.TopCards[i-1].Count < got.TopCards[i].Count {
			t.Fatalf("topCards not ordered by count desc: %+v", got.TopCards)
		}
	}
}

func TestCloudAgentSkillUsageIgnoresNonSkillToolsAndPayloads(t *testing.T) {
	events := []CloudAgentEvent{
		cloudAgentUsageEvent("run-1", "tool_completed", "canvas_get_state", map[string]any{
			"toolName": "canvas_get_state", "result": map[string]any{"nodes": []any{}},
		}),
		cloudAgentUsageEvent("run-1", "reasoning_message", "reasoning", map[string]any{"text": "skill_search skill_read_file"}),
		cloudAgentUsageEvent("run-1", "tool_completed", "skill_read_file", map[string]any{
			"toolName": "skill_read_file", "path": "cards/orphan.md",
		}),
		cloudAgentUsageEvent("run-1", "tool_completed", "skill_search", map[string]any{
			"toolName": "skill_search", "result": map[string]any{"matches": []any{
				map[string]any{"skillId": "", "path": "SKILL.md"},
				"not-an-object",
			}},
		}),
	}
	usage := cloudAgentSkillUsageFromEvents(events)
	if len(usage.Skills) != 0 {
		t.Fatalf("skills = %d, want 0 (reads without skillId are not attributable)", len(usage.Skills))
	}
	// The search round itself is still counted even though nothing matched.
	if usage.SearchCalls != 1 {
		t.Fatalf("searchCalls = %d, want 1", usage.SearchCalls)
	}
	if usage.ScannedRuns != 0 {
		t.Fatalf("scannedRuns = %d, want 0 without a skills_load event", usage.ScannedRuns)
	}
}

func TestCloudAgentSkillUsageEmptyJournal(t *testing.T) {
	usage := cloudAgentSkillUsageFromEvents(nil)
	if usage == nil {
		t.Fatal("usage must never be nil")
	}
	if len(usage.Skills) != 0 || usage.ScannedRuns != 0 || usage.SearchCalls != 0 {
		t.Fatalf("empty usage = %+v", usage)
	}
}

func TestCloudAgentSkillUsageSkillsLoadWithoutIDsFallsBackToRunCount(t *testing.T) {
	// Journal rows written before the skillIds field existed still count the run.
	events := []CloudAgentEvent{
		cloudAgentUsageEvent("run-1", "tool_completed", "skills_load", map[string]any{
			"toolName": "skills_load", "text": "已启用 3 个技能，正文将按需读取",
		}),
		cloudAgentUsageEvent("run-1", "tool_completed", "skill_read_file", map[string]any{
			"toolName": "skill_read_file", "skillId": "s1", "path": "cards/a.md",
		}),
	}
	usage := cloudAgentSkillUsageFromEvents(events)
	if usage.ScannedRuns != 1 {
		t.Fatalf("scannedRuns = %d, want 1", usage.ScannedRuns)
	}
	if len(usage.Skills) != 1 || usage.Skills[0].RunsEnabled != 0 {
		t.Fatalf("skills = %+v, want s1 with runsEnabled 0", usage.Skills)
	}
}

func TestCloudAgentSkillUsageReadsOnlyOwnJournalAndRejectsCorruptReceipts(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	for _, item := range []struct {
		id, userID, skillID string
	}{
		{"own-usage-run", "user", "own-skill"},
		{"foreign-usage-run", "other", "foreign-skill"},
	} {
		if err := db.Create(&model.CloudAgentExecution{ID: item.id, UserID: item.userID, Status: "completed", CreatedAt: time.Now()}).Error; err != nil {
			t.Fatal(err)
		}
		body := `{"runId":"` + item.id + `","type":"tool_completed","payload":{"toolName":"skills_load","skillIds":["` + item.skillID + `"]}}`
		if err := db.Create(&model.CloudAgentEventRecord{RunID: item.id, UserID: item.userID, Sequence: 1, EventJSON: body}).Error; err != nil {
			t.Fatal(err)
		}
	}
	usage, err := s.CloudAgentSkillUsage("user")
	if err != nil {
		t.Fatal(err)
	}
	if usage.ScannedRuns != 1 || len(usage.Skills) != 1 || usage.Skills[0].SkillID != "own-skill" {
		t.Fatalf("cross-user journal leaked or own skill missing: %+v", usage)
	}
	if err := db.Model(&model.CloudAgentEventRecord{}).Where("run_id = ?", "own-usage-run").Update("event_json", "{").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.CloudAgentSkillUsage("user"); err == nil {
		t.Fatal("corrupt receipt must not produce incomplete success metrics")
	}
}
