package repository

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

func agentLifecycleRepositories(t *testing.T, driver string) (*Repository, *Repository) {
	t.Helper()
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	var dialector gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "agent-lifecycle.db") + "?_journal_mode=WAL&_busy_timeout=5000")
	if driver == "postgres" {
		dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
		}
		admin, err := gorm.Open(postgres.Open(dsn), config)
		if err != nil {
			t.Fatal(err)
		}
		schema := fmt.Sprintf("agent_lifecycle_%d", time.Now().UnixNano())
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
				t.Error(err)
			}
			conn, _ := admin.DB()
			_ = conn.Close()
		})
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		dialector = postgres.Open(parsed.String())
	}
	open := func() *Repository {
		db, err := gorm.Open(dialector, config)
		if err != nil {
			t.Fatal(err)
		}
		conn, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = conn.Close() })
		return New(db)
	}
	a, b := open(), open()
	if err := a.db.AutoMigrate(&model.CanvasProject{}, &model.Task{}, &model.CloudAgentExecution{}, &model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}, &model.CloudAgentPiSession{}, &model.CloudAgentCanvasMutation{}, &model.AgentStorageUsage{}, &model.CanvasEditLease{}, &model.CanvasSnapshot{}, &model.CanvasShare{}, &model.CanvasUnitLink{}); err != nil {
		t.Fatal(err)
	}
	return a, b
}

// Commit a checkpoint from another connection exactly between the execution and
// transcript reads. A transaction at PostgreSQL READ COMMITTED is not sufficient.
func TestCloudAgentCheckpointSnapshotAcrossConnections(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			for _, readPath := range []string{"run", "active-task", "recovery-scan"} {
				t.Run(readPath, func(t *testing.T) {
					reader, writer := agentLifecycleRepositories(t, driver)
					run := model.CloudAgentExecution{ID: "run", UserID: "user", Status: "running", Revision: 1, CheckpointVersion: 2, ActiveTaskID: "step", EventCount: 1, MessageCount: 2,
						Journal: []model.CloudAgentEventRecord{{RunID: "run", UserID: "user", Sequence: 1, EventJSON: `{"immutable":1}`}},
						Transcript: []model.CloudAgentMessageRecord{
							{RunID: "run", UserID: "user", Kind: "canonical", Sequence: 1, MessageJSON: `{"content":"original prompt"}`},
							{RunID: "run", UserID: "user", Kind: "canonical", Sequence: 2, MessageJSON: `{"content":"original answer"}`},
						},
					}
					if err := reader.db.Create(&run).Error; err != nil {
						t.Fatal(err)
					}
					var committed atomic.Bool
					if err := reader.db.Callback().Query().After("gorm:query").Register("test:checkpoint-between-reads", func(tx *gorm.DB) {
						if tx.Statement.Table != "cloud_agent_executions" || !committed.CompareAndSwap(false, true) {
							return
						}
						err := writer.MutateCloudAgent("user", "run", 1, func(current *model.CloudAgentExecution, _ *Repository) error {
							current.Journal = append(current.Journal, model.CloudAgentEventRecord{RunID: "run", UserID: "user", Sequence: 2, EventJSON: `{"immutable":2}`})
							current.EventCount = 2
							current.Transcript = []model.CloudAgentMessageRecord{{RunID: "run", UserID: "user", Kind: "canonical", Sequence: 1, MessageJSON: `{"content":"compacted history"}`}}
							current.MessageCount = 1
							return nil
						})
						if err != nil {
							t.Errorf("interleaved checkpoint: %v", err)
						}
					}); err != nil {
						t.Fatal(err)
					}
					var snapshot *model.CloudAgentExecution
					var err error
					switch readPath {
					case "run":
						snapshot, err = reader.CloudAgent("user", "run")
					case "active-task":
						snapshot, err = reader.CloudAgentForActiveTask("user", "step")
					case "recovery-scan":
						var runs []model.CloudAgentExecution
						runs, err = reader.ActiveCloudAgentsAfter("", 50)
						if len(runs) == 1 {
							snapshot = &runs[0]
						}
					}
					if err != nil || snapshot == nil || !committed.Load() {
						t.Fatalf("snapshot=%v committed=%v err=%v", snapshot, committed.Load(), err)
					}
					if snapshot.Revision != 1 || snapshot.EventCount != len(snapshot.Journal) || snapshot.MessageCount != len(snapshot.Transcript) || len(snapshot.Transcript) != 2 || snapshot.Transcript[0].MessageJSON != run.Transcript[0].MessageJSON {
						t.Fatalf("mixed checkpoint generations: %+v", snapshot)
					}
					latest, err := reader.CloudAgent("user", "run")
					if err != nil || latest.Revision != 2 || latest.EventCount != 2 || len(latest.Journal) != 2 || latest.MessageCount != 1 || len(latest.Transcript) != 1 {
						t.Fatalf("new checkpoint missing after snapshot: %+v err=%v", latest, err)
					}
				})
			}
		})
	}
}

