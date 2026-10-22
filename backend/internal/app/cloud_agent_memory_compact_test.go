package app

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestUpdateUserAgentMemorySettingNormalizesInterval(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	if _, err := s.UpdateUserAgentMemorySetting("user-a", AgentMemorySettingRequest{CompactInterval: "yearly"}); err == nil {
		t.Fatal("非法周期必须拒绝")
	}
	view, err := s.UpdateUserAgentMemorySetting("user-a", AgentMemorySettingRequest{
		CompactInterval: "weekly", Model: "chan::gpt-text", ChannelID: "chan", ChannelModelKey: "gpt-text",
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.CompactInterval != model.AgentMemoryCompactIntervalWeekly || view.ChannelID != "chan" {
		t.Fatalf("应保存周期和模型：%+v", view)
	}
	again, err := s.UpdateUserAgentMemorySetting("user-a", AgentMemorySettingRequest{CompactInterval: "daily"})
	if err != nil {
		t.Fatal(err)
	}
	if again.CompactInterval != model.AgentMemoryCompactIntervalDaily || again.ChannelID != "chan" || again.Model != "chan::gpt-text" {
		t.Fatalf("只改周期时必须保留已选模型：%+v", again)
	}
}

func TestAgentMemoryCompactDueAndBusy(t *testing.T) {
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.UTC)
	stale := now.Add(-cloudAgentMemoryCompactStaleAfter - time.Minute)
	recent := now.Add(-time.Minute)
	if agentMemoryCompactDue(model.AgentMemorySetting{CompactInterval: model.AgentMemoryCompactIntervalOff}, now) {
		t.Fatal("关闭定时后不应到期")
	}
	if !agentMemoryCompactDue(model.AgentMemorySetting{CompactInterval: model.AgentMemoryCompactIntervalDaily}, now) {
		t.Fatal("从未压缩过的 daily 应到期")
	}
	last := now.Add(-2 * time.Hour)
	if agentMemoryCompactDue(model.AgentMemorySetting{CompactInterval: model.AgentMemoryCompactIntervalDaily, LastCompactAt: &last}, now) {
		t.Fatal("未满一天不应到期")
	}
	last = now.Add(-25 * time.Hour)
	if !agentMemoryCompactDue(model.AgentMemorySetting{CompactInterval: model.AgentMemoryCompactIntervalDaily, LastCompactAt: &last}, now) {
		t.Fatal("超过一天应到期")
	}
	if !agentMemoryCompactBusy(model.AgentMemorySetting{LastStatus: model.AgentMemoryCompactStatusQueued, CompactStartedAt: &recent}, now) {
		t.Fatal("排队未超时应视为忙碌")
	}
	if agentMemoryCompactBusy(model.AgentMemorySetting{LastStatus: model.AgentMemoryCompactStatusQueued, CompactStartedAt: &stale}, now) {
		t.Fatal("超过 30 分钟的排队应允许重试")
	}
}

func TestParseAgentMemoryCompactPlanStripsFence(t *testing.T) {
	plan, err := parseAgentMemoryCompactPlan("好的\n```json\n{\"rewrites\":[],\"merges\":[]}\n```\n")
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Rewrites) != 0 || len(plan.Merges) != 0 {
		t.Fatalf("空计划应可解析：%+v", plan)
	}
	if _, err := parseAgentMemoryCompactPlan("不是 JSON"); err == nil {
		t.Fatal("非 JSON 必须失败")
	}
}
