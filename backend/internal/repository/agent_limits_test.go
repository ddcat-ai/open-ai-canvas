package repository

import (
	"errors"
	"fmt"
	"sync"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func TestAgentRunLimitSerializesUnboundRootsAcrossConnections(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			a, b := agentLifecycleRepositories(t, driver)
			start, results := make(chan struct{}), make(chan error, 2)
			var wg sync.WaitGroup
			for i, repo := range []*Repository{a, b} {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					results <- repo.CreateTaskWithActiveLimit(&model.Task{ID: fmt.Sprintf("root-%d", i), UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusTextReplay}, 5, 1)
				}()
			}
			close(start)
			wg.Wait()
			close(results)
			accepted, rejected := 0, 0
			for err := range results {
				if err == nil {
					accepted++
				} else {
					var appErr *kernel.AppError
					if !errors.As(err, &appErr) || appErr.Code != kernel.CodeQuotaExceeded {
						t.Fatalf("unexpected admission error: %v", err)
					}
					rejected++
				}
			}
			if accepted != 1 || rejected != 1 {
				t.Fatalf("accepted=%d rejected=%d", accepted, rejected)
			}
			if err := b.CreateTaskWithActiveLimit(&model.Task{ID: "other-user-root", UserID: "other", Operation: "cloud_agent", Status: model.TaskStatusTextReplay}, 5, 1); err != nil {
				t.Fatalf("other account blocked: %v", err)
			}
			var task model.Task
			if err := a.db.First(&task, "user_id = ?", "user").Error; err != nil {
				t.Fatal(err)
			}
			for _, state := range []struct {
				status  string
				cleanup bool
			}{{"waiting_approval", false}, {"completed", true}, {"completed", false}} {
				if err := a.db.Save(&model.CloudAgentExecution{ID: task.ID, UserID: "user", Status: state.status, CleanupPending: state.cleanup}).Error; err != nil {
					t.Fatal(err)
				}
				err := b.CreateTaskWithActiveLimit(&model.Task{ID: "next", UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusTextReplay}, 5, 1)
				if wantAllowed := state.status == "completed" && !state.cleanup; (err == nil) != wantAllowed {
					t.Fatalf("state=%+v err=%v", state, err)
				}
			}
		})
	}
}

func TestAgentStorageCountsLegacyDataAndTransactionalDeltas(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			repo, _ := agentLifecycleRepositories(t, driver)
			run := &model.CloudAgentExecution{ID: "run", UserID: "user", Revision: 1, Status: "running", CheckpointVersion: 2, StateJSON: `{"note":"旧状态"}`, EventCount: 1, MessageCount: 1,
				Journal:    []model.CloudAgentEventRecord{{RunID: "run", UserID: "user", Sequence: 1, EventJSON: `{"seq":1}`}},
				Transcript: []model.CloudAgentMessageRecord{{RunID: "run", UserID: "user", Kind: "canonical", Sequence: 1, MessageJSON: `{"text":"旧消息较长"}`}},
			}
			// Existing rows precede the new ledger, as on an upgrade.
			if err := repo.db.Create(run).Error; err != nil {
				t.Fatal(err)
			}
			if err := repo.db.Create(&model.CloudAgentCanvasMutation{ID: "undo", RunID: "run", UserID: "user", BeforeJSON: `{"old":true}`}).Error; err != nil {
				t.Fatal(err)
			}
			assertMeasured := func() {
				t.Helper()
				measured, err := repo.agentPayloadBytes("user")
				if err != nil {
					t.Fatal(err)
				}
				accounted, err := repo.AgentStoredBytes("user")
				if err != nil || accounted != measured || accounted == 0 {
					t.Fatalf("accounted=%d measured=%d err=%v", accounted, measured, err)
				}
			}
			assertMeasured()
			session := &model.CloudAgentPiSession{RunID: "run", UserID: "user", SessionJSONL: "原生会话\n"}
			if err := repo.SaveCloudAgentPiSession(session, 0); err != nil {
				t.Fatal(err)
			}
			assertMeasured()
			if err := repo.SaveCloudAgentPiSession(session, 0); !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("duplicate initial snapshot: %v", err)
			}
			assertMeasured()
			if err := repo.MutateCloudAgent("user", "run", 1, func(current *model.CloudAgentExecution, _ *Repository) error {
				current.StateJSON = `{"new":true}`
				current.Journal = append(current.Journal, model.CloudAgentEventRecord{RunID: "run", UserID: "user", Sequence: 2, EventJSON: `{"seq":2}`})
				current.EventCount = 2
				current.Transcript[0].MessageJSON = `{}`
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			assertMeasured()
			if err := repo.EnsureCloudAgent(run); err != nil {
				t.Fatal(err)
			}
			assertMeasured()
			if used, err := repo.AgentStoredBytes("other"); err != nil || used != 0 {
				t.Fatalf("cross-account storage: %d %v", used, err)
			}
		})
	}
}

