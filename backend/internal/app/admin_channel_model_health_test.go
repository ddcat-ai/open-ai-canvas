package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestBuildAdminChannelModelHealthCountsWindowsAndRecentResults(t *testing.T) {
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	// 按时间倒序：最新在前。
	logs := []model.ApiCallLog{
		{ChannelID: "c1", Model: "m1", Status: model.ApiCallStatusFailed, StatusCode: 502, DurationMs: 900, CreatedAt: now.Add(-time.Minute)},
		{ChannelID: "c1", Model: "m1", Status: model.ApiCallStatusSucceeded, DurationMs: 100, CreatedAt: now.Add(-time.Hour)},
		{ChannelID: "c1", Model: "m1", Status: model.ApiCallStatusSucceeded, DurationMs: 200, CreatedAt: now.Add(-48 * time.Hour)},
		{ChannelID: "c2", Model: "m1", Status: model.ApiCallStatusSucceeded, DurationMs: 300, CreatedAt: now.Add(-72 * time.Hour)},
	}
	report := buildAdminChannelModelHealth(logs, now)
	if len(report.Items) != 2 {
		t.Fatalf("items = %d, want 2", len(report.Items))
	}
	first := report.Items[0]
	if first.ChannelID != "c1" || first.Requests24h != 2 || first.Succeeded24h != 1 || first.Failed24h != 1 || first.Requests7d != 3 {
		t.Fatalf("c1 counts = %+v", first)
	}
	if first.SuccessRate24h == nil || *first.SuccessRate24h != 0.5 {
		t.Fatalf("c1 24h rate = %v", first.SuccessRate24h)
	}
	if len(first.RecentResults) != 3 || !first.RecentResults[0] || first.RecentResults[2] {
		t.Fatalf("recent results must be oldest-first with the failure last: %v", first.RecentResults)
	}
	if first.LastErrorCode != "HTTP 502" || first.LastFailedAt == nil {
		t.Fatalf("last failure = %q %v", first.LastErrorCode, first.LastFailedAt)
	}
	second := report.Items[1]
	if second.Requests24h != 0 || second.SuccessRate24h != nil || second.Requests7d != 1 {
		t.Fatalf("c2 without 24h samples must report a nil rate: %+v", second)
	}
}
