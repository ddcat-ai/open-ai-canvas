package repository

import (
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

func TestCanvasAgentAdmissionAcrossConnections(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "agent-admission.db") + "?_journal_mode=WAL&_busy_timeout=5000"
	open := func() *Repository {
		db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = sqlDB.Close() })
		return New(db)
	}
	a, b := open(), open()
	testCanvasAgentAdmissionAcrossConnections(t, a, b)
}

func testCanvasAgentAdmissionAcrossConnections(t *testing.T, a, b *Repository) {
	t.Helper()
	if err := a.db.AutoMigrate(&model.CanvasProject{}, &model.Task{}, &model.CloudAgentExecution{}); err != nil {
		t.Fatal(err)
	}
	if err := a.db.Create(&model.CanvasProject{ID: "canvas", UserID: "user", Revision: 7}).Error; err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i, repo := range []*Repository{a, b} {
		wg.Add(1)
		go func(i int, repo *Repository) {
			defer wg.Done()
			<-start
			results <- repo.CreateTaskWithActiveLimit(&model.Task{ID: fmt.Sprintf("run-%d", i), UserID: "user", ProjectID: "canvas", Operation: "cloud_agent", Status: model.TaskStatusTextReplay}, 100)
		}(i, repo)
	}
	close(start)
	wg.Wait()
	close(results)
	accepted, rejected := 0, 0
	for err := range results {
		switch {
		case err == nil:
			accepted++
		case errors.Is(err, ErrCanvasAgentBusy):
			rejected++
		default:
			t.Fatalf("unexpected admission error: %v", err)
		}
	}
	if accepted != 1 || rejected != 1 {
		t.Fatalf("accepted=%d rejected=%d", accepted, rejected)
	}
	var count int64
	if err := a.db.Model(&model.Task{}).Where("user_id = ? AND project_id = ?", "user", "canvas").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("root count=%d err=%v", count, err)
	}
	project, err := a.CanvasProjectMetadata("user", "canvas")
	if err != nil || project.Revision != 7 {
		t.Fatalf("admission changed canvas revision: %+v err=%v", project, err)
	}
	activity, err := b.CanvasAgentActivity("user", "canvas")
	if err != nil || activity == nil || activity.Status != "queued" {
		t.Fatalf("missing checkpoint did not reserve canvas: %+v err=%v", activity, err)
	}
	if err := b.CreateTaskWithActiveLimit(&model.Task{ID: "ordinary", UserID: "user", ProjectID: "canvas", Operation: "generate", Status: model.TaskStatusQueued}, 100); err != nil {
		t.Fatalf("ordinary generation blocked: %v", err)
	}
	if err := b.db.Create(&model.CanvasProject{ID: "other-canvas", UserID: "user"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := b.CreateTaskWithActiveLimit(&model.Task{ID: "other-agent", UserID: "user", ProjectID: "other-canvas", Operation: "cloud_agent", Status: model.TaskStatusTextReplay}, 100); err != nil {
		t.Fatalf("different canvas blocked: %v", err)
	}
}
