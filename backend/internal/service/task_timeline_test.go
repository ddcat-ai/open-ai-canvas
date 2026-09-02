package service

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/database"

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
	if err := db.AutoMigrate(database.Models()...); err != nil {
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

func seedResource(t *testing.T, db *gorm.DB, id string, userID string, mime string) {
	t.Helper()
	if err := db.Create(&model.Resource{ID: id, UserID: userID, Kind: "media", Status: model.ResourceStatusReady, Provider: "local", MimeType: mime, Size: 1024}).Error; err != nil {
		t.Fatalf("seed resource: %v", err)
	}
}

func TestCreateTimelineTranscriptionTaskQueues(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	seedResource(t, db, "res-video-1", "usr-create-test", "video/mp4")

	task, err := svc.CreateTimelineTranscriptionTask("usr-create-test", TimelineTranscriptionCreateRequest{ResourceID: "res-video-1", Language: "zh", ProjectID: "prj-1"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if task.Type != model.TaskTypeTimelineTranscription {
		t.Fatalf("type = %q, want timeline_transcription", task.Type)
	}
	if task.Status != model.TaskStatusQueued {
		t.Fatalf("status = %q, want queued", task.Status)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load task: %v", err)
	}
	if stored.UserID != "usr-create-test" || stored.ProjectID != "prj-1" {
		t.Fatalf("owner/project mismatch: %q / %q", stored.UserID, stored.ProjectID)
	}
	if stored.Provider != "local" || stored.Model != "whisper.cpp" {
		t.Fatalf("provider/model = %q/%q, want local/whisper.cpp", stored.Provider, stored.Model)
	}
}

func TestCreateTimelineTranscriptionTaskRejectsForeignResource(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	seedResource(t, db, "res-owner-a", "usr-a", "video/mp4")

	_, err := svc.CreateTimelineTranscriptionTask("usr-b", TimelineTranscriptionCreateRequest{ResourceID: "res-owner-a"})
	if err == nil || !strings.Contains(err.Error(), "媒体") {
		t.Fatalf("want 无法读取待转写媒体 error, got %v", err)
	}
	// 另一用户自己的音视频资源可正常创建。
	seedResource(t, db, "res-b", "usr-b", "audio/mpeg")
	if _, err := svc.CreateTimelineTranscriptionTask("usr-b", TimelineTranscriptionCreateRequest{ResourceID: "res-b"}); err != nil {
		t.Fatalf("own audio resource should create: %v", err)
	}
}

func TestCreateTimelineTranscriptionTaskRejectsNonTranscribable(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	seedResource(t, db, "res-img", "usr-img", "image/png")

	_, err := svc.CreateTimelineTranscriptionTask("usr-img", TimelineTranscriptionCreateRequest{ResourceID: "res-img"})
	if err == nil || !strings.Contains(err.Error(), "音视频") {
		t.Fatalf("want 仅支持音视频 error, got %v", err)
	}
}
