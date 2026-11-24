package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestBrowserAgentPreparedMutationMergesOnlyLeaseRenewals(t *testing.T) {
	for _, change := range []string{"renew", "owner", "epoch", "executor", "pending", "attempts", "cancel", "approval", "canonical", "lease_shortened"} {
		t.Run(change, func(t *testing.T) {
			s, root, _ := browserTestRoot(t)
			if err := s.mutateBrowserAgent("user", root.ID, func(_ *model.CloudAgentExecution, state *cloudAgentRuntime) error {
				state.Browser.Owner = "browser-one"
				state.Browser.Epoch = 1
				state.Browser.LeaseUntil = time.Now().Add(time.Minute)
				state.Browser.Pending = &browserAgentStep{ID: "step", Kind: "model", Executor: "executor-one", ExecuteUntil: time.Now().Add(time.Minute)}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			before, prepared := agentInterjectionState(t, s, root.ID)
			// Deterministically simulate heartbeat/business writes during preparation.
			if err := s.mutateBrowserAgent("user", root.ID, func(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
				state.Browser.LeaseUntil = state.Browser.LeaseUntil.Add(time.Minute)
				state.Browser.Pending.ExecuteUntil = state.Browser.Pending.ExecuteUntil.Add(time.Minute)
				switch change {
				case "owner":
					state.Browser.Owner = "browser-two"
				case "epoch":
					state.Browser.Epoch++
				case "executor":
					state.Browser.Pending.Executor = "executor-two"
				case "pending":
					state.Browser.Pending.ID = "other-step"
				case "attempts":
					state.Browser.Pending.Attempts++
				case "cancel":
					run.Status = "cancelled"
				case "approval":
					run.Status = "waiting_approval"
				case "canonical":
					state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "user", "content": "new instruction"})
				case "lease_shortened":
					state.Browser.LeaseUntil = time.Now()
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			latest, latestState := agentInterjectionState(t, s, root.ID)
			called := false
			err := s.mutatePreparedCloudAgent(before, &prepared, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				called = true
				prepared.event(root.ID, "prepared_write_committed", map[string]any{"text": "test"})
				return cloudAgentSave(current, &prepared)
			})
			if change != "renew" {
				if !errors.Is(err, repository.ErrCreationConflict) || called {
					t.Fatalf("incompatible mutation admitted: called=%v err=%v", called, err)
				}
				stored, _ := agentInterjectionState(t, s, root.ID)
				if stored.Revision != latest.Revision {
					t.Fatal("rejected mutation changed the run")
				}
				return
			}
			if err != nil || !called {
				t.Fatalf("heartbeat starved prepared write: %v", err)
			}
			stored, result := agentInterjectionState(t, s, root.ID)
			if stored.Revision != latest.Revision+1 || !result.Browser.LeaseUntil.Equal(latestState.Browser.LeaseUntil) || !result.Browser.Pending.ExecuteUntil.Equal(latestState.Browser.Pending.ExecuteUntil) {
				t.Fatal("prepared write lost renewed leases")
			}
			called = false
			if err := s.mutatePreparedCloudAgent(before, &prepared, func(*model.CloudAgentExecution, *repository.Repository) error { called = true; return nil }); !errors.Is(err, repository.ErrCreationConflict) || called {
				t.Fatalf("prepared snapshot was admitted twice: %v", err)
			}
		})
	}
}

func browserTestRoot(t *testing.T) (*Service, *CloudAgentRun, *gorm.DB) {
	t.Helper()
	t.Setenv("CANVAS_BROWSER_AGENT_ENABLED", "true")
	s, db, _, _ := creationTestService(t)
	s = New(s.repo, s.dataDir)
	s.disablePiRuntime = true
	t.Cleanup(func() { _ = s.Close() })
	s.legacyCloudAgentRootTask = false
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.ExecutionMode = "browser"
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	return s, run, db
}

func TestBrowserAgentClaimFenceAndPausedStates(t *testing.T) {
	s, root, _ := browserTestRoot(t)
	input := BrowserAgentControl{ProtocolVersion: 1, Owner: "browser-one"}
	view, err := s.ClaimBrowserAgent("user", root.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	input.Epoch = view.Epoch
	if _, err = s.ClaimBrowserAgent("user", root.ID, BrowserAgentControl{ProtocolVersion: 1, Owner: "browser-two"}); err == nil {
		t.Fatal("two owners claimed live lease")
	}
	if _, err = s.ClaimBrowserAgent("other-user", root.ID, input); err == nil {
		t.Fatal("foreign run claim allowed")
	}
	if _, err = s.ClaimBrowserAgent("user", root.ID, BrowserAgentControl{ProtocolVersion: 99, Owner: input.Owner}); err == nil {
		t.Fatal("unsupported version accepted")
	}
	if err = s.mutateBrowserAgent("user", root.ID, func(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
		run.Status = "waiting_user"
		state.Browser.LeaseUntil = time.Now().Add(-time.Minute)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	view, err = s.BrowserAgentState("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Status != "waiting_user" || view.Connection != "disconnected" || view.NextAction.Kind != "wait_user" {
		t.Fatalf("lost business status: %+v", view)
	}
	if _, err = s.HeartbeatBrowserAgent("user", root.ID, input); err == nil {
		t.Fatal("expired lease renewed")
	}
	view, err = s.ClaimBrowserAgent("user", root.ID, BrowserAgentControl{ProtocolVersion: 1, Owner: "browser-two"})
	if err != nil {
		t.Fatal(err)
	}
	if view.Epoch <= input.Epoch {
		t.Fatal("takeover did not advance epoch")
	}
	input.StepID = root.ID + ":browser:0"
	if _, err = s.SubmitBrowserAgentStep("user", root.ID, input); err == nil {
		t.Fatal("old epoch authorized a step")
	}
	if err = s.mutateBrowserAgent("user", root.ID, func(run *model.CloudAgentExecution, _ *cloudAgentRuntime) error {
		run.Status = "waiting_approval"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	view, err = s.BrowserAgentState("user", root.ID)
	if err != nil || view.NextAction.Kind != "wait_approval" {
		t.Fatalf("approval gate lost: %+v %v", view, err)
	}
	if err = s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
		t.Fatal(err)
	}
	view, err = s.BrowserAgentState("user", root.ID)
	if err != nil || view.NextAction.Kind != "done" {
		t.Fatalf("cancel gate lost: %+v %v", view, err)
	}
}

func TestBrowserAgentFeatureSwitchAndCoexistence(t *testing.T) {
	s, root, _ := browserTestRoot(t)
	t.Setenv("CANVAS_BROWSER_AGENT_ENABLED", "false")
	input := BrowserAgentControl{ProtocolVersion: 1, Owner: "browser-one"}
	if _, err := s.ClaimBrowserAgent("user", root.ID, input); err != nil {
		t.Fatalf("switch interrupted existing run: %v", err)
	}
	retry := agentTestRequest()
	retry.ExecutionMode = "server"
	replayed, replayErr := s.CreateCloudAgentRun("user", retry, "")
	if replayErr != nil || replayed.ID != root.ID || replayed.ExecutionMode != "browser" {
		t.Fatalf("policy change broke idempotent admission: %+v %v", replayed, replayErr)
	}
	req := agentTestRequest()
	req.ExecutionMode = "browser"
	req.IdempotencyKey = "disabled-browser-new"
	if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
		t.Fatal("disabled browser admission allowed")
	}
	req.ExecutionMode = "server"
	req.IdempotencyKey = "coexisting-server-new"
	req.CanvasID = ""
	req.ContextScope = nil
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	if run.ExecutionMode != "server" {
		t.Fatalf("server route changed: %+v", run)
	}
	if _, err = s.ClaimBrowserAgent("user", run.ID, input); err == nil {
		t.Fatal("server run claimed by browser")
	}
}

func TestBrowserAgentDurableToolRoundTripAndLostAck(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, root, db := browserTestRoot(t)
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "application/json")
		if calls.Add(1) == 1 {
			tool := firstUpstreamToolName(body)
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"检查画布","tool_calls":[{"id":"call-1","type":"function","function":{"name":"` + tool + `","arguments":"{}"}},{"id":"call-2","type":"function","function":{"name":"` + tool + `","arguments":"{}"}}]}}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"画布已检查完毕"}}]}`))
	}))
	defer upstream.Close()
	// Reuse the real task dispatcher and billing with an isolated provider.
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		for {
			select {
			case <-stop:
				return
			default:
				_ = s.ProcessNextTask()
				time.Sleep(10 * time.Millisecond)
			}
		}
	}()
	defer func() { close(stop); <-workerDone }()
	input := BrowserAgentControl{ProtocolVersion: 1, Owner: "browser-one"}
	view, err := s.ClaimBrowserAgent("user", root.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	input.Epoch = view.Epoch
	firstStep := view.NextAction.StepID
	for i := 0; i < 4; i++ {
		view, err = s.BrowserAgentState("user", root.ID)
		if err != nil {
			t.Fatal(err)
		}
		if view.NextAction.Kind == "done" {
			break
		}
		if view.NextAction.StepID == "" {
			t.Fatalf("unexpected wait: %+v", view)
		}
		input.StepID = view.NextAction.StepID
		if _, err = s.SubmitBrowserAgentStep("user", root.ID, input); err != nil {
			t.Fatal(err)
		}
		if err = s.runCloudAgentPiSession(context.Background(), "user", root.ID); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			if calls.Load() != 1 {
				t.Fatal("model count wrong")
			}
			// The browser disappears: recovery may finish accepted work, never start the next step.
			if err = s.runCloudAgentPiSession(context.Background(), "user", root.ID); err != nil {
				t.Fatal(err)
			}
			if calls.Load() != 1 {
				t.Fatal("recovery started a new model step")
			}
			if _, err = s.SubmitBrowserAgentStep("user", root.ID, input); err != nil {
				t.Fatal(err)
			}
			view, _ = s.BrowserAgentState("user", root.ID)
			if view.NextAction.Kind != "tool" {
				t.Fatalf("lost tool batch after ACK replay: %+v", view)
			}
		}
	}
	view, err = s.BrowserAgentState("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if view.Status != "completed" || calls.Load() != 2 {
		t.Fatalf("status=%+v calls=%d", view, calls.Load())
	}
	input.StepID = firstStep
	if _, err = s.SubmitBrowserAgentStep("user", root.ID, input); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatal("lost ACK caused another billable request")
	}
}

func TestBrowserAgentMediaApprovalCrashRecovery(t *testing.T) {
	for _, approved := range []bool{false, true} {
		name := "waiting"
		if approved {
			name = "approved"
		}
		t.Run(name, func(t *testing.T) {
			s, db, args := agentMediaFixture(t)
			run, _ := agentMediaRun(t, s, args, "request_approval")
			original := agentMediaCall(args)
			stepID := run.ID + ":browser:0"
			if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				state, err := cloudAgentDecode(current)
				if err != nil {
					return err
				}
				state.Request.ExecutionMode = "browser"
				state.Browser = &browserAgentRuntime{Pending: &browserAgentStep{ID: stepID, Kind: "tool", Call: original, Executor: "before-crash", ExecuteUntil: time.Now().Add(time.Minute)}}
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			ctx := context.WithValue(context.Background(), browserExecutorKey{}, browserExecutor{stepID, "before-crash"})
			if _, err := s.executeCloudAgentRuntimeTool(ctx, "user", run.ID, original); err != nil {
				t.Fatal(err)
			}
			stored, state := agentInterjectionState(t, s, run.ID)
			if stored.Status != "waiting_approval" || state.Approval == nil || cloudAgentToolCallsEquivalent(original, state.Approval.Call) {
				t.Fatal("test must reach a durable approval with resolved tool arguments")
			}
			approvalID := state.Approval.ID
			// Simulate process loss after approval/decision commit and before pending cleanup.
			if err := s.mutateBrowserAgent("user", run.ID, func(current *model.CloudAgentExecution, state *cloudAgentRuntime) error {
				state.Browser.Pending.ExecuteUntil = time.Now().Add(-time.Minute)
				if approved {
					state.Approval.Decision = "approve"
					current.Status = "running"
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if err := s.runCloudAgentPiSession(context.Background(), "user", run.ID); err != nil {
				t.Fatal(err)
			}
			if approved {
				deadline := time.Now().Add(10 * time.Second)
				for {
					stored, state = agentInterjectionState(t, s, run.ID)
					if state.MediaTaskID != "" {
						break
					}
					if cloudAgentRunTerminal(stored.Status) || time.Now().After(deadline) {
						t.Fatalf("approved operation did not recover: status=%s failure=%s", stored.Status, stored.FailureMessage)
					}
					time.Sleep(20 * time.Millisecond)
				}
				// Repeated recovery must not submit the approved operation again.
				if err := s.runCloudAgentPiSession(context.Background(), "user", run.ID); err != nil {
					t.Fatal(err)
				}
			} else {
				stored, state = agentInterjectionState(t, s, run.ID)
				if stored.Status != "waiting_approval" || state.Approval == nil || state.Approval.ID != approvalID || state.Browser.Pending != nil || state.Browser.Sequence != 1 {
					t.Fatalf("approval was not preserved: status=%s browser=%+v", stored.Status, state.Browser)
				}
			}
			var tasks int64
			if err := db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks).Error; err != nil {
				t.Fatal(err)
			}
			want := int64(0)
			if approved {
				want = 1
			}
			if tasks != want {
				t.Fatalf("media submissions=%d want=%d", tasks, want)
			}
		})
	}
}

func TestBrowserAgentModelPreservesThinkingPolicy(t *testing.T) {
	for _, test := range []struct {
		mode     string
		forceOff bool
		want     string
	}{
		{"deep", false, "deep"},
		{"auto", false, "auto"},
		{"high", false, "high"},
		{"off", false, "off"},
		{"deep", true, "off"},
	} {
		t.Run(test.mode+"-"+test.want, func(t *testing.T) {
			s, root, _ := browserTestRoot(t)
			if err := s.mutateBrowserAgent("user", root.ID, func(_ *model.CloudAgentExecution, state *cloudAgentRuntime) error {
				state.Policy.ReasoningMode = test.mode
				state.ForceThinkingOff = test.forceOff
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			input := BrowserAgentControl{ProtocolVersion: 1, Owner: "thinking-browser"}
			view, err := s.ClaimBrowserAgent("user", root.ID, input)
			if err != nil {
				t.Fatal(err)
			}
			input.Epoch, input.StepID = view.Epoch, view.NextAction.StepID
			if _, err = s.SubmitBrowserAgentStep("user", root.ID, input); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() { done <- s.runCloudAgentPiSession(ctx, "user", root.ID) }()
			defer func() { cancel(); <-done }()
			deadline := time.Now().Add(10 * time.Second)
			for {
				_, state := agentInterjectionState(t, s, root.ID)
				if state.ActiveTaskID != "" {
					task, err := s.repo.Task(state.ActiveTaskID)
					if err != nil {
						t.Fatal(err)
					}
					var input canvasGenerationInput
					if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
						t.Fatal(err)
					}
					if input.TextOptions.ThinkingLevel != test.want {
						t.Fatalf("queued model thinking=%q want=%q", input.TextOptions.ThinkingLevel, test.want)
					}
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("model step was not queued")
				}
				time.Sleep(20 * time.Millisecond)
			}
		})
	}
}
