package repository

import (
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestClaimTaskProviderCancellationOnlySucceedsOnce(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-cancel-claim?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "task-1", UserID: "user-1", Status: model.TaskStatusCancelled}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}

	repo := New(db)
	if err := repo.ClaimTaskProviderCancellation(task.UserID, task.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := repo.ClaimTaskProviderCancellation(task.UserID, task.ID, time.Now()); !errors.Is(err, ErrTaskProviderCancellationConflict) {
		t.Fatalf("expected cancellation claim conflict, got %v", err)
	}
	stored, err := repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.ProviderCancelStatus != model.ProviderCancelStatusRequested || stored.ProviderCancelAttempts != 1 {
		t.Fatalf("unexpected cancellation state: status=%s attempts=%d", stored.ProviderCancelStatus, stored.ProviderCancelAttempts)
	}
}
