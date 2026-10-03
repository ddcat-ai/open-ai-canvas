package app

import (
	"context"
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/repository"
	"os/exec"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentPiWriteReplayDoesNotMutateAgain(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.PermissionMode = "auto"
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	args, _ := json.Marshal(map[string]any{"snapshotHash": cloudAgentCanvasHash(doc), "ops": []map[string]any{{"type": "add_node", "id": "receipt-note", "nodeType": "text", "title": "receipt", "content": "once", "x": 24, "y": 48}}})
	var call cloudAgentCall
	call.ID, call.Function.Name, call.Function.Arguments = "stable-write", "canvas_apply_ops", string(args)
	type replayResult struct {
		result any
		err    error
	}
	results := make(chan replayResult, 2)
	start := make(chan struct{})
	for i := 0; i < 2; i++ {
		go func() {
			<-start
			result, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call)
			results <- replayResult{result, err}
		}()
	}
	close(start)
	a, b := <-results, <-results
	if a.err != nil || b.err != nil || !reflect.DeepEqual(a.result, b.result) {
		t.Fatalf("concurrent replay: %#v %#v", a, b)
	}
	first := a.result
	if first.(map[string]any)["isError"] == true {
		t.Fatalf("first write failed: %#v", first)
	}
	stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	before := stored.PayloadJSON
	second, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("retry did not replay original receipt: first=%#v second=%#v", first, second)
	}
	// Compaction/session replacement must not erase the durable result.
	latest, _ := s.repo.CloudAgent("user", run.ID)
	if err := s.repo.MutateCloudAgent("user", run.ID, latest.Revision, func(row *model.CloudAgentExecution, _ *repository.Repository) error {
		state, err := cloudAgentDecode(row)
		if err != nil {
			return err
		}
		state.Canonical.Messages = nil
		state.Calls = nil
		state.CallIndex = 0
		return cloudAgentSave(row, &state)
	}); err != nil {
		t.Fatal(err)
	}
	replayed, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call)
	if err != nil || !reflect.DeepEqual(first, replayed) {
		t.Fatalf("compaction lost receipt: %v %#v", err, replayed)
	}
	stored, err = s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil || stored.PayloadJSON != before {
		t.Fatalf("retry changed canvas: %v", err)
	}
	var count int64
	if err := db.Model(&model.CloudAgentCanvasMutation{}).Where("run_id = ? AND step_id = ?", run.ID, call.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("write count=%d err=%v", count, err)
	}
	call.Function.Arguments = `{"ops":[]}`
	if _, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call); err == nil {
		t.Fatal("same call ID accepted different arguments")
	}
}

func TestCloudAgentReceiptFailureRollsBackEffect(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	latest, _ := s.repo.CloudAgent("user", run.ID)
	var call cloudAgentCall
	call.ID = "rollback"
	call.Function.Name = "canvas_apply_ops"
	call.Function.Arguments = `{}`
	if _, err := s.prepareCloudAgentWriteReceipt(latest, call); err != nil {
		t.Fatal(err)
	}
	latest, _ = s.repo.CloudAgent("user", run.ID)
	state, err := cloudAgentDecode(latest)
	if err != nil {
		t.Fatal(err)
	}
	err = s.mutateCloudAgentTool(latest, &state, func(_ *model.CloudAgentExecution, repo *repository.Repository) error {
		if err := repo.Create(&model.CloudAgentCanvasMutation{ID: "rolled-back", RunID: run.ID, StepID: call.ID}); err != nil {
			return err
		}
		state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "tool", "tool_call_id": call.ID, "content": strings.Repeat("x", repository.CloudAgentReceiptContentLimit+1)})
		return nil
	})
	if err == nil {
		t.Fatal("oversized receipt accepted")
	}
	var count int64
	db.Model(&model.CloudAgentCanvasMutation{}).Where("id = ?", "rolled-back").Count(&count)
	if count != 0 {
		t.Fatal("failed receipt committed effect")
	}
	receipt, err := s.repo.CloudAgentReceipt("user", run.ID, "tool", call.ID)
	if err != nil || receipt.Status != "pending" {
		t.Fatalf("receipt changed: %v", err)
	}
}

func TestCloudAgentUnknownModelSubmissionDoesNotRetry(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, a, "auto")
	task := model.Task{ID: "unknown-step", UserID: "user", AgentRunID: run.ID, Operation: cloudAgentStepOperation, Status: model.TaskStatusFailed, Error: "connection timeout"}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RouteAttempt{ID: "unknown-attempt", TaskID: task.ID, RouteRun: task.RouteRun, AttemptNumber: 1, DispatchState: "submission_unknown"}).Error; err != nil {
		t.Fatal(err)
	}
	if s.cloudAgentModelTaskRetryable(task.ID) {
		t.Fatal("unknown submission allowed automatic retry")
	}
}

