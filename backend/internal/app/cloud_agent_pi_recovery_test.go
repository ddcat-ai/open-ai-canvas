package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

// 重启恢复：上一个运行时进程已为这一步建好模型任务、任务也已成功，但结果没交回。
// 新进程重新发起 /model 时必须直接接手这份结果，不能再建任务、再扣一次费。
func TestCloudAgentModelStepAdoptsOrphanedStepTask(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	s.disablePiRuntime = true
	run, _ := agentMediaRun(t, s, a, "auto")

	// 第一个进程：调度这一步，但还没等到结果就"崩溃"。
	ctx, cancel := context.WithCancel(context.Background())
	messages := []map[string]any{{"role": "user", "content": "继续"}}
	done := make(chan struct{})
	go func() {
		_, _, _ = s.runCloudAgentModelStep(ctx, "user", run.ID, messages, "off")
		close(done)
	}()
	var orphanID string
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && orphanID == "" {
		latest, err := s.repo.CloudAgent("user", run.ID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := cloudAgentDecode(latest)
		if err != nil {
			t.Fatal(err)
		}
		orphanID = state.ActiveTaskID
		time.Sleep(20 * time.Millisecond)
	}
	cancel()
	<-done
	if orphanID == "" {
		t.Fatal("first process never scheduled a model step")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", orphanID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"已完成"}`}).Error; err != nil {
		t.Fatal(err)
	}
	var before int64
	if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", run.ID, cloudAgentStepOperation).Count(&before).Error; err != nil {
		t.Fatal(err)
	}

	// 第二个进程：重新发起同一步。
	result, _, err := s.runCloudAgentModelStep(context.Background(), "user", run.ID, messages, "off")
	if err != nil {
		t.Fatal(err)
	}
	if text, _ := result.(map[string]any)["text"].(string); text != "已完成" {
		t.Fatalf("adopted result = %#v", result)
	}
	var after int64
	if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", run.ID, cloudAgentStepOperation).Count(&after).Error; err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("recovery created %d new step task(s); want the orphaned task to be adopted", after-before)
	}
	latest, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(latest)
	if err != nil {
		t.Fatal(err)
	}
	if state.ActiveTaskID != "" {
		t.Fatalf("adopted step was not released: active=%s", state.ActiveTaskID)
	}
}

func TestCloudAgentPiTurnSettled(t *testing.T) {
	header := `{"type":"session","id":"s"}`
	user := `{"type":"message","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}`
	done := `{"type":"message","message":{"role":"assistant","stopReason":"stop","content":[{"type":"text","text":"ok"}]}}`
	tool := `{"type":"message","message":{"role":"assistant","stopReason":"toolUse","content":[{"type":"toolCall","id":"c"}]}}`
	meta := `{"type":"thinking_level_change","thinkingLevel":"off"}`
	settled := &cloudAgentRuntime{PiAssistantResponses: 1}
	cases := []struct {
		name  string
		jsonl string
		state *cloudAgentRuntime
		want  bool
	}{
		{"final answer", strings.Join([]string{header, user, done, meta}, "\n") + "\n", settled, true},
		{"pending user prompt", strings.Join([]string{header, done, user}, "\n"), settled, false},
		{"tool call pending", strings.Join([]string{header, user, tool}, "\n"), settled, false},
		{"no response this run", strings.Join([]string{header, user, done}, "\n"), &cloudAgentRuntime{}, false},
		{"active task", strings.Join([]string{header, user, done}, "\n"), &cloudAgentRuntime{PiAssistantResponses: 1, ActiveTaskID: "t"}, false},
		{"empty", "", settled, false},
	}
	for _, tc := range cases {
		if got := cloudAgentPiTurnSettled(tc.jsonl, tc.state); got != tc.want {
			t.Errorf("%s: settled = %v, want %v", tc.name, got, tc.want)
		}
	}
}
