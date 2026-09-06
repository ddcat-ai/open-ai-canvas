package repository

import (
	"errors"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func TestTaskLeaseFencesExpiredAndReclaimedWriters(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.Result{}, &model.Message{}, &model.Session{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "task", UserID: "user", Status: model.TaskStatusQueued}).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	old, err := repo.ClaimNextTask("worker:attempt-a", time.Minute)
	if err != nil || old == nil {
		t.Fatalf("claim: %v %v", old, err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", old.ID).Update("lease_expires_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.RenewTaskLease(old.ID, old.LeaseOwner, time.Minute); err == nil {
		t.Fatal("expired owner resurrected")
	}
	if err := repo.DeferRunningTaskForProviderPoll(old.ID, old.LeaseOwner, "poll", time.Minute); !errors.Is(err, ErrTaskStateConflict) {
		t.Fatalf("expired owner deferred task: %v", err)
	}
	current, err := repo.ClaimNextTask("worker:attempt-b", time.Minute)
	if err != nil || current == nil {
		t.Fatalf("reclaim: %v %v", current, err)
	}
	for _, owner := range []string{old.LeaseOwner, ""} {
		if err := repo.UpdateTaskProgressForLease(old.ID, owner, "stale", 90); !errors.Is(err, ErrTaskStateConflict) {
			t.Fatalf("stale progress: %v", err)
		}
		updated, err := repo.UpdateTaskTerminalState(old.ID, owner, model.TaskStatusRunning, model.TaskStatusFailed, "stale", "", time.Now())
		if err != nil || updated {
			t.Fatalf("stale terminal: %v %v", updated, err)
		}
	}
	old.Status = model.TaskStatusSucceeded
	if err := repo.SaveTaskCompletion(old, model.TaskStatusRunning, nil, &model.Message{ID: "stale"}, []model.Result{{ID: "stale"}}); !errors.Is(err, ErrTaskStateConflict) {
		t.Fatalf("stale completion: %v", err)
	}
	var count int64
	for _, table := range []any{&model.Result{}, &model.Message{}} {
		if err := db.Model(table).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("stale related row persisted: %d %v", count, err)
		}
	}
	if err := repo.RenewTaskLease(current.ID, current.LeaseOwner, time.Minute); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateTaskProgressForLease(current.ID, current.LeaseOwner, "current", 60); err != nil {
		t.Fatal(err)
	}
	current.Status = model.TaskStatusSucceeded
	if err := repo.SaveTaskCompletion(current, model.TaskStatusRunning, nil, nil, []model.Result{{ID: "valid", TaskID: current.ID}}); err != nil {
		t.Fatal(err)
	}
	stored, err := repo.Task(current.ID)
	if err != nil || stored.Status != model.TaskStatusSucceeded || stored.LeaseOwner != current.LeaseOwner {
		t.Fatalf("current completion: %v %v", stored, err)
	}
}
