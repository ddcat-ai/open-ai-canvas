package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRuntimePolicyDefaultsAndSelfUseModeValidate(t *testing.T) {
	if err := validateRuntimePolicy(defaultRuntimePolicy()); err != nil {
		t.Fatalf("default runtime policy error = %v", err)
	}
	selfUse := selfUseRuntimePolicy()
	if err := validateRuntimePolicy(selfUse); err != nil {
		t.Fatalf("self-use runtime policy error = %v", err)
	}
	if selfUse.Task.WorkerConcurrency != 999 || selfUse.Resource.ResourceUploadMB != 999 {
		t.Fatalf("self-use maxima = worker %d, upload %d", selfUse.Task.WorkerConcurrency, selfUse.Resource.ResourceUploadMB)
	}
}

func TestRuntimePolicyRejectsSingleFileAboveAccountCapacity(t *testing.T) {
	policy := defaultRuntimePolicy()
	policy.Resource.StoredFileGB = 1
	policy.Resource.ResourceUploadMB = 999
	if err := validateRuntimePolicy(policy); err != nil {
		t.Fatalf("999MB should fit in 1GB: %v", err)
	}
	policy.Resource.StoredFileGB = 0
	if err := validateRuntimePolicy(policy); err == nil {
		t.Fatal("zero account capacity should be rejected")
	}
}

func TestRuntimePolicySaveAndResetTakeEffectImmediately(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	actor := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	policy := defaultRuntimePolicy()
	policy.Task.ActiveTaskLimit = 17
	if _, err := svc.UpdateRuntimePolicySetting(actor, policy); err != nil {
		t.Fatal(err)
	}
	effective, err := svc.RuntimePolicy()
	if err != nil || effective.Task.ActiveTaskLimit != 17 {
		t.Fatalf("effective active task limit = %d, error = %v", effective.Task.ActiveTaskLimit, err)
	}
	if _, err := svc.ResetRuntimePolicySetting(actor); err != nil {
		t.Fatal(err)
	}
	effective, err = svc.RuntimePolicy()
	if err != nil || effective.Task.ActiveTaskLimit != 5 {
		t.Fatalf("reset active task limit = %d, error = %v", effective.Task.ActiveTaskLimit, err)
	}
}
