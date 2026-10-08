package repository

import (
	"errors"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestClaimFailedTaskProviderRecoveryUsesConditionalLease(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-recovery-lease?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	if err := db.Create(&model.Task{ID: "task-1", UserID: "user-1", Status: model.TaskStatusFailed, CreatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}

	if err := repo.ClaimFailedTaskProviderRecovery("task-1", "", "manual-recovery:one", time.Minute); err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if err := repo.ClaimFailedTaskProviderRecovery("task-1", "", "manual-recovery:two", time.Minute); !errors.Is(err, ErrTaskProviderRecoveryConflict) {
		t.Fatalf("second claim error = %v, want conflict", err)
	}
	if err := repo.ReleaseTaskProviderRecovery("task-1", "manual-recovery:two"); err != nil {
		t.Fatal(err)
	}
	if err := repo.ReleaseTaskProviderRecovery("task-1", "manual-recovery:one"); err != nil {
		t.Fatal(err)
	}
	if err := repo.ClaimFailedTaskProviderRecovery("task-1", "user-1", "manual-recovery:two", time.Minute); err != nil {
		t.Fatalf("claim after release: %v", err)
	}

	var task model.Task
	if err := db.First(&task, "id = ?", "task-1").Error; err != nil {
		t.Fatal(err)
	}
	if task.LeaseOwner != "manual-recovery:two" || task.LeaseExpiresAt == nil {
		t.Fatalf("task lease = owner:%q expires:%v", task.LeaseOwner, task.LeaseExpiresAt)
	}
}

func TestClaimFailedTaskProviderRecoveryRejectsNonFailedTask(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:provider-recovery-status?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	if err := db.Create(&model.Task{ID: "task-1", UserID: "user-1", Status: model.TaskStatusRunning, CreatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.ClaimFailedTaskProviderRecovery("task-1", "user-1", "manual-recovery:one", time.Minute); !errors.Is(err, ErrTaskProviderRecoveryConflict) {
		t.Fatalf("claim running task error = %v, want conflict", err)
	}
}