func TestCloudAgentUnknownSubmissionOverridesTruncatedError(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, a, "auto")
	messages := []map[string]any{{"role": "user", "content": "same input"}}
	receipt, err := cloudAgentModelReceipt("user", run.ID, "unknown-step:0", messages, "")
	if err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "unknown-truncated", UserID: "user", AgentRunID: run.ID, Operation: cloudAgentStepOperation, Status: model.TaskStatusFailed, Error: "工具参数不是完整 JSON"}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RouteAttempt{ID: "unknown-truncated-attempt", TaskID: task.ID, RouteRun: task.RouteRun, AttemptNumber: 1, DispatchState: "submission_unknown"}).Error; err != nil {
		t.Fatal(err)
	}
	receipt.TaskID = task.ID
	if err := s.repo.SaveCloudAgentReceipt(receipt); err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), cloudAgentModelReceiptKey{}, receipt)
	_, retryable, err := s.runCloudAgentModelStep(ctx, "user", run.ID, messages, "")
	if err == nil || retryable {
		t.Fatalf("unknown submission retried from error text: retry=%v err=%v", retryable, err)
	}
	stored, err := s.repo.CloudAgentReceipt("user", run.ID, "model_step", receipt.OperationKey)
	if err != nil || stored.Status != "unknown" {
		t.Fatalf("unknown receipt not preserved: %#v %v", stored, err)
	}
}

func TestCloudAgentMediaReceiptReplaysAfterApprovalAndSettlement(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, args, "request_approval")
	state.Calls = nil
	state.CallIndex = 0
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(row *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(row, &state)
	}); err != nil {
		t.Fatal(err)
	}
	call := agentMediaCall(args)
	result, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call)
	if err != nil || result.(map[string]any)["pause"] != true {
		t.Fatalf("approval missing: %v %#v", err, result)
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	// Pause the local waiter to deterministically simulate restart after admission.
	s.closeApprovedCloudAgentMediaWaiters()
	stored, err := s.repo.CloudAgentReceipt("user", run.ID, "tool", call.ID)
	if err != nil || stored.TaskID == "" || stored.Status != "pending" {
		t.Fatalf("missing atomic admission receipt: %v %#v", err, stored)
	}
	var taskCount, orderCount int64
	db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", run.ID, "canvas_video").Count(&taskCount)
	db.Model(&model.BillingOrder{}).Where("task_id = ?", stored.TaskID).Count(&orderCount)
	if taskCount != 1 || orderCount != 1 {
		t.Fatalf("admission tasks=%d orders=%d", taskCount, orderCount)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", stored.TaskID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "synthetic terminal rejection"}).Error; err != nil {
		t.Fatal(err)
	}
	first, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call)
	if err != nil || !reflect.DeepEqual(first, second) {
		t.Fatalf("media replay differs: %v %#v", err, second)
	}
	db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", run.ID, "canvas_video").Count(&taskCount)
	db.Model(&model.BillingOrder{}).Where("task_id = ?", stored.TaskID).Count(&orderCount)
	if taskCount != 1 || orderCount != 1 {
		t.Fatalf("replay duplicated tasks=%d orders=%d", taskCount, orderCount)
	}
}

func TestCloudAgentStaleOwnerCannotUseBridgeOrFinish(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, a, "auto")
	old, err := s.repo.ClaimCloudAgentOwner("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.repo.ReleaseCloudAgentOwner("user", run.ID, old); err != nil {
		t.Fatal(err)
	}
	newOwner, err := s.repo.ClaimCloudAgentOwner("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(context.Background(), cloudAgentOwnerContextKey{}, old)
	before, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	modelPayload := map[string]json.RawMessage{"stepId": json.RawMessage(`"stale-step"`), "messages": json.RawMessage(`[{"role":"user","content":"test"}]`)}
	if _, err := s.cloudAgentPiModel(ctx, "user", run.ID, modelPayload); !errors.Is(err, repository.ErrCloudAgentOwnerLost) {
		t.Fatalf("stale model=%v", err)
	}
	toolPayload := map[string]json.RawMessage{"callId": json.RawMessage(`"stale-call"`), "name": json.RawMessage(`"canvas_apply_ops"`), "arguments": json.RawMessage(`{}`)}
	if _, err := s.cloudAgentPiTool(ctx, "user", run.ID, toolPayload); !errors.Is(err, repository.ErrCloudAgentOwnerLost) {
		t.Fatalf("stale tool=%v", err)
	}
	for _, kind := range []string{"message_start", "message_delta", "message_end", "session_snapshot", "error"} {
		raw, _ := json.Marshal(kind)
		payload := map[string]json.RawMessage{"type": raw, "role": json.RawMessage(`"assistant"`), "sessionJSONL": json.RawMessage(`"stale snapshot"`)}
		if _, err := s.cloudAgentPiEvent(ctx, "user", run.ID, payload); !errors.Is(err, repository.ErrCloudAgentOwnerLost) {
			t.Fatalf("stale %s=%v", kind, err)
		}
	}
	s.failPiRunner(run.ID, "user", errors.New("old failure"), old)
	_ = s.completeCloudAgentPiRun("user", run.ID, -1, old)
	after, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("stale owner changed execution")
	}
	var count int64
	db.Model(&model.CloudAgentReceipt{}).Where("run_id = ?", run.ID).Count(&count)
	if count != 0 {
		t.Fatal("stale owner created receipt")
	}
	if err := s.repo.RenewCloudAgentOwner("user", run.ID, newOwner); err != nil {
		t.Fatal(err)
	}
}

