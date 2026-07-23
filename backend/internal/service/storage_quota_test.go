package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestValidateStructuredStorageQuotaRejectsBytesAndCounts(t *testing.T) {
	policy := defaultRuntimePolicy().Resource
	usage := repository.UserStorageUsage{AssetBytes: megabytes(policy.StructuredDataMB) - 8, AssetCount: policy.AssetCount}
	if err := validateStructuredStorageQuotaWithPolicy(usage, "asset", false, 9, policy); err == nil {
		t.Fatal("validateStructuredStorageQuota() byte error = nil")
	}
	if err := validateStructuredStorageQuotaWithPolicy(usage, "asset", true, 0, policy); err == nil {
		t.Fatal("validateStructuredStorageQuota() count error = nil")
	}
}

func TestValidateStructuredStorageQuotaAllowsReplacementThatShrinksData(t *testing.T) {
	policy := defaultRuntimePolicy().Resource
	usage := repository.UserStorageUsage{AssetBytes: megabytes(policy.StructuredDataMB), AssetCount: policy.AssetCount}
	if err := validateStructuredStorageQuotaWithPolicy(usage, "asset", false, -1, policy); err != nil {
		t.Fatalf("validateStructuredStorageQuota() error = %v", err)
	}
}

func TestValidateTaskStorageQuotaRejectsHistoryGrowth(t *testing.T) {
	policy := defaultRuntimePolicy().Resource
	if err := validateTaskStorageQuotaWithPolicy(repository.UserStorageUsage{TaskCount: policy.TaskCount}, 0, policy); err == nil {
		t.Fatal("validateTaskStorageQuota() count error = nil")
	}
	if err := validateTaskStorageQuotaWithPolicy(repository.UserStorageUsage{TaskBytes: gigabytes(policy.TaskDataGB)}, 1, policy); err == nil {
		t.Fatal("validateTaskStorageQuota() byte error = nil")
	}
	if err := validateAPICallLogQuotaWithPolicy(repository.UserStorageUsage{APICallCount: policy.APICallLogCount}, 0, policy); err == nil {
		t.Fatal("validateAPICallLogQuota() count error = nil")
	}
}

func TestUserStorageUsageCountsPersistedPayloads(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.Asset{}, &model.CanvasProject{}, &model.Session{}, &model.Message{}, &model.Task{}, &model.TaskLog{}, &model.Result{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	items := []any{
		&model.Asset{ID: "asset-1", UserID: "user-1", PayloadJSON: "abcd"},
		&model.CanvasProject{ID: "canvas-1", UserID: "user-1", PayloadJSON: "xy"},
		&model.Session{ID: "session-1", UserID: "user-1", Prompt: "p", CanvasSnapshotJSON: "{}"},
		&model.Message{ID: "message-1", UserID: "user-1", SessionID: "session-1", Content: "hi", Payload: "z"},
		&model.Task{ID: "task-1", UserID: "user-1", Prompt: "p", InputJSON: "{}", ResultJSON: "{}"},
		&model.TaskLog{ID: "log-1", UserID: "user-1", TaskID: "task-1", Message: "m", Payload: "p"},
		&model.Result{ID: "result-1", UserID: "user-1", TaskID: "task-1", URL: "u", Payload: "r"},
		&model.ApiCallLog{ID: "api-log-1", UserID: "user-1", Path: "p", Model: "m", ProviderRequestID: "i", Error: "e", UpstreamURL: "u"},
	}
	for _, item := range items {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	usage, err := repository.New(db).UserStorageUsage("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if usage.AssetCount != 1 || usage.AssetBytes != 4 || usage.CanvasCount != 1 || usage.CanvasBytes != 2 || usage.SessionCount != 1 || usage.SessionBytes != 6 || usage.TaskCount != 1 || usage.TaskBytes != 14 || usage.APICallCount != 1 {
		t.Fatalf("UserStorageUsage() = %#v", usage)
	}
}

func TestSaveTaskCompletionPersistsRelatedRowsTogether(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.Asset{}, &model.CanvasProject{}, &model.Session{}, &model.Message{}, &model.Task{}, &model.TaskLog{}, &model.Result{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	session := model.Session{ID: "session-1", UserID: "user-1", Status: model.SessionStatusActive}
	task := model.Task{ID: "task-1", UserID: "user-1", SessionID: session.ID, Status: model.TaskStatusRunning, InputJSON: `{"mode":"text"}`}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	if err := svc.saveTaskCompletionWithinStorageQuota(&task, []byte(`{"ok":true}`), []byte(`[{"op":"add"}]`), true); err != nil {
		t.Fatal(err)
	}
	var messageCount int64
	var resultCount int64
	if err := db.Model(&model.Message{}).Count(&messageCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Result{}).Count(&resultCount).Error; err != nil {
		t.Fatal(err)
	}
	if task.Status != model.TaskStatusSucceeded || messageCount != 1 || resultCount != 2 {
		t.Fatalf("completion = status:%s messages:%d results:%d", task.Status, messageCount, resultCount)
	}
}
