package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
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

func TestCloudAgentPiRecoversFailedStepUsingOriginalSubmissionFacts(t *testing.T) {
	for _, uncertain := range []bool{true, false} {
		name := "transient-retried"
		if uncertain {
			name = "submission-uncertain"
		}
		t.Run(name, func(t *testing.T) {
			s, db, runID := piOutputLimitFixture(t)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			firstCtx, interrupt := context.WithCancel(ctx)
			defer interrupt()
			done := make(chan error, 1)
			payload := map[string]json.RawMessage{"messages": json.RawMessage(`[{"role":"user","content":"你好"}]`)}
			call := func(callCtx context.Context) {
				_, err := s.cloudAgentPiModel(callCtx, "user", runID, payload)
				done <- err
			}
			go call(firstCtx)
			taskID := waitCloudAgentModelTask(t, ctx, s, runID, "", done)
			interrupt()
			<-done
			task, err := s.repo.TaskForUser("user", taskID)
			if err != nil {
				t.Fatal(err)
			}
			if uncertain {
				recordTaskDiagnostic(task, "preparation", "preparation_failed", "unknown", "reconcile_submission", routeDispatchUncertainError{"上一次提交结果不明确"})
			} else {
				recordTaskDiagnostic(task, "execution", "provider_execution_failed", "not_submitted", "correct_input", providerHTTPError{StatusCode: 429})
			}
			if err := db.Create(&model.ApiCallLog{ID: "orphan-call", UserID: "user", TaskID: taskID, Status: model.ApiCallStatusFailed, StatusCode: 429}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(task).Updates(map[string]any{"status": model.TaskStatusFailed, "execution_diagnostic_json": task.ExecutionDiagnosticJSON}).Error; err != nil {
				t.Fatal(err)
			}
			go call(ctx)
			wantTasks := int64(1)
			if uncertain {
				if err := <-done; agentModelErrorReason(err) != agentModelFailureSubmission {
					t.Fatalf("original failure not surfaced: %v", err)
				}
				run, state := agentInterjectionState(t, s, runID)
				last := state.Events[len(state.Events)-1]
				if run.Status != "failed" || !strings.Contains(run.FailureMessage, "任务中心") || !strings.Contains(run.FailureMessage, taskID) || last.Type != "run_failed" || last.Payload["reason"] != string(agentModelFailureSubmission) || last.Payload["taskId"] != taskID || last.Payload["text"] != run.FailureMessage {
					t.Fatalf("missing actionable terminal event: status=%s event=%v", run.Status, last)
				}
				if err := s.finishCloudAgentCleanup(ctx, run); err != nil {
					t.Fatal(err)
				}
				stored, err := s.repo.CloudAgent("user", runID)
				if err != nil || stored.Status != "failed" || stored.ActiveTaskID != "" || stored.CleanupPending {
					t.Fatalf("failed run did not settle: %+v %v", stored, err)
				}
			} else {
				wantTasks++
				retryID := waitCloudAgentModelTask(t, ctx, s, runID, taskID, done)
				if err := db.Model(&model.Task{}).Where("id = ?", retryID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"你好"}`}).Error; err != nil {
					t.Fatal(err)
				}
				if err := <-done; err != nil {
					t.Fatal(err)
				}
			}
			steps := db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", runID, cloudAgentStepOperation)
			var count, orders int64
			if err := steps.Count(&count).Error; err != nil || count != wantTasks {
				t.Fatalf("step count=%d want=%d err=%v", count, wantTasks, err)
			}
			if err := db.Model(&model.BillingOrder{}).Where("task_id IN (?)", steps.Select("id")).Count(&orders).Error; err != nil || orders != wantTasks {
				t.Fatalf("order count=%d want=%d err=%v", orders, wantTasks, err)
			}
		})
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