func TestAgentStorageQuotaRollsBackAndAllowsCancellation(t *testing.T) {
	repo, other := agentLifecycleRepositories(t, "sqlite")
	run := &model.CloudAgentExecution{ID: "run", UserID: "user", Revision: 1, Status: "waiting_approval", CheckpointVersion: 2, StateJSON: `{}`}
	if err := repo.EnsureCloudAgent(run); err != nil {
		t.Fatal(err)
	}
	// Seed only the accounting boundary: avoid allocating a 256 MiB fixture.
	if err := repo.db.Model(&model.AgentStorageUsage{}).Where("user_id = ?", "user").Update("stored_bytes", AgentStoredDataLimit-1).Error; err != nil {
		t.Fatal(err)
	}
	start, results := make(chan struct{}), make(chan error, 2)
	for i, writer := range []*Repository{repo, other} {
		go func() {
			<-start
			results <- writer.SaveCloudAgentPiSession(&model.CloudAgentPiSession{RunID: fmt.Sprintf("session-%d", i), UserID: "user", SessionJSONL: "x"}, 0)
		}()
	}
	close(start)
	accepted := 0
	for range 2 {
		if err := <-results; err == nil {
			accepted++
		}
	}
	if accepted != 1 {
		t.Fatalf("quota race admitted %d snapshots", accepted)
	}
	if err := repo.MutateCloudAgent("user", "run", 1, func(current *model.CloudAgentExecution, _ *Repository) error {
		current.StateJSON = `{"larger":true}`
		return nil
	}); err == nil {
		t.Fatal("quota allowed checkpoint growth")
	}
	stored, err := repo.CloudAgent("user", "run")
	if err != nil || stored.Revision != 1 || stored.StateJSON != `{}` {
		t.Fatalf("partial checkpoint committed: %+v %v", stored, err)
	}
	if err := repo.MarkCloudAgentCancelled("user", "run", 1); err != nil {
		t.Fatalf("quota blocked cancellation: %v", err)
	}
	if err := repo.SaveCloudAgentPiSession(&model.CloudAgentPiSession{RunID: "independent", UserID: "other", SessionJSONL: "x"}, 0); err != nil {
		t.Fatalf("quota blocked other user: %v", err)
	}
}

func TestAgentFailedReservationDoesNotBlockContinuation(t *testing.T) {
	repo, _ := agentLifecycleRepositories(t, "sqlite")
	parent := &model.CloudAgentExecution{ID: "parent", UserID: "user", ConversationID: "parent", Status: "completed", Revision: 1, StateJSON: `{}`}
	if err := repo.EnsureCloudAgent(parent); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.Model(&model.AgentStorageUsage{}).Where("user_id = ?", "user").Update("stored_bytes", AgentStoredDataLimit).Error; err != nil {
		t.Fatal(err)
	}
	child := &model.Task{ID: "child", UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusTextReplay, InputJSON: `{"cloudAgent":{"parentId":"parent"}}`}
	if err := repo.CreateTaskWithActiveLimit(child, 5); err != nil {
		t.Fatal(err)
	}
	if err := repo.EnsureCloudAgent(&model.CloudAgentExecution{ID: child.ID, UserID: "user", ParentID: "parent", Status: "running", StateJSON: `{}`}); err == nil {
		t.Fatal("initial checkpoint should exceed quota")
	}
	if err := repo.FailCloudAgentReservation("user", child.ID, "storage quota"); err != nil {
		t.Fatal(err)
	}
	// Reclaiming quota must permit a new child of the last successful parent.
	if err := repo.db.Model(&model.AgentStorageUsage{}).Where("user_id = ?", "user").Update("stored_bytes", 2).Error; err != nil {
		t.Fatal(err)
	}
	child.ID = "retry-child"
	if err := repo.CreateTaskWithActiveLimit(child, 5); err != nil {
		t.Fatalf("failed reservation retained conversation ownership: %v", err)
	}
}
