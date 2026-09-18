package app

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestAgentMemoryCompactMergesAndRewritesOwnedLessons(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	first, err := s.CreateUserAgentMemory("user-a", AgentMemoryRequest{
		Topic: "video.duration-a", Category: "video", Situation: "竖屏视频时长参数",
		Lesson: "用模型目录返回的时长，不要猜秒数",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateUserAgentMemory("user-a", AgentMemoryRequest{
		Topic: "video.duration-b", Category: "video", Situation: "同样是竖屏视频时长",
		Lesson: "时长只能用来自目录的合法值",
	})
	if err != nil {
		t.Fatal(err)
	}
	rewrite, err := s.CreateUserAgentMemory("user-a", AgentMemoryRequest{
		Topic: "canvas.snapshot", Category: "canvas", Situation: "连续写画布时报快照过期",
		Lesson: "写成功后要用返回的新 snapshotHash 再写下一次",
	})
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateUserAgentMemory("user-b", AgentMemoryRequest{
		Topic: "video.duration-other", Category: "video", Situation: "别人的竖屏视频时长",
		Lesson: "别人的记忆不能被合并进来",
	})
	if err != nil {
		t.Fatal(err)
	}

	summary, err := s.applyAgentMemoryCompactPlan("user-a", agentMemoryCompactPlan{
		Merges: []agentMemoryCompactMerge{{
			IDs: []string{first.ID, second.ID, other.ID}, Topic: "video.duration", Category: "video",
			Situation: "竖屏视频生成", Lesson: "只用模型目录返回的时长", Source: "compact",
		}},
		Rewrites: []agentMemoryCompactRewrite{{
			ID: rewrite.ID, Topic: "canvas.snapshot-hash", Category: "canvas",
			Situation: "连续写画布", Lesson: "每次写成功后用返回的新快照哈希", Source: "compact",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Merged != 0 || summary.Rewritten != 1 || summary.Removed != 0 || summary.Skipped != 1 {
		t.Fatalf("含他人 id 的 merge 必须整组跳过，rewrite 仍可应用：%+v", summary)
	}

	summary, err = s.applyAgentMemoryCompactPlan("user-a", agentMemoryCompactPlan{
		Merges: []agentMemoryCompactMerge{{
			IDs: []string{first.ID, second.ID}, Topic: "video.duration", Category: "video",
			Situation: "竖屏视频生成", Lesson: "只用模型目录返回的时长", Source: "compact",
		}},
		Rewrites: []agentMemoryCompactRewrite{{
			ID: rewrite.ID, Topic: "canvas.snapshot-hash", Category: "canvas",
			Situation: "连续写画布", Lesson: "每次写成功后用返回的新快照哈希", Source: "compact",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if summary.Merged != 1 || summary.Rewritten != 1 || summary.Removed != 1 {
		t.Fatalf("应合并一条、改写一条、删除一条：%+v", summary)
	}

	owned, err := s.repo.ApprovedAgentLessons("user-a", 10)
	if err != nil || len(owned) != 2 {
		t.Fatalf("压缩后本人应剩 2 条：%+v（%v）", owned, err)
	}
	byID := map[string]model.AgentLesson{}
	for _, lesson := range owned {
		byID[lesson.ID] = lesson
	}
	if _, ok := byID[second.ID]; ok {
		t.Fatalf("被合并的源记忆应删除：%+v", owned)
	}
	keep := byID[first.ID]
	if keep.Topic != "video.duration" || keep.Lesson != "只用模型目录返回的时长" {
		t.Fatalf("合并应写回保留的第一条：%+v", keep)
	}
	rewritten := byID[rewrite.ID]
	if rewritten.Topic != "canvas.snapshot-hash" || rewritten.Lesson != "每次写成功后用返回的新快照哈希" {
		t.Fatalf("改写应更新原文：%+v", rewritten)
	}

	others, err := s.repo.ApprovedAgentLessons("user-b", 10)
	if err != nil || len(others) != 1 || others[0].ID != other.ID {
		t.Fatalf("别人的记忆必须原样保留：%+v（%v）", others, err)
	}
}

func TestNoteAgentMemoryCompactTaskRequiresMatchingTask(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	first, err := s.CreateUserAgentMemory("user-a", AgentMemoryRequest{
		Topic: "canvas.write-a", Category: "canvas", Situation: "写画布前先读状态",
		Lesson: "先读后写，避免快照过期",
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateUserAgentMemory("user-a", AgentMemoryRequest{
		Topic: "canvas.write-b", Category: "canvas", Situation: "写画布前先核对快照",
		Lesson: "每次写之前都再读一次",
	})
	if err != nil {
		t.Fatal(err)
	}
	setting, err := s.ensureAgentMemorySetting("user-a")
	if err != nil {
		t.Fatal(err)
	}
	setting.CompactTaskID = "task-real"
	setting.LastStatus = model.AgentMemoryCompactStatusQueued
	if err := s.repo.SaveAgentMemorySetting(setting); err != nil {
		t.Fatal(err)
	}

	planText := `{"merges":[{"ids":["` + first.ID + `","` + second.ID + `"],"topic":"canvas.write","category":"canvas","situation":"写画布","lesson":"先读后写","source":"compact"}],"rewrites":[]}`
	s.noteAgentMemoryCompactTask(model.Task{
		ID: "task-other", UserID: "user-a", Operation: cloudAgentMemoryCompactOp,
	}, map[string]any{"text": planText}, nil)

	owned, err := s.repo.ApprovedAgentLessons("user-a", 10)
	if err != nil || len(owned) != 2 {
		t.Fatalf("任务 ID 对不上时不得应用压缩：%+v（%v）", owned, err)
	}

	s.noteAgentMemoryCompactTask(model.Task{
		ID: "task-real", UserID: "user-a", Operation: cloudAgentMemoryCompactOp,
	}, map[string]any{"text": "```json\n" + planText + "\n```"}, nil)
	owned, err = s.repo.ApprovedAgentLessons("user-a", 10)
	if err != nil || len(owned) != 1 || owned[0].ID != first.ID {
		t.Fatalf("匹配任务成功后应合并：%+v（%v）", owned, err)
	}
	updated, err := s.repo.AgentMemorySetting("user-a")
	if err != nil || updated.LastStatus != model.AgentMemoryCompactStatusSucceeded || updated.LastSummaryJSON == "" {
		t.Fatalf("成功后应记下状态：%+v（%v）", updated, err)
	}
}

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
