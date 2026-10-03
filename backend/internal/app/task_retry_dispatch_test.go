package app

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// forEachRetryDispatchDatabase 在 SQLite 与 PostgreSQL 上各跑一次；领取任务在 PostgreSQL 上走 SKIP LOCKED 分支。
func forEachRetryDispatchDatabase(t *testing.T, run func(t *testing.T, s *Service, db *gorm.DB)) {
	config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	t.Run("sqlite", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "retry.db")+"?_journal_mode=WAL&_busy_timeout=5000"), config)
		if err != nil {
			t.Fatal(err)
		}
		connection, _ := db.DB()
		t.Cleanup(func() { _ = connection.Close() })
		run(t, newRetryDispatchService(t, db), db)
	})
	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
		}
		admin, err := gorm.Open(postgres.Open(dsn), config)
		if err != nil {
			t.Fatal(err)
		}
		schema := fmt.Sprintf("task_retry_%d", time.Now().UnixNano())
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			_ = admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error
			connection, _ := admin.DB()
			_ = connection.Close()
		})
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		db, err := gorm.Open(postgres.Open(parsed.String()), config)
		if err != nil {
			t.Fatal(err)
		}
		connection, _ := db.DB()
		t.Cleanup(func() { _ = connection.Close() })
		run(t, newRetryDispatchService(t, db), db)
	})
}

func newRetryDispatchService(t *testing.T, db *gorm.DB) *Service {
	t.Helper()
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: t.TempDir()}
}

func claimOnlyTask(t *testing.T, s *Service, taskID string) *model.Task {
	t.Helper()
	claimed, err := s.repo.ClaimNextTask("worker-test", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.ID != taskID {
		t.Fatalf("claimed task = %+v, want %s", claimed, taskID)
	}
	return claimed
}

func expireTaskLease(t *testing.T, db *gorm.DB, taskID string) {
	t.Helper()
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Update("lease_expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
}

// 用户主动重试会开启新的路由世代，上一次执行留下的领取次数不能再被当成“可能已提交”。
func TestRetriedDirectTaskDispatchesAgain(t *testing.T) {
	forEachRetryDispatchDatabase(t, func(t *testing.T, s *Service, db *gorm.DB) {
		task := model.Task{ID: "retry-direct", UserID: "user", Type: "canvas_text", Operation: "text", Status: model.TaskStatusQueued, InputJSON: `{}`, RouteRun: 1}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}

		// 第一次执行：上游明确拒绝，任务失败。
		first, err := s.beginTaskRouteAttempt(claimOnlyTask(t, s, task.ID))
		if err != nil {
			t.Fatalf("first dispatch: %v", err)
		}
		if err := s.markRouteAttemptDispatching(first); err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.RouteAttempt{}).Where("id = ?", first.ID).Updates(map[string]any{"status": "failed", "dispatch_state": "rejected_no_job"}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusFailed, "lease_owner": "", "lease_expires_at": nil}).Error; err != nil {
			t.Fatal(err)
		}

		retried, err := s.RetryTask(task.UserID, task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if retried.RouteRun != 2 {
			t.Fatalf("retry route run = %d, want 2", retried.RouteRun)
		}

		reclaimed := claimOnlyTask(t, s, task.ID)
		second, err := s.beginTaskRouteAttempt(reclaimed)
		if err != nil {
			t.Fatalf("retried task was treated as an uncertain submission (attempts=%d): %v", reclaimed.Attempts, err)
		}
		if reclaimed.Attempts != 1 {
			t.Fatalf("attempts after retry and one claim = %d, want 1", reclaimed.Attempts)
		}
		if second.ID == first.ID || second.RouteRun != 2 || second.DispatchState != "not_sent" {
			t.Fatalf("retry attempt = %+v, want a new not_sent attempt in route run 2", second)
		}
		if err := s.markRouteAttemptDispatching(second); err != nil {
			t.Fatalf("retried task could not be dispatched: %v", err)
		}
	})
}

// 已进入提交阶段后崩溃（租约过期后被重新领取），仍须停止自动重发，不能因为重试会清零次数而放行。
func TestCrashAfterDispatchStillBlocksRedelivery(t *testing.T) {
	forEachRetryDispatchDatabase(t, func(t *testing.T, s *Service, db *gorm.DB) {
		task := model.Task{ID: "crash-direct", UserID: "user", Type: "canvas_text", Operation: "text", Status: model.TaskStatusQueued, InputJSON: `{}`, RouteRun: 1}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		attempt, err := s.beginTaskRouteAttempt(claimOnlyTask(t, s, task.ID))
		if err != nil {
			t.Fatal(err)
		}
		if err := s.markRouteAttemptDispatching(attempt); err != nil {
			t.Fatal(err)
		}

		expireTaskLease(t, db, task.ID)
		if _, err := s.beginTaskRouteAttempt(claimOnlyTask(t, s, task.ID)); err == nil || !isRouteDispatchUncertain(err) {
			t.Fatalf("recovered task after dispatch error = %v, want uncertain submission", err)
		}
		var count int64
		if err := db.Model(&model.RouteAttempt{}).Where("task_id = ?", task.ID).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("route attempts = %d, want the original attempt only", count)
		}
	})
}

// 没有提交记录的旧任务被领取过不止一次时，仍按原规则停止自动重发。
func TestLegacyReclaimedDirectTaskWithoutAttemptStaysBlocked(t *testing.T) {
	forEachRetryDispatchDatabase(t, func(t *testing.T, s *Service, db *gorm.DB) {
		task := model.Task{ID: "legacy-direct", UserID: "user", Type: "canvas_text", Operation: "text", Status: model.TaskStatusRunning, InputJSON: `{}`, RouteRun: 1, Attempts: 1, LeaseOwner: "old-worker"}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		expireTaskLease(t, db, task.ID)
		if _, err := s.beginTaskRouteAttempt(claimOnlyTask(t, s, task.ID)); err == nil || !isRouteDispatchUncertain(err) {
			t.Fatalf("legacy reclaimed task error = %v, want uncertain submission", err)
		}
	})
}
