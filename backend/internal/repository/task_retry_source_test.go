package repository

import (
	"encoding/json"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestRetryAdmissionKeepsOriginalTaskAndCharge(t *testing.T) {
	for _, tc := range []struct {
		name, owner, recovery string
		status                model.TaskStatus
		cancel                model.ProviderCancelStatus
		billing               model.BillingStatus
		allowed               bool
	}{
		{name: "running", status: model.TaskStatusRunning},
		{name: "queued", status: model.TaskStatusQueued},
		{name: "completed", status: model.TaskStatusSucceeded},
		{name: "saving", status: model.TaskStatusFailed, recovery: `{}`},
		{name: "foreign", status: model.TaskStatusFailed, owner: "other"},
		{name: "cancel pending", status: model.TaskStatusCancelled, cancel: model.ProviderCancelStatusRequested},
		{name: "billing pending", status: model.TaskStatusFailed, billing: model.BillingStatusReserved},
		{name: "refunded failure", status: model.TaskStatusFailed, billing: model.BillingStatusRefunded, allowed: true},
		{name: "settled cancellation", status: model.TaskStatusCancelled, billing: model.BillingStatusSettled, allowed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, _ := db.DB()
			t.Cleanup(func() { _ = sqlDB.Close() })
			if err := db.AutoMigrate(&model.User{}, &model.Task{}, &model.BillingOrder{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
				t.Fatal(err)
			}
			owner := tc.owner
			if owner == "" {
				owner = "user"
			}
			source := model.Task{ID: "source", UserID: owner, Status: tc.status, MediaRecoveryJSON: tc.recovery, ProviderCancelStatus: tc.cancel}
			if tc.billing != "" {
				source.BillingOrderID = "source-bill"
				if err := db.Create(&model.BillingOrder{ID: source.BillingOrderID, UserID: owner, TaskID: source.ID, Status: tc.billing}).Error; err != nil {
					t.Fatal(err)
				}
			}
			for _, row := range []any{&model.User{ID: "user", Username: "user", Status: model.UserStatusActive}, &source, &model.CreditAccount{UserID: "user", AvailableMicrocredits: 1000}} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			input, _ := json.Marshal(map[string]any{"metadata": map[string]string{"retryOf": source.ID}})
			task := model.Task{ID: "retry", UserID: "user", Type: "canvas_video", Status: model.TaskStatusQueued, InputJSON: string(input)}
			err = New(db).CreateTaskWithActiveLimit(&task, 20)
			if (err == nil) != tc.allowed {
				t.Fatalf("retry allowed=%v, want=%v: %v", err == nil, tc.allowed, err)
			}
			var count int64
			if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Count(&count).Error; err != nil || (count == 1) != tc.allowed {
				t.Fatalf("retry task persisted=%d, allowed=%v: %v", count, tc.allowed, err)
			}
			var account model.CreditAccount
			if err := db.First(&account, "user_id = ?", "user").Error; err != nil || account.AvailableMicrocredits != 1000 {
				t.Fatalf("status lookup/retry guard changed available credit: %+v, %v", account, err)
			}
		})
	}
}
