package app

// Regression contracts for recovery, bounded scheduling and safe submission.
import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func reliableAgentRoot(t *testing.T) (*Service, *gorm.DB, *CloudAgentRun) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	return s, db, root
}

func TestCloudAgentReliabilitySchedulerHeadOfLine500(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	now := time.Now().Add(-time.Hour)
	var tailID, tailUser string
	profile := cloudAgentProfileSnapshot{Revision: agentProfileRevision(nil), Hash: agentProfileHash("")}
	_, policy, err := compileCloudAgentPolicies(agentTestRequest(), nil, "", profile)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 500; i++ {
		user := fmt.Sprintf("audit-user-%03d", i)
		req := agentTestRequest()
		req.IdempotencyKey = fmt.Sprintf("audit-key-%03d", i)
		id := cloudAgentID(user, req.IdempotencyKey)
		status := model.TaskStatusSucceeded
		if i < 50 {
			status = model.TaskStatusRunning
		}
		ts := now.Add(time.Duration(i) * time.Millisecond)
		task := model.Task{ID: id, UserID: user, ProjectID: req.CanvasID, Operation: cloudAgentOperation, Status: status, ResultJSON: `{"text":"ready"}`, CreatedAt: ts, UpdatedAt: ts}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		state := cloudAgentRuntime{Request: req, Policy: policy, Profile: profile, ActiveTaskID: id, TaskIDs: []string{id}, Step: 1, Decisions: map[string]string{}, Events: []CloudAgentEvent{}}
		run := model.CloudAgentExecution{ID: id, UserID: user, Status: "running", Revision: 1, CreatedAt: ts, UpdatedAt: ts}
		if err := cloudAgentSave(&run, &state); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
		tailID, tailUser = id, user
	}
	started := time.Now()
	for i := 0; i < 20; i++ {
		s.advanceCloudAgents()
	}
	var completed int64
	if err := db.Model(&model.CloudAgentExecution{}).Where("status = ?", "completed").Count(&completed).Error; err != nil {
		t.Fatal(err)
	}
	t.Logf("500 runs, first 50 waiting, 450 ready: completed after 20 scheduler passes=%d; elapsed=%s (not a capacity benchmark)", completed, time.Since(started))
	if completed != 450 {
		t.Fatalf("ready runs starved: %d/450 completed", completed)
	}
	tail, err := s.repo.CloudAgent(tailUser, tailID)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.advanceCloudAgent(tail); err != nil {
		t.Fatal(err)
	}
	tail, err = s.repo.CloudAgent(tailUser, tailID)
	if err != nil {
		t.Fatal(err)
	}
	if tail.Status != "completed" {
		t.Fatalf("tail should be ready independently, got %s", tail.Status)
	}
}

func TestCloudAgentReliabilityLargeJournalDoesNotOverflowCheckpoint(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		state.event(root.ID, "tool_completed", map[string]any{"text": strings.Repeat("x", 120000)})
	}
	if err = s.repo.MutateCloudAgent("user", root.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	result, _ := json.Marshal(map[string]string{"text": strings.Repeat("a", 31900)})
	if err = db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(result)}).Error; err != nil {
		t.Fatal(err)
	}
	run, err = s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.advanceCloudAgent(run); err != nil {
		t.Fatal(err)
	}
	run, err = s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("large journal is external to checkpoint: run=%s revision=%d checkpointBytes=%d events=%d", run.Status, run.Revision, len(run.StateJSON), run.EventCount)
	if run.Status != "completed" || run.CleanupPending || run.FailureMessage != "" || len(run.StateJSON) >= 512<<10 || run.EventCount < 4 {
		t.Fatalf("large journal should not overflow the bounded checkpoint: %+v", run)
	}
}

