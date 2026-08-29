package repository

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDeferredProviderPollKeepsOriginalTaskIdentityWithoutImmediateReclaim(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-poll-defer?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{
		ID: "task-1", UserID: "user-1", Type: "canvas_video", Status: model.TaskStatusRunning,
		LeaseOwner: "worker-1", LeaseExpiresAt: ptrTime(time.Now().Add(time.Minute)), ProviderRequestID: "provider-task-1",
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	if err := repo.DeferRunningTaskForProviderPoll(task.ID, task.LeaseOwner, "后台仍在生成", time.Minute); err != nil {
		t.Fatal(err)
	}
	claimed, err := repo.ClaimNextTask("worker-2", 45*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if claimed != nil {
		t.Fatalf("task reclaimed before next poll: %#v", claimed)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("next_poll_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	claimed, err = repo.ClaimNextTask("worker-2", 45*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if claimed == nil || claimed.ID != task.ID || claimed.ProviderRequestID != task.ProviderRequestID {
		t.Fatalf("reclaimed task = %#v", claimed)
	}
}

func TestUpdateTaskProviderProgressIsMonotonic(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-progress?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "task-progress", UserID: "user-1", Type: "canvas_video", Status: model.TaskStatusRunning, Stage: "正在连接上游"}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	for _, progress := range []int{12, 48, 31, 76} {
		if err := repo.UpdateTaskProviderProgress(task.ID, progress); err != nil {
			t.Fatal(err)
		}
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Progress != 76 || stored.Stage != "上游生成中" {
		t.Fatalf("stored progress = %d, stage = %q", stored.Progress, stored.Stage)
	}
}

func ptrTime(value time.Time) *time.Time { return &value }
