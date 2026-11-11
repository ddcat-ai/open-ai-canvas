package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCloudAgentDeletionRejectsPiActivityAndCleanup(t *testing.T) {
	for _, status := range []string{"reserved", "running", "waiting_approval", "waiting_user", "cancelled", "failed"} {
		t.Run(status, func(t *testing.T) {
			s, db, root := reliableAgentRoot(t)
			if err := db.Exec("UPDATE tasks SET status = ?, agent_execution_ready = ? WHERE id = ?", model.TaskStatusTextReplay, status != "reserved", root.ID).Error; err != nil {
				t.Fatal(err)
			}
			if status == "reserved" {
				if err := db.Delete(&model.CloudAgentExecution{}, "id = ?", root.ID).Error; err != nil {
					t.Fatal(err)
				}
			} else if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Updates(map[string]any{"status": status, "cleanup_pending": status == "cancelled" || status == "failed"}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.Project{ID: "domain-project", UserID: "user", Name: "Agent project"}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("project_id", "domain-project").Error; err != nil {
				t.Fatal(err)
			}
			for _, delete := range []func() error{
				func() error { return s.DeleteUserCanvasProject("user", "agent-canvas") },
				func() error { return s.DeleteProject("user", "domain-project") },
			} {
				err := delete()
				var appErr *AppError
				if !errors.As(err, &appErr) || appErr.Status != 409 || appErr.Reason != "canvas_agent_busy" {
					t.Fatalf("activity deletion not rejected: %v", err)
				}
			}
			canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
			if err != nil || canvas.ProjectID != "domain-project" {
				t.Fatalf("rejected deletion changed canvas: %+v %v", canvas, err)
			}
			task, err := s.repo.TaskForUser("user", root.ID)
			if err != nil || task.ProjectID != "agent-canvas" {
				t.Fatalf("rejected deletion changed frozen identity: %+v %v", task, err)
			}
			if err := s.DeleteUserCanvasProject("other-user", "agent-canvas"); err != nil {
				t.Fatalf("idempotent foreign delete: %v", err)
			}
			if _, err := s.repo.CanvasProjectForUser("user", "agent-canvas"); err != nil {
				t.Fatalf("foreign deletion removed canvas: %v", err)
			}
		})
	}
}

func TestCloudAgentCancelledCleanupResumesAndDeletedCanvasHistoryRemainsUsable(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	execution, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(execution)
	if err != nil {
		t.Fatal(err)
	}
	original := state.Request
	state.event(root.ID, "assistant_message", map[string]any{"text": "已读取原画布，不应重复收费生成"})
	state.event(root.ID, "generation_task_created", map[string]any{"taskId": "submitted-before-stop"})
	if err := s.repo.MutateCloudAgent("user", root.ID, execution.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}

	// A lost HTTP cancellation response leaves durable cleanup for the production
	// Pi recovery entry, without restarting a model or creating a second bill.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.CancelCloudAgent(ctx, "user", root.ID); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel interrupted after durable intent: %v", err)
	}
	pending, err := s.CloudAgentRun("user", root.ID)
	if err != nil || pending.Status != "cancelled" || !pending.CleanupPending {
		t.Fatalf("cancellation intent lost: %+v err=%v", pending, err)
	}
	var beforeBills int64
	if err := db.Model(&model.BillingOrder{}).Count(&beforeBills).Error; err != nil {
		t.Fatal(err)
	}
	s.disablePiRuntime = false
	s.recoverCloudAgentPiRunners()
	s.piRunnerWg.Wait()
	s.disablePiRuntime = true
	finished, err := s.CloudAgentRun("user", root.ID)
	if err != nil || finished.Status != "cancelled" || finished.CleanupPending {
		t.Fatalf("cleanup did not settle: %+v err=%v", finished, err)
	}
	if err := s.DeleteUserCanvasProject("user", "agent-canvas"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.repo.CanvasProjectForUser("user", "agent-canvas"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("canvas still exists: %v", err)
	}
	if _, err := s.CloudAgentRun("other-user", root.ID); err == nil {
		t.Fatal("deleted canvas history leaked to another user")
	}
	replay, err := s.CreateCloudAgentRun("user", original, "")
	if err != nil || replay.ID != root.ID || replay.Status != "cancelled" {
		t.Fatalf("accepted request cannot be reconciled after deletion: %+v err=%v", replay, err)
	}
	changed := original
	changed.Model = "different-model"
	if _, err := s.CreateCloudAgentRun("user", changed, ""); err == nil {
		t.Fatal("same key accepted a changed model")
	}
	changed = original
	changed.IdempotencyKey = "new-key-on-deleted-canvas"
	if _, err := s.CreateCloudAgentRun("user", changed, ""); err == nil {
		t.Fatal("deleted canvas accepted new work")
	}
	var afterBills int64
	if err := db.Model(&model.BillingOrder{}).Count(&afterBills).Error; err != nil || afterBills != beforeBills {
		t.Fatalf("cleanup/replay created another bill: before=%d after=%d err=%v", beforeBills, afterBills, err)
	}

	// Leaving the deleted canvas is an explicit scope change; preserve the old
	// request and tool receipts as context while admitting a fresh unbound turn.
	next := agentTestRequest()
	next.CanvasID, next.ContextScope = "", nil
	next.IdempotencyKey, next.Prompt = "continue-after-delete", "继续整理已读取的剧情"
	child, err := s.CreateCloudAgentRun("user", next, root.ID)
	if err != nil {
		t.Fatalf("safe continuation after deletion failed: %v", err)
	}
	continued, err := s.repo.CloudAgent("user", child.ID)
	if err != nil {
		t.Fatal(err)
	}
	continuedState, err := cloudAgentDecode(continued)
	if err != nil {
		t.Fatal(err)
	}
	history := ""
	for _, message := range continuedState.TextHistory {
		history += message.Content
	}
	if !strings.Contains(history, original.Prompt) || !strings.Contains(history, "已读取原画布") || !strings.Contains(history, "submitted-before-stop") {
		t.Fatalf("continuation lost important history: %s", history)
	}
	if _, err := s.repo.CanvasProjectForUser("user", "agent-canvas"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("continuation resurrected canvas: %v", err)
	}
}

func TestCloudAgentFrozenProfileReplayAfterPreferenceEdit(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	_, originalState, err := s.cloudAgentTask("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	original := originalState.Request
	updated := saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "新的偏好只影响后续轮次", Revision: 0})
	var before int64
	if err := db.Model(&model.BillingOrder{}).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	replay, err := s.CreateCloudAgentRun("user", original, "")
	if err != nil || replay.ID != root.ID {
		t.Fatalf("frozen original cannot be reconciled: %+v %v", replay, err)
	}
	changed := original
	changed.ProfileRevision = updated.Revision
	if _, err := s.CreateCloudAgentRun("user", changed, ""); err == nil {
		t.Fatal("same key accepted a different preference snapshot")
	}
	stale := original
	stale.IdempotencyKey = "new-request-old-profile"
	if _, err := s.CreateCloudAgentRun("user", stale, ""); err == nil {
		t.Fatal("new request bypassed current preference admission")
	}
	var after int64
	if err := db.Model(&model.BillingOrder{}).Count(&after).Error; err != nil || before != after {
		t.Fatalf("reconciliation created a bill: before=%d after=%d %v", before, after, err)
	}
}