func TestCloudAgentCheckpointMigratesLegacyStateToJournalAndTranscript(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.TextHistory = append(state.TextHistory, providerTextMessage{Role: "user", Content: "legacy history"})
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": "legacy canonical"})
	state.event(root.ID, "legacy_event", map[string]any{"ok": true})
	legacyJSON, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if err = db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("run_id = ?", root.ID).Delete(&model.CloudAgentEventRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where("run_id = ?", root.ID).Delete(&model.CloudAgentMessageRecord{}).Error; err != nil {
			return err
		}
		return tx.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Updates(map[string]any{
			"checkpoint_version": 0,
			"event_count":        0,
			"message_count":      0,
			"state_json":         string(legacyJSON),
		}).Error
	}); err != nil {
		t.Fatal(err)
	}

	legacyRun, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.repo.MutateCloudAgent("user", root.ID, legacyRun.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		decoded, decodeErr := cloudAgentDecode(current)
		if decodeErr != nil {
			return decodeErr
		}
		decoded.event(root.ID, "migrated_event", map[string]any{"ok": true})
		return cloudAgentSave(current, &decoded)
	}); err != nil {
		t.Fatal(err)
	}

	migrated, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := cloudAgentDecode(migrated)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.CheckpointVersion != 2 || migrated.EventCount != len(decoded.Events) || migrated.MessageCount != len(decoded.Canonical.Messages)+len(decoded.TextHistory) || len(decoded.Events) < 2 {
		t.Fatalf("legacy checkpoint was not migrated atomically: run=%+v state=%+v", migrated, decoded)
	}
	var checkpoint map[string]any
	if err = json.Unmarshal([]byte(migrated.StateJSON), &checkpoint); err != nil {
		t.Fatal(err)
	}
	canonical, _ := checkpoint["canonical"].(map[string]any)
	if checkpoint["events"] != nil || checkpoint["textHistory"] != nil || canonical["messages"] != nil {
		t.Fatalf("large journal or transcript leaked back into StateJSON: %s", migrated.StateJSON)
	}
}

func TestCloudAgentJournalIsAppendOnlyAndTranscriptCanCompact(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.TextHistory = append(state.TextHistory,
		providerTextMessage{Role: "user", Content: "one"},
		providerTextMessage{Role: "assistant", Content: "two"},
	)
	state.event(root.ID, "durable_event", map[string]any{"value": 1})
	if err = s.repo.MutateCloudAgent("user", root.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}

	run, err = s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	revision := run.Revision
	state, err = cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.Events[0].Type = "rewritten"
	if err = s.repo.MutateCloudAgent("user", root.ID, revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err == nil || !strings.Contains(err.Error(), "append-only") {
		t.Fatalf("existing journal entry was rewritten: %v", err)
	}
	rolledBack, err := s.repo.CloudAgent("user", root.ID)
	if err != nil || rolledBack.Revision != revision {
		t.Fatalf("failed journal mutation did not roll back: run=%+v err=%v", rolledBack, err)
	}

	state, err = cloudAgentDecode(rolledBack)
	if err != nil {
		t.Fatal(err)
	}
	state.TextHistory = state.TextHistory[:1]
	if err = s.repo.MutateCloudAgent("user", root.ID, rolledBack.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	var historyRows int64
	if err = db.Model(&model.CloudAgentMessageRecord{}).Where("run_id = ? AND kind = ?", root.ID, "history").Count(&historyRows).Error; err != nil {
		t.Fatal(err)
	}
	if historyRows != 1 {
		t.Fatalf("compacted transcript retained stale rows: %d", historyRows)
	}
}

func TestCloudAgentDecodeRejectsCorruptEventIdentity(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.event(root.ID, "durable_event", map[string]any{"value": 1})
	if err = s.repo.MutateCloudAgent("user", root.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&model.CloudAgentEventRecord{}).Where("run_id = ? AND sequence = ?", root.ID, 1).Update("event_json", `{"eventId":"wrong:1","runId":"wrong","seq":1,"type":"durable_event","payload":{}}`).Error; err != nil {
		t.Fatal(err)
	}
	corrupt, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = cloudAgentDecode(corrupt); err == nil || !strings.Contains(err.Error(), "event identity") {
		t.Fatalf("corrupt event identity was accepted: %v", err)
	}
}

func TestCloudAgentReliabilityCancelReplayInterrupted(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	// Simulate process/request interruption after cancelled checkpoint commits, before child cancellation.
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Update("status", "cancelled").Error; err != nil {
		t.Fatal(err)
	}
	if err := s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
		t.Fatal(err)
	}
	task, err := s.repo.TaskForUser("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("cancel replay returned success; active child status remains=%s", task.Status)
	if task.Status != model.TaskStatusCancelled {
		t.Fatalf("child not cancelled: %s", task.Status)
	}
}

func TestCloudAgentReliabilityFailedContinuation(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "mock failure"}).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.Prompt = "继续刚才的任务"
	req.IdempotencyKey = "audit-continuation-key"
	child, err := s.CreateCloudAgentRun("user", req, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.repo.TaskForUser("user", child.ID)
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		TextHistory []providerTextMessage `json:"textHistory"`
	}
	if err = json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	t.Logf("failed first turn -> continue: inherited history messages=%d", len(input.TextHistory))
	if len(input.TextHistory) != 3 ||
		input.TextHistory[0].Content != agentTestRequest().Prompt ||
		input.TextHistory[1].Role != "assistant" ||
		input.TextHistory[2].Role != "user" ||
		!strings.Contains(input.TextHistory[2].Content, "failed") {
		t.Fatalf("continuation lost facts: %+v", input.TextHistory)
	}
}