// A real Node process is interrupted after the Go model bridge commits its result,
// before it can record an assistant/session snapshot. The task result is synthetic.
func TestCloudAgentNativeCheckpointReplaysReleasedModel(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node unavailable")
	}
	s, db, a := agentMediaFixture(t)
	s.disablePiRuntime = true
	run, _ := agentMediaRun(t, s, a, "auto")
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for {
			select {
			case <-stop:
				return
			case <-time.After(10 * time.Millisecond):
				_ = db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ? AND status = ?", run.ID, cloudAgentStepOperation, model.TaskStatusQueued).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"durable native result"}`}).Error
			}
		}
	}()
	request := cloudAgentPiProcessRequest{RunId: run.ID, Prompt: "same prompt", SystemPrompt: "Return a short response.", Model: map[string]any{"id": "text-test", "contextWindow": 128000}}
	firstCtx, interrupt := context.WithCancel(ctx)
	defer interrupt()
	var mu sync.Mutex
	var steps []string
	bridge := cloudAgentPiBridge{
		Model: func(callCtx context.Context, payload map[string]json.RawMessage) (any, error) {
			var key string
			_ = json.Unmarshal(payload["stepId"], &key)
			mu.Lock()
			steps = append(steps, key)
			first := len(steps) == 1
			mu.Unlock()
			result, err := s.cloudAgentPiModel(callCtx, "user", run.ID, payload)
			if err == nil && first {
				interrupt()
			}
			return result, err
		},
		Tool: func(context.Context, map[string]json.RawMessage) (any, error) {
			return nil, errors.New("unexpected tool")
		},
		Event: func(callCtx context.Context, payload map[string]json.RawMessage) (any, error) {
			return s.cloudAgentPiEvent(callCtx, "user", run.ID, payload)
		},
	}
	if err := runCloudAgentPi(firstCtx, request, bridge); err == nil {
		t.Fatal("first process was not interrupted")
	}
	stored, err := s.repo.CloudAgentPiSession("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	request.SessionJSONL, request.ResumeFromCheckpoint = stored.SessionJSONL, true
	if err := runCloudAgentPi(ctx, request, bridge); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	observed := append([]string(nil), steps...)
	mu.Unlock()
	if len(observed) != 2 || observed[0] == "" || observed[0] != observed[1] {
		t.Fatalf("unstable native step: %v", observed)
	}
	var count int64
	db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", run.ID, cloudAgentStepOperation).Count(&count)
	if count != 1 {
		t.Fatalf("native recovery admitted %d tasks", count)
	}
	// A separate turn with identical text must receive a new identity.
	stored, err = s.repo.CloudAgentPiSession("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	request.SessionJSONL, request.ResumeFromCheckpoint, request.TurnID = stored.SessionJSONL, false, "second-turn"
	if err := runCloudAgentPi(ctx, request, bridge); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	observed = append([]string(nil), steps...)
	mu.Unlock()
	if len(observed) != 3 || observed[2] == observed[1] {
		t.Fatalf("different turns merged: %v", observed)
	}
	db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", run.ID, cloudAgentStepOperation).Count(&count)
	if count != 2 {
		t.Fatalf("new turn tasks=%d", count)
	}
}

func TestCloudAgentPiModelReplayAfterTaskReleased(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	s.disablePiRuntime = true
	run, _ := agentMediaRun(t, s, a, "auto")
	payload := map[string]json.RawMessage{"stepId": json.RawMessage(`"durable-step"`), "messages": json.RawMessage(`[{"role":"user","content":"same input"}]`)}
	type outcome struct {
		result any
		err    error
	}
	done := make(chan outcome, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	go func() { r, e := s.cloudAgentPiModel(ctx, "user", run.ID, payload); done <- outcome{r, e} }()
	var id string
	for i := 0; i < 150; i++ {
		latest, err := s.repo.CloudAgent("user", run.ID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := cloudAgentDecode(latest)
		if err != nil {
			t.Fatal(err)
		}
		id = state.ActiveTaskID
		if id != "" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if id == "" {
		t.Fatal("no task admitted")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", id).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"first result"}`}).Error; err != nil {
		t.Fatal(err)
	}
	first := <-done
	if first.err != nil {
		t.Fatal(first.err)
	}
	latest, _ := s.repo.CloudAgent("user", run.ID)
	state, err := cloudAgentDecode(latest)
	if err != nil || state.ActiveTaskID != "" {
		t.Fatalf("not released: %v", err)
	}
	replayCtx, replayCancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer replayCancel()
	second, err := s.cloudAgentPiModel(replayCtx, "user", run.ID, payload)
	if err != nil || !reflect.DeepEqual(first.result, second) {
		t.Fatalf("result was not replayed after ActiveTaskID cleared: %v %#v", err, second)
	}
	var count int64
	db.Model(&model.Task{}).Where("agent_run_id = ? AND operation = ?", run.ID, cloudAgentStepOperation).Count(&count)
	if count != 1 {
		t.Fatalf("recovery admitted %d tasks", count)
	}
}
