package feishuintegration

import (
	"strings"
	"testing"
	"time"
)

func TestDayWindowAndDueAtUseConfiguredLocation(t *testing.T) {
	location := time.FixedZone("CST", 8*60*60)
	now := time.Date(2026, 11, 11, 15, 0, 0, 0, time.UTC)
	start, end := DayWindow(now, location)
	if start.Format(time.RFC3339) != "2026-11-11T00:00:00+08:00" || end.Sub(start) != 24*time.Hour {
		t.Fatalf("unexpected day window: %s - %s", start, end)
	}
	if !DueAt(now, location, 23, 0) || DueAt(now, location, 22, 59) {
		t.Fatal("due minute did not use configured location")
	}
	if DueAt(now, location, 24, 0) {
		t.Fatal("invalid hour was accepted")
	}
}

func TestBuildDigestIsDeterministicAndGroupsTypes(t *testing.T) {
	day := time.Date(2026, 11, 11, 0, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	items := []SummaryItem{
		{ID: "2", Type: "feature", Title: "导出", Content: "希望支持\n批量", SenderName: "乙", CreatedAt: day.Add(2 * time.Hour)},
		{ID: "1", Type: "bug", Title: "登录", Content: strings.Repeat("x", 601), SenderName: "甲", CreatedAt: day.Add(time.Hour)},
	}
	first := BuildDigest(day, items)
	second := BuildDigest(day, []SummaryItem{items[1], items[0]})
	if first != second {
		t.Fatalf("digest ordering is not deterministic:\n%s\n%s", first, second)
	}
	if !strings.Contains(first, "飞书需求 / Bug 日报（2026-11-11）") || !strings.Contains(first, "Bug") || !strings.Contains(first, "需求") || !strings.Contains(first, "x…") || strings.Contains(first, "\n批量") {
		t.Fatalf("digest formatting unexpected:\n%s", first)
	}
}

func TestBuildDigestEmpty(t *testing.T) {
	result := BuildDigest(time.Date(2026, 11, 11, 0, 0, 0, 0, time.UTC), nil)
	if !strings.Contains(result, "共 0 条") || !strings.Contains(result, "没有新的需求或 Bug") {
		t.Fatalf("empty digest missing explicit state: %s", result)
	}
}
