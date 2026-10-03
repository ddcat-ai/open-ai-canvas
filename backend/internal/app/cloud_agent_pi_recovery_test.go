package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
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

func TestCloudAgentPiContinuationRequiresFreshAssistantResponse(t *testing.T) {
	s, _, a := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, a, "auto")
	setResponses := func(count int) {
		t.Helper()
		current, err := s.repo.CloudAgent("user", run.ID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := cloudAgentDecode(current)
		if err != nil {
			t.Fatal(err)
		}
		state.PiAssistantResponses = count
		if err := s.repo.MutateCloudAgent("user", run.ID, current.Revision, func(row *model.CloudAgentExecution, _ *repository.Repository) error {
			return cloudAgentSave(row, &state)
		}); err != nil {
			t.Fatal(err)
		}
	}
	setResponses(1)
	if err := s.completeCloudAgentPiRun("user", run.ID, 1); err == nil {
		t.Fatal("old assistant response completed a new turn")
	}
	current, err := s.repo.CloudAgent("user", run.ID)
	if err != nil || current.Status == "completed" {
		t.Fatalf("continuation state=%#v err=%v", current, err)
	}
	setResponses(2)
	if err := s.completeCloudAgentPiRun("user", run.ID, 1); err != nil {
		t.Fatal(err)
	}
	current, err = s.repo.CloudAgent("user", run.ID)
	if err != nil || current.Status != "completed" {
		t.Fatalf("fresh response state=%#v err=%v", current, err)
	}
}

func TestCloudAgentPiSessionRejectsEmptyContinuation(t *testing.T) {
	for _, fresh := range []bool{false, true} {
		t.Run(map[bool]string{false: "old-response-only", true: "fresh-response"}[fresh], func(t *testing.T) {
			s, _, a := agentMediaFixture(t)
			run, state := agentMediaRun(t, s, a, "auto")
			state.PiAssistantResponses = 1
			state.Calls = nil
			if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(row *model.CloudAgentExecution, _ *repository.Repository) error {
				row.Status = "running"
				return cloudAgentSave(row, &state)
			}); err != nil {
				t.Fatal(err)
			}
			// 只替换进程输出，仍经过真实会话入口、Node启动、HTTP事件桥和收尾事务。
			script := `let input = ""; for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
`
			if fresh {
				script += `const result = await fetch(request.bridgeURL + "/event", {method: "POST", headers: {"authorization": "Bearer " + request.bridgeToken, "content-type": "application/json"}, body: JSON.stringify({type: "message_end", role: "assistant"})});
if (!result.ok) throw new Error("event rejected");
`
			}
			script += `process.stdout.write('{"event":"settled"}\n');`
			directory := t.TempDir()
			if err := os.WriteFile(filepath.Join(directory, "agent-runtime.mjs"), []byte(script), 0600); err != nil {
				t.Fatal(err)
			}
			t.Setenv("CANVAS_PI_RUNTIME_DIR", directory)
			t.Setenv("YINGCE_AGENT_URL", "")
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			err := s.runCloudAgentPiSession(ctx, "user", run.ID)
			if fresh && err != nil {
				t.Fatal(err)
			}
			if !fresh && (err == nil || !strings.Contains(err.Error(), "no new assistant response")) {
				t.Fatalf("old response incorrectly completed continuation: %v", err)
			}
			stored, err := s.repo.CloudAgent("user", run.ID)
			if err != nil || (stored.Status == "completed") != fresh {
				t.Fatalf("session status=%#v err=%v", stored, err)
			}
		})
	}
}