func TestCloudAgentCancellationPersistsBeforeInterruptingRunner(t *testing.T) {
	s, _, root := reliableAgentRoot(t)
	interrupted := false
	s.piRunners = map[string]context.CancelFunc{root.ID: func() {
		interrupted = true
		run, err := s.repo.CloudAgent("user", root.ID)
		if err != nil || run.Status != "cancelled" || !run.CleanupPending {
			t.Errorf("runner interrupted before durable cancellation: %+v %v", run, err)
		}
		// A late process-exit error cannot turn user cancellation into failure.
		s.failPiRunner(root.ID, "user", errors.New("runtime interrupted"))
	}}
	if err := s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
		t.Fatal(err)
	}
	if !interrupted {
		t.Fatal("runtime was not interrupted")
	}
	delete(s.piRunners, root.ID)
	run, err := s.CloudAgentRun("user", root.ID)
	if err != nil || run.Status != "cancelled" || run.CleanupPending {
		t.Fatalf("cancellation did not finish: %+v %v", run, err)
	}
}

func TestCloudAgentPiFailureSchedulesCleanupWithoutModelReplay(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	s.failPiRunner(root.ID, "user", errors.New("model step failed"))
	run, err := s.CloudAgentRun("user", root.ID)
	if err != nil || run.Status != "failed" || !run.CleanupPending {
		t.Fatalf("failure did not reserve cleanup: %+v %v", run, err)
	}
	if err := s.runCloudAgentPiSession(context.Background(), "user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, err = s.CloudAgentRun("user", root.ID)
	if err != nil || run.Status != "failed" || run.CleanupPending {
		t.Fatalf("failure cleanup did not settle: %+v %v", run, err)
	}
	var tasks int64
	if err := db.Model(&model.Task{}).Count(&tasks).Error; err != nil || tasks != 1 {
		t.Fatalf("terminal cleanup restarted model tasks: count=%d %v", tasks, err)
	}
}