func TestCloudAgentReliabilityIdleSnapshotReadCost(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	snapshot, err := s.CloudAgentRun("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	queries := 0
	if err = db.Callback().Query().After("gorm:query").Register("reliability:count_queries", func(tx *gorm.DB) {
		queries++
		if strings.Contains(tx.Statement.SQL.String(), "SELECT *") {
			t.Error("idle stream loaded full row")
		}
	}); err != nil {
		t.Fatal(err)
	}
	defer db.Callback().Query().Remove("reliability:count_queries")
	unchanged, err := s.CloudAgentRunIfChanged("user", root.ID, snapshot.Revision)
	if err != nil || unchanged != nil || queries != 1 {
		t.Fatalf("idle read should be one small query: queries=%d run=%v err=%v", queries, unchanged, err)
	}
	if _, err = s.CloudAgentRunIfChanged("another-user", root.ID, snapshot.Revision); err == nil {
		t.Fatal("cross-user stream allowed")
	}
}

func TestCloudAgentReliabilityDirectChannelDispatchGuard(t *testing.T) {
	s, _, root := reliableAgentRoot(t)
	task, err := s.repo.TaskForUser("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	task.Attempts = 1
	attempt, err := s.beginTaskRouteAttempt(task)
	if err != nil || attempt == nil {
		t.Fatalf("missing attempt %v", err)
	}
	stale := *attempt
	if err = s.markRouteAttemptDispatching(attempt); err != nil {
		t.Fatal(err)
	}
	if err = s.markRouteAttemptDispatching(&stale); !isRouteDispatchUncertain(err) {
		t.Fatalf("stale dispatch allowed: %v", err)
	}
	task.Attempts = 2
	if _, err = s.beginTaskRouteAttempt(task); !isRouteDispatchUncertain(err) {
		t.Fatalf("ambiguous retry allowed: %v", err)
	}
	task.ProviderRequestID = "provider-original"
	recovered, err := s.beginTaskRouteAttempt(task)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.ID != attempt.ID || recovered.DispatchState != "accepted" {
		t.Fatalf("did not recover original attempt: %+v", recovered)
	}
	ctx1 := withProviderSubmissionKey(context.Background(), attempt)
	ctx2 := withProviderSubmissionKey(context.Background(), recovered)
	if ctx1.Value(providerSubmissionKeyContext{}) != ctx2.Value(providerSubmissionKeyContext{}) {
		t.Fatal("recovery changed upstream key")
	}
}

func TestCloudAgentReliabilityPendingCancellationRecoveredByScheduler(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Updates(map[string]any{"status": "cancelled", "cleanup_pending": true}).Error; err != nil {
		t.Fatal(err)
	}
	s.advanceCloudAgents()
	task, err := s.repo.TaskForUser("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if task.Status != model.TaskStatusCancelled || run.CleanupPending {
		t.Fatalf("cancellation not recovered: task=%s pending=%v", task.Status, run.CleanupPending)
	}
	if err = s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
		t.Fatal(err)
	}
}

func TestCloudAgentReliabilityCorruptedCancellationUsesControlTask(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	child := model.Task{ID: "cleanup-child", UserID: "user", Status: model.TaskStatusQueued, Operation: "cloud_agent_step"}
	if err := db.Create(&child).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Updates(map[string]any{"state_json": "broken", "active_task_id": child.ID}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
		t.Fatal(err)
	}
	got, err := s.repo.TaskForUser("user", child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != model.TaskStatusCancelled {
		t.Fatal("corrupted state orphaned active child")
	}
}
