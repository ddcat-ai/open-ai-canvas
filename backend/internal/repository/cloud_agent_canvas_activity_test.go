package repository

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
)

func TestCanvasAgentActivityIndexed(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
			var dialector gorm.Dialector = sqlite.Open(filepath.Join(t.TempDir(), "activity.db") + "?_journal_mode=WAL&_busy_timeout=5000")
			if driver == "postgres" {
				dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
				}
				admin, err := gorm.Open(postgres.Open(dsn), config)
				if err != nil {
					t.Fatal(err)
				}
				schema := fmt.Sprintf("agent_activity_%d", time.Now().UnixNano())
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
			open := func() *gorm.DB {
				db, err := gorm.Open(dialector, config)
				if err != nil {
					t.Fatal(err)
				}
				conn, err := db.DB()
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = conn.Close() })
				return db
			}
			db := open()
			for range 2 {
				if err := database.MigrateSchema(db); err != nil {
					t.Fatal(err)
				}
				if err := database.RequireSchemaVersion(db); err != nil {
					t.Fatal(err)
				}
			}
			t.Run("state-semantics", func(t *testing.T) { testCanvasAgentActivityStates(t, db) })
			t.Run("checkpoint-marker", func(t *testing.T) { testCanvasAgentCheckpointMarker(t, db) })
			t.Run("pi-history-indexes", func(t *testing.T) { testCanvasAgentHistoryPlan(t, db) })
			t.Run("concurrent-admission", func(t *testing.T) { testCanvasAgentAdmissionAcrossConnections(t, New(db), New(open())) })
		})
	}
}

