package app

import (
	"errors"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func parentBusyTestRun(t *testing.T, surface string) (*Service, *gorm.DB, CloudAgentRequest, *CloudAgentRun) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	s.legacyCloudAgentRootTask = false
	req := creationAgentRequest()
	if surface == "canvas" {
		req = agentTestRequest()
		if err := db.Create(&model.CanvasProject{ID: req.CanvasID, UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
			t.Fatal(err)
		}
	}
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	return s, db, req, run
}

func assertParentBusyRejection(t *testing.T, err error, canvasID, runID, status string, cleanup bool) {
	t.Helper()
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != 409 || appErr.Code != 409 || appErr.Reason != "canvas_agent_busy" || appErr.Retryable {
		t.Fatalf("parent rejection must be definite and non-retryable: %+v", err)
	}
	activity, ok := appErr.Details["agent"].(repository.CanvasAgentActivity)
	if !ok || appErr.Details["canvasId"] != canvasID || activity.RunID != runID || activity.Status != status || activity.CleanupPending != cleanup {
		t.Fatalf("parent rejection lost its observed activity: %+v", appErr)
	}
}

func assertParentBusyTaskCount(t *testing.T, s *Service, db *gorm.DB, want int64) {
	t.Helper()
	var tasks, orders int64
	if err := db.Model(&model.Task{}).Count(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.BillingOrder{}).Count(&orders).Error; err != nil {
		t.Fatal(err)
	}
	account, err := s.repo.CreditAccount("user")
	if err != nil {
		t.Fatal(err)
	}
	if tasks != want || orders != 0 || account.AvailableMicrocredits != 10000 || account.ReservedMicrocredits != 0 {
		t.Fatalf("rejected admission changed tasks or credits: tasks=%d orders=%d account=%+v", tasks, orders, account)
	}
}

func TestCloudAgentParentBusyIsDefiniteRejection(t *testing.T) {
	for _, surface := range []string{"creation", "canvas"} {
		for _, state := range []struct {
			status  string
			cleanup bool
		}{{"queued", false}, {"running", false}, {"waiting_approval", false}, {"cancelled", true}, {"completed", true}} {
			t.Run(surface+"/"+state.status, func(t *testing.T) {
				s, db, req, parent := parentBusyTestRun(t, surface)
				if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", parent.ID).Updates(map[string]any{"status": state.status, "cleanup_pending": state.cleanup}).Error; err != nil {
					t.Fatal(err)
				}
				next := req
				next.IdempotencyKey = "parent-busy-next"
				_, err := s.CreateCloudAgentRun("user", next, parent.ID)
				assertParentBusyRejection(t, err, req.CanvasID, parent.ID, state.status, state.cleanup)
				assertParentBusyTaskCount(t, s, db, 1)
			})
		}
	}
}

func TestCloudAgentParentBusyRecheckedAfterRunView(t *testing.T) {
	for _, surface := range []string{"creation", "canvas"} {
		t.Run(surface, func(t *testing.T) {
			s, db, req, parent := parentBusyTestRun(t, surface)
			if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", parent.ID).Update("status", "completed").Error; err != nil {
				t.Fatal(err)
			}
			changed := false
			callback := "test:parent-cleanup-after-view"
			if err := db.Callback().Query().After("gorm:query").Register(callback, func(tx *gorm.DB) {
				if changed || tx.Statement.Table != "billing_orders" {
					return
				}
				changed = true
				// The view has already copied the completed execution. Its final
				// billing read races with cleanup becoming pending before recheck.
				tx.AddError(db.Model(&model.CloudAgentExecution{}).Where("id = ?", parent.ID).Update("cleanup_pending", true).Error)
			}); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { db.Callback().Query().Remove(callback) })
			next := req
			next.IdempotencyKey = "parent-rechecked-next"
			_, err := s.CreateCloudAgentRun("user", next, parent.ID)
			if !changed {
				t.Fatal("parent view race was not exercised")
			}
			assertParentBusyRejection(t, err, req.CanvasID, parent.ID, "completed", true)
			assertParentBusyTaskCount(t, s, db, 1)
		})
	}
}

func TestCloudAgentParentBusyReplayKeepsExistingIdentity(t *testing.T) {
	for _, surface := range []string{"creation", "canvas"} {
		t.Run(surface, func(t *testing.T) {
			s, db, req, parent := parentBusyTestRun(t, surface)
			if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", parent.ID).Update("status", "completed").Error; err != nil {
				t.Fatal(err)
			}
			next := req
			next.IdempotencyKey = "parent-replay-next"
			child, err := s.CreateCloudAgentRun("user", next, parent.ID)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", parent.ID).Update("cleanup_pending", true).Error; err != nil {
				t.Fatal(err)
			}
			replay, err := s.CreateCloudAgentRun("user", next, parent.ID)
			if err != nil || replay.ID != child.ID {
				t.Fatalf("parent busy replaced an accepted identity: run=%+v err=%v", replay, err)
			}
			next.Prompt = "changed input under the same key"
			_, err = s.CreateCloudAgentRun("user", next, parent.ID)
			var appErr *AppError
			if !errors.As(err, &appErr) || appErr.Status != 409 || appErr.Reason != kernel.ReasonForStatus(409) {
				t.Fatalf("idempotency conflict became a definite busy rejection: %+v", err)
			}
			assertParentBusyTaskCount(t, s, db, 2)
		})
	}
}
