package app

import (
	"errors"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCloudAgentCanvasExclusivityAndTerminalRelease(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		name := "pi"
		if legacy {
			name = "legacy"
		}
		t.Run(name, func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			s.legacyCloudAgentRootTask = legacy
			if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
				t.Fatal(err)
			}
			req := agentTestRequest()
			run, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil {
				t.Fatal(err)
			}
			replayed, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil || replayed.ID != run.ID {
				t.Fatalf("replay created another run: %+v %v", replayed, err)
			}
			accountBefore, err := s.repo.CreditAccount("user")
			if err != nil {
				t.Fatal(err)
			}
			for _, state := range []struct {
				status  string
				cleanup bool
			}{
				{"running", false}, {"waiting_approval", false}, {"cancelled", true}, {"completed", true},
			} {
				if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Updates(map[string]any{"status": state.status, "cleanup_pending": state.cleanup}).Error; err != nil {
					t.Fatal(err)
				}
				next := req
				next.IdempotencyKey = "blocked-" + state.status
				_, err := s.CreateCloudAgentRun("user", next, "")
				var appErr *AppError
				if !errors.As(err, &appErr) || appErr.Status != 409 || appErr.Reason != "canvas_agent_busy" {
					t.Fatalf("%+v admitted another run or wrong error: %v", state, err)
				}
				activity, ok := appErr.Details["agent"].(repository.CanvasAgentActivity)
				if appErr.Retryable || appErr.Details["canvasId"] != req.CanvasID || !ok || activity.RunID != run.ID || activity.Status != state.status || activity.CleanupPending != state.cleanup {
					t.Fatalf("rejection lost authoritative activity: %+v", appErr)
				}
			}
			accountAfter, err := s.repo.CreditAccount("user")
			if err != nil {
				t.Fatal(err)
			}
			if accountAfter.AvailableMicrocredits != accountBefore.AvailableMicrocredits || accountAfter.ReservedMicrocredits != accountBefore.ReservedMicrocredits {
				t.Fatal("rejected requests altered credits")
			}
			var count int64
			if err := db.Model(&model.Task{}).Where("operation = ?", "cloud_agent").Count(&count).Error; err != nil || count != 1 {
				t.Fatalf("rejections left extra roots: %d %v", count, err)
			}
			if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Update("cleanup_pending", false).Error; err != nil {
				t.Fatal(err)
			}
			next := req
			next.IdempotencyKey = "after-completion"
			if _, err := s.CreateCloudAgentRun("user", next, ""); err != nil {
				t.Fatalf("completed run did not release canvas: %v", err)
			}
		})
	}
}
