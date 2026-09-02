package service

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func newTimelineTaskTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	// 每个测试独立的 sqlite 内存库，避免共享缓存串库。
	dsn := fmt.Sprintf("file:%s_%d?mode=memory&cache=shared", t.Name(), time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	t.Helper()
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.TaskLog{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return &Service{repo: repository.New(db)}, db
}

func seedRunningTimelineTask(t *testing.T, db *gorm.DB, inputJSON string) *model.Task {
	t.Helper()
	task := &model.Task{
		ID:        fmt.Sprintf("tsk-timeline-%d", time.Now().UnixNano()),
		UserID:    "usr-timeline-test",
		Type:      model.TaskTypeTimelineTranscription,
		Status:    model.TaskStatusRunning,
		Stage:     "已领取",
		InputJSON: inputJSON,
	}
	if err := db.Create(task).Error; err != nil {
		t.Fatalf("seed task: %v", err)
	}
	return task
}

func TestTimelineTranscriptionFailsFastWhenWhisperUnconfigured(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	task := seedRunningTimelineTask(t, db, `{"resourceId":"res-1","language":""}`)
	w := newTaskWorkerCoordinator(svc)

	t.Setenv(whisperLangEnv, "")
	err := w.processTimelineTranscription(task, context.Background())
	if err != nil {
		t.Fatalf("process: want nil (task terminal handled internally), got %v", err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load task: %v", err)
	}
	if stored.Status != model.TaskStatusFailed {
		t.Fatalf("status = %q, want failed", stored.Status)
	}
	if !strings.Contains(stored.Error, "CANVAS_WHISPER_BASE_URL") {
		t.Fatalf("error = %q, want mention of CANVAS_WHISPER_BASE_URL", stored.Error)
	}
}

func TestTimelineTranscriptionRejectsMissingResourceRef(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	task := seedRunningTimelineTask(t, db, `{"resourceId":"  "}`)
	w := newTaskWorkerCoordinator(svc)

	t.Setenv(whisperLangEnv, "http://127.0.0.1:9999")
	err := w.processTimelineTranscription(task, context.Background())
	if err != nil {
		t.Fatalf("process: want nil (task terminal handled internally), got %v", err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load task: %v", err)
	}
	if stored.Status != model.TaskStatusFailed {
		t.Fatalf("status = %q, want failed", stored.Status)
	}
	if !strings.Contains(stored.Error, "资源引用") {
		t.Fatalf("error = %q, want mention of 资源引用", stored.Error)
	}
}