func testCanvasAgentHistoryPlan(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.Transaction(func(tx *gorm.DB) error {
		for i := range 1000 {
			id := fmt.Sprintf("pi-history-%d", i)
			if err := tx.Create(&model.Task{ID: id, UserID: "history", ProjectID: "history-canvas", Operation: "cloud_agent", Status: model.TaskStatusTextReplay}).Error; err != nil {
				return err
			}
			if err := New(tx).EnsureCloudAgent(&model.CloudAgentExecution{ID: id, UserID: "history", Status: "completed"}); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	activity, err := New(db).CanvasAgentActivity("history", "history-canvas")
	if err != nil || activity != nil {
		t.Fatalf("history occupancy: %+v %v", activity, err)
	}
	// Clear dead reservation-index entries created by the insert/checkpoint
	// fixture sequence before testing the steady-state historical read plan.
	analyze := "ANALYZE"
	if db.Dialector.Name() == "postgres" {
		analyze = "VACUUM ANALYZE tasks"
	}
	if err := db.Exec(analyze).Error; err != nil {
		t.Fatal(err)
	}
	if db.Dialector.Name() == "postgres" {
		if err := db.Exec("ANALYZE cloud_agent_executions").Error; err != nil {
			t.Fatal(err)
		}
	}
	var plan string
	if db.Dialector.Name() == "postgres" {
		if err := db.Raw("EXPLAIN (ANALYZE, FORMAT JSON) "+canvasAgentActivitySQL, "history", "history-canvas", "history", "history-canvas").Scan(&plan).Error; err != nil {
			t.Fatal(err)
		}
	} else {
		var rows []struct{ Detail string }
		if err := db.Raw("EXPLAIN QUERY PLAN "+canvasAgentActivitySQL, "history", "history-canvas", "history", "history-canvas").Scan(&rows).Error; err != nil {
			t.Fatal(err)
		}
		for _, row := range rows {
			plan += row.Detail + "\n"
		}
	}
	for _, index := range []string{"idx_cloud_agent_canvas_active", "idx_tasks_canvas_agent_reservation"} {
		if !strings.Contains(plan, index) {
			t.Fatalf("missing active-only index %s: %s", index, plan)
		}
	}
}

func testCanvasAgentCheckpointMarker(t *testing.T, db *gorm.DB) {
	t.Helper()
	repo := New(db)
	task := model.Task{ID: "checkpoint-root", UserID: "checkpoint", ProjectID: "checkpoint-canvas", Operation: "cloud_agent", Status: model.TaskStatusTextReplay}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	run := model.CloudAgentExecution{ID: task.ID, UserID: task.UserID, Status: "completed"}
	wantRollback := fmt.Errorf("rollback checkpoint")
	if err := repo.Transaction(func(tx *Repository) error {
		if err := tx.EnsureCloudAgent(&run); err != nil {
			return err
		}
		return wantRollback
	}); err != wantRollback {
		t.Fatal(err)
	}
	var saved model.Task
	if err := db.First(&saved, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if saved.AgentExecutionReady {
		t.Fatal("rollback left ready marker")
	}
	activity, err := repo.CanvasAgentActivity(task.UserID, task.ProjectID)
	if err != nil || activity == nil {
		t.Fatalf("rollback lost reservation: %+v %v", activity, err)
	}
	for range 2 {
		if err := repo.EnsureCloudAgent(&run); err != nil {
			t.Fatal(err)
		}
	}
	// An old task object can still be saved by a worker after execution creation.
	if err := db.Save(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&saved, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !saved.AgentExecutionReady || saved.Status != model.TaskStatusTextReplay {
		t.Fatalf("marker/task changed: %+v", saved)
	}
	activity, err = repo.CanvasAgentActivity(task.UserID, task.ProjectID)
	if err != nil || activity != nil {
		t.Fatalf("completed carrier remains busy: %+v %v", activity, err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Updates(map[string]any{"status": "failed", "cleanup_pending": true}).Error; err != nil {
		t.Fatal(err)
	}
	activity, err = repo.CanvasAgentActivity(task.UserID, task.ProjectID)
	if err != nil || activity == nil || !activity.CleanupPending {
		t.Fatalf("marker bypassed cleanup: %+v %v", activity, err)
	}
}

func testCanvasAgentActivityStates(t *testing.T, db *gorm.DB) {
	t.Helper()
	repo := New(db)
	taskStates := []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusTextReplay, model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled}
	runStates := []string{"missing", "queued", "running", "waiting_approval", "completed", "failed", "cancelled", "rejected", "future_state"}
	at := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	caseNumber := 0
	for _, taskState := range taskStates {
		for _, runState := range runStates {
			for _, cleanup := range []bool{false, true} {
				caseNumber++
				id := fmt.Sprintf("matrix-%d", caseNumber)
				task := model.Task{ID: id, UserID: "states", ProjectID: id, Operation: "cloud_agent", Status: taskState, CreatedAt: at}
				if err := db.Create(&task).Error; err != nil {
					t.Fatal(err)
				}
				if runState != "missing" {
					// Task ownership remains authoritative even for a legacy blank CanvasID.
					run := model.CloudAgentExecution{ID: id, UserID: "states", Status: runState, CleanupPending: cleanup}
					if err := db.Create(&run).Error; err != nil {
						t.Fatal(err)
					}
				}
				var want *CanvasAgentActivity
				if runState == "missing" {
					if taskState != model.TaskStatusSucceeded && taskState != model.TaskStatusFailed && taskState != model.TaskStatusCancelled {
						want = &CanvasAgentActivity{RunID: id, Status: "queued"}
					}
				} else if cleanup || (runState != "completed" && runState != "failed" && runState != "cancelled" && runState != "rejected") {
					want = &CanvasAgentActivity{RunID: id, Status: runState, CleanupPending: cleanup}
				}
				got, err := repo.CanvasAgentActivity("states", id)
				if err != nil || !reflect.DeepEqual(got, want) {
					t.Fatalf("%s/%s/%t: got=%+v want=%+v err=%v", taskState, runState, cleanup, got, want, err)
				}
			}
		}
	}
	// Oldest task wins across both branches, with ID as the tie breaker.
	for _, task := range []model.Task{
		{ID: "order-b", UserID: "states", ProjectID: "ordered", Operation: "cloud_agent", Status: model.TaskStatusQueued, CreatedAt: at},
		{ID: "order-a", UserID: "states", ProjectID: "ordered", Operation: "cloud_agent", Status: model.TaskStatusSucceeded, CreatedAt: at},
		{ID: "order-other-user", UserID: "stranger", ProjectID: "ordered", Operation: "cloud_agent", Status: model.TaskStatusQueued, CreatedAt: at.Add(-time.Hour)},
		{ID: "order-ordinary", UserID: "states", ProjectID: "ordered", Operation: "generate", Status: model.TaskStatusQueued, CreatedAt: at.Add(-time.Hour)},
	} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, run := range []model.CloudAgentExecution{
		{ID: "order-a", UserID: "states", Status: "waiting_approval"},
		{ID: "orphan", UserID: "states", CanvasID: "ordered", Status: "running"},
		{ID: "order-ordinary", UserID: "states", CanvasID: "ordered", Status: "running"},
	} {
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, expected := range []string{"order-a", "order-b", ""} {
		got, err := repo.CanvasAgentActivity("states", "ordered")
		if err != nil || (expected == "" && got != nil) || (expected != "" && (got == nil || got.RunID != expected)) {
			t.Fatalf("order: got=%+v want=%s err=%v", got, expected, err)
		}
		if expected != "" {
			if err := db.Where("id = ?", expected).Delete(&model.Task{}).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
}
