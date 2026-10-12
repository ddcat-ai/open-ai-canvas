package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// approvalPauseRoot 建立 Pi 模式的运行（root 任务不占活动任务位，模型步走 /model 桥）。
func approvalPauseRoot(t *testing.T) (*Service, *gorm.DB, *CloudAgentRun) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	s.legacyCloudAgentRootTask = false
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	return s, db, root
}

func TestCloudAgentPiSessionModelApprovalPause(t *testing.T) {
	for _, tc := range []struct {
		name           string
		invalidPurpose bool
	}{
		{"approval wait is a pause", false},
		{"unrelated model error remains a failure", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, root := approvalPauseRoot(t)
			run, state := agentInterjectionState(t, s, root.ID)
			approvalPauseStage(t, s, db, run, &state)
			before, _ := agentInterjectionState(t, s, root.ID)
			payload := approvalPauseModelPayload(t, []map[string]any{{"role": "user", "content": "继续"}})
			if tc.invalidPurpose {
				payload["purpose"] = json.RawMessage(`"invalid-purpose"`)
			}
			type callbackResult struct {
				status int
				paused bool
				err    error
			}
			callback := make(chan callbackResult, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request cloudAgentPiProcessRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					callback <- callbackResult{err: err}
					http.Error(w, "invalid fixture request", 500)
					return
				}
				raw, _ := json.Marshal(payload)
				req, _ := http.NewRequestWithContext(r.Context(), "POST", request.BridgeURL+"/model", strings.NewReader(string(raw)))
				req.Header.Set("Authorization", "Bearer "+request.BridgeToken)
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					callback <- callbackResult{err: err}
					http.Error(w, "fixture callback failed", 500)
					return
				}
				defer resp.Body.Close()
				var result map[string]any
				err = json.NewDecoder(resp.Body).Decode(&result)
				callback <- callbackResult{status: resp.StatusCode, paused: result["pause"] == true, err: err}
				w.Header().Set("Content-Type", "application/x-ndjson")
				if resp.StatusCode != 200 {
					_ = json.NewEncoder(w).Encode(map[string]any{"event": "runtime_error", "message": fmt.Sprint(result["error"])})
					return
				}
				_, _ = fmt.Fprintln(w, `{"event":"settled"}`)
			}))
			defer server.Close()
			t.Setenv("YINGCE_AGENT_URL", server.URL)
			t.Setenv("YINGCE_AGENT_TOKEN", strings.Repeat("t", 32))
			t.Setenv("YINGCE_AGENT_BRIDGE_HOST", "127.0.0.1")
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			err := s.runCloudAgentPiSession(ctx, "user", root.ID)
			select {
			case got := <-callback:
				if got.err != nil {
					t.Fatal(got.err)
				}
				if tc.invalidPurpose {
					if err == nil || got.status != 422 || got.paused {
						t.Fatalf("real model error was suppressed: err=%v callback=%+v", err, got)
					}
				} else if err != nil || got.status != 200 || !got.paused {
					t.Fatalf("approval became a runtime failure: err=%v callback=%+v", err, got)
				}
			default:
				t.Fatalf("runtime callback not reached: %v", err)
			}
			after, stateAfter := agentInterjectionState(t, s, root.ID)
			if after.Status != "waiting_approval" || stateAfter.Approval == nil || stateAfter.Approval.ID != "ap-1" || after.Revision != before.Revision || after.FailureMessage != "" {
				t.Fatalf("pending approval was changed: status=%s revision=%d failure=%q", after.Status, after.Revision, after.FailureMessage)
			}
			var steps int64
			if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", root.ID, cloudAgentStepOperation).Count(&steps).Error; err != nil {
				t.Fatal(err)
			}
			if steps != 0 {
				t.Fatalf("approval wait scheduled %d model tasks", steps)
			}
		})
	}
}

// approvalPauseStage 把运行摆进等待审批状态：挂起的工具调用与审批一一对应
// （检查点校验要求 Approval.Call 与 Calls[CallIndex] 一致）。
func approvalPauseStage(t *testing.T, s *Service, db *gorm.DB, run *model.CloudAgentExecution, state *cloudAgentRuntime) {
	t.Helper()
	call := cloudAgentCall{ID: "call-1"}
	call.Function.Name = "generate_media"
	call.Function.Arguments = "{}"
	run.Status = "waiting_approval"
	state.Calls = []cloudAgentCall{call}
	state.CallIndex = 0
	state.Approval = &cloudAgentApproval{ID: "ap-1", Call: call}
	if state.Decisions == nil {
		state.Decisions = map[string]string{}
	}
	approvalPauseSaveState(t, s, db, run, state)
}

// approvalPauseSaveState 用生产同款 CAS 路径落库改过的运行态（直接 db.Save 会把
// Transcript 关联行追加而不是替换，污染下一次 decode 的 canonical）。
func approvalPauseSaveState(t *testing.T, s *Service, db *gorm.DB, run *model.CloudAgentExecution, state *cloudAgentRuntime) {
	t.Helper()
	if err := s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		current.Status = run.Status
		return cloudAgentSave(current, state)
	}); err != nil {
		t.Fatal(err)
	}
}

// approvalPauseModelPayload 组装运行时风格的 /model 请求（conversation）。
func approvalPauseModelPayload(t *testing.T, messages []map[string]any) map[string]json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(messages)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]json.RawMessage{
		"modelId":       json.RawMessage(`"text-test"`),
		"purpose":       json.RawMessage(`"conversation"`),
		"messages":      encoded,
		"thinkingLevel": json.RawMessage(`"off"`),
	}
}

// 运行时在审批暂停后中止会话是异步的，可能抢在中止生效前再请求一步模型。
// 这一步不能入队：否则多计一次费，返回的新工具调用还会顶掉待审批的调用，
// 让整轮以「approval does not match current call」的检查点校验失败收场。
func TestCloudAgentPiModelStepRefusedWhileAwaitingApproval(t *testing.T) {
	s, db, root := approvalPauseRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	approvalPauseStage(t, s, db, run, &state)
	before, stateBefore := agentInterjectionState(t, s, root.ID)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	messages := []map[string]any{{"role": "user", "content": []any{map[string]any{"type": "text", "text": "继续"}}}}
	_, err := s.cloudAgentPiModel(ctx, "user", root.ID, approvalPauseModelPayload(t, messages))
	if !errors.Is(err, errCloudAgentAwaitingApproval) {
		t.Fatalf("model step during approval wait: err=%v, want errCloudAgentAwaitingApproval", err)
	}

	after, stateAfter := agentInterjectionState(t, s, root.ID)
	if after.Status != "waiting_approval" || stateAfter.Approval == nil || stateAfter.Approval.ID != stateBefore.Approval.ID {
		t.Fatalf("approval was disturbed: status=%s approval=%#v", after.Status, stateAfter.Approval)
	}
	if stateAfter.Step != stateBefore.Step || stateAfter.ActiveTaskID != "" || after.Revision != before.Revision {
		t.Fatalf("a model step was scheduled: step %d→%d activeTask=%q revision %d→%d", stateBefore.Step, stateAfter.Step, stateAfter.ActiveTaskID, before.Revision, after.Revision)
	}
	var steps int64
	if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", root.ID, cloudAgentStepOperation).Count(&steps).Error; err != nil {
		t.Fatal(err)
	}
	if steps != 0 {
		t.Fatalf("%d billable model step task(s) were created while awaiting approval", steps)
	}
}