func TestEnsureCloudAgentDoesNotMutateExistingCheckpoint(t *testing.T) {
	repo, _ := agentLifecycleRepositories(t, "sqlite")
	if err := repo.db.Create(&model.Task{ID: "run", UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusTextReplay}).Error; err != nil {
		t.Fatal(err)
	}
	current := &model.CloudAgentExecution{ID: "run", UserID: "user", Status: "completed", Revision: 9, CheckpointVersion: 2, EventCount: 2, MessageCount: 1, StateJSON: `{"checkpoint":"current"}`,
		Journal: []model.CloudAgentEventRecord{
			{RunID: "run", UserID: "user", Sequence: 1, EventJSON: `{"receipt":"initial"}`},
			{RunID: "run", UserID: "user", Sequence: 2, EventJSON: `{"receipt":"compacted"}`},
		},
		Transcript: []model.CloudAgentMessageRecord{{RunID: "run", UserID: "user", Kind: "canonical", Sequence: 1, MessageJSON: `{"content":"compacted"}`}},
	}
	if err := repo.EnsureCloudAgent(current); err != nil {
		t.Fatal(err)
	}
	// A competing initial read can have decided to initialize before the winner
	// checkpoints or compacts. Its late INSERT conflict must not save associations.
	stale := &model.CloudAgentExecution{ID: "run", UserID: "user", Status: "running", Revision: 1, CheckpointVersion: 2, EventCount: 1, MessageCount: 2, StateJSON: `{"checkpoint":"stale"}`,
		Journal: []model.CloudAgentEventRecord{{RunID: "run", UserID: "user", Sequence: 1, EventJSON: `{"receipt":"initial"}`}},
		Transcript: []model.CloudAgentMessageRecord{
			{RunID: "run", UserID: "user", Kind: "canonical", Sequence: 1, MessageJSON: `{"content":"old first"}`},
			{RunID: "run", UserID: "user", Kind: "canonical", Sequence: 2, MessageJSON: `{"content":"old second"}`},
		},
	}
	if err := repo.EnsureCloudAgent(stale); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.CloudAgent("user", "run")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Revision != 9 || stored.Status != "completed" || stored.StateJSON != current.StateJSON || stored.MessageCount != len(stored.Transcript) || stored.EventCount != len(stored.Journal) {
		t.Fatalf("late initialization damaged accepted checkpoint: %+v", stored)
	}
	if stored.Transcript[0].MessageJSON != current.Transcript[0].MessageJSON || stored.Journal[0].EventJSON != current.Journal[0].EventJSON {
		t.Fatal("late initialization rewrote committed history")
	}
}

func TestCloudAgentAdmissionAndCanvasDeletionAcrossConnections(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			admission, deletion := agentLifecycleRepositories(t, driver)
			for index := 0; index < 8; index++ {
				canvasID := fmt.Sprintf("canvas-%d", index)
				runID := fmt.Sprintf("run-%d", index)
				if err := admission.db.Create(&model.CanvasProject{ID: canvasID, UserID: "user", Revision: 1, PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
					t.Fatal(err)
				}
				start := make(chan struct{})
				admitted, deleted := make(chan error, 1), make(chan error, 1)
				go func() {
					<-start
					admitted <- admission.CreateTaskWithActiveLimit(&model.Task{ID: runID, UserID: "user", ProjectID: canvasID, Operation: "cloud_agent", Status: model.TaskStatusTextReplay}, 100)
				}()
				go func() {
					<-start
					deleted <- deletion.DeleteCanvasProject("user", canvasID)
				}()
				close(start)
				admitErr, deleteErr := <-admitted, <-deleted
				var taskCount, canvasCount int64
				if err := admission.db.Model(&model.Task{}).Where("id = ?", runID).Count(&taskCount).Error; err != nil {
					t.Fatal(err)
				}
				if err := admission.db.Model(&model.CanvasProject{}).Where("id = ?", canvasID).Count(&canvasCount).Error; err != nil {
					t.Fatal(err)
				}
				switch {
				case admitErr == nil && errors.Is(deleteErr, ErrCanvasAgentBusy):
					if taskCount != 1 || canvasCount != 1 {
						t.Fatalf("accepted run lost its canvas: tasks=%d canvases=%d", taskCount, canvasCount)
					}
				case deleteErr == nil && errors.Is(admitErr, gorm.ErrRecordNotFound):
					if taskCount != 0 || canvasCount != 0 {
						t.Fatalf("deleted canvas admitted a run: tasks=%d canvases=%d", taskCount, canvasCount)
					}
				default:
					t.Fatalf("admission=%v deletion=%v", admitErr, deleteErr)
				}
			}
		})
	}
}
