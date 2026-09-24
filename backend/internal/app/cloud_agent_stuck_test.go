package app

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestStuckCloudAgentIsTerminated(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	run, state := agentMediaRun(t, s, a, "request_approval", "stuck-idle")
	state.ActiveTaskID, state.MediaTaskID, state.StoryboardTaskID = "", "", ""
	// 事件日志是 append-only（已落库的行不能再改写），所以这里用"追加一条时间戳在十分钟前的
	// 新事件"表达"最后进展在十分钟前"，而不是回头改上一条已落库的事件。
	state.event(run.ID, "assistant_message", map[string]any{"text": "起个头"})
	state.Events[len(state.Events)-1].CreatedAt = time.Now().Add(-10 * time.Minute)
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !s.terminateStuckCloudAgent(run) {
		t.Fatal("长时间没有任何进展的运行应当被判定卡死")
	}
	after, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status == "running" || after.Status == "queued" {
		t.Fatalf("判定卡死后必须收尾，实际 status=%s", after.Status)
	}
	if after.FailureMessage == "" {
		t.Fatal("卡死收尾必须留下原因，否则用户只看到突然停了")
	}
}

func TestStuckDetectionLeavesActiveRunAlone(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	run, state := agentMediaRun(t, s, a, "request_approval", "stuck-fresh")
	state.ActiveTaskID, state.MediaTaskID, state.StoryboardTaskID = "", "", ""
	if len(state.Events) == 0 {
		state.event(run.ID, "assistant_message", map[string]any{"text": "起个头"})
	}
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	if s.terminateStuckCloudAgent(run) {
		t.Fatal("刚有进展的运行不该被判卡死")
	}
}

func TestStuckDetectionSkipsRunsWithLiveWork(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	run, state := agentMediaRun(t, s, a, "request_approval", "stuck-live")
	live := &model.Task{ID: "live-task", UserID: "user", ProjectID: "agent-canvas",
		Type: "canvas_text", Status: model.TaskStatusRunning, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(live).Error; err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = live.ID
	state.TaskIDs = append(state.TaskIDs, live.ID)
	// 同上：只能追加新事件，不能改写已有事件的时间戳。
	state.event(run.ID, "assistant_message", map[string]any{"text": "起个头"})
	state.Events[len(state.Events)-1].CreatedAt = time.Now().Add(-10 * time.Minute)
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	if s.terminateStuckCloudAgent(run) {
		t.Fatal("任务还在跑就不算卡死，不能误杀")
	}
}

func TestStuckDetectionTreatsTerminalTaskAsIdle(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	run, state := agentMediaRun(t, s, a, "request_approval", "stuck-dead")
	dead := &model.Task{ID: "dead-storyboard-task", UserID: "user", ProjectID: "agent-canvas",
		Type: "canvas_text", Status: model.TaskStatusFailed, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(dead).Error; err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID, state.MediaTaskID = "", ""
	state.StoryboardTaskID = dead.ID
	// 同上：只能追加新事件，不能改写已有事件的时间戳。
	state.event(run.ID, "assistant_message", map[string]any{"text": "起个头"})
	state.Events[len(state.Events)-1].CreatedAt = time.Now().Add(-10 * time.Minute)
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	if !s.terminateStuckCloudAgent(run) {
		t.Fatal("指向的任务已经终态时应当算没有在跑，兜底必须触发")
	}
}

func TestFailCloudAgentPersistsFailureMessage(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	run, state := agentMediaRun(t, s, a, "request_approval", "fail-message")
	run, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	const reason = "模型输入超过当前能力预算"
	if err := s.failCloudAgent(run, &state, reason); err != nil {
		t.Fatal(err)
	}
	after, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != "failed" {
		t.Fatalf("状态应为 failed，得到 %s", after.Status)
	}
	if after.FailureMessage != reason {
		t.Fatalf("失败原因必须落库，得到 %q", after.FailureMessage)
	}
	decoded, err := cloudAgentDecode(after)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, event := range decoded.Events {
		if event.Type == "run_failed" && stringValue(event.Payload["text"]) == reason {
			found = true
		}
	}
	if !found {
		t.Fatal("事件里的 run_failed 也要保留原因")
	}
}
