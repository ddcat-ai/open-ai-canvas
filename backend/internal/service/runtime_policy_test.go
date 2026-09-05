package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestVideoTaskTimeoutHasFiveMinuteSafetyFloor(t *testing.T) {
	policy := defaultRuntimePolicy().Task
	policy.VideoTimeoutMinutes = 1
	policy.ImageTimeoutMinutes = 1
	if got := taskExecutionTimeoutWithPolicy("canvas_video", policy); got != 5*time.Minute {
		t.Fatalf("video timeout = %s, want 5m", got)
	}
	if got := taskExecutionTimeoutWithPolicy("canvas_image", policy); got != time.Minute {
		t.Fatalf("image timeout = %s, want 1m", got)
	}
}

func TestOnlyResumableNewAPIChannel2VideoDeadlinesStayRunning(t *testing.T) {
	svc := &Service{}
	input, err := json.Marshal(canvasGenerationInput{Mode: "video", Config: providerConfig{BaseURL: "https://example.com", InterfaceType: string(model.ChannelInterfaceNewAPIChannel2)}})
	if err != nil {
		t.Fatal(err)
	}
	base := model.Task{ID: "task-1", Type: "canvas_video", ProviderRequestID: "provider-task-1"}
	if !svc.shouldDeferVideoProviderTask(base, string(input), context.DeadlineExceeded) {
		t.Fatal("resumable NewAPI Channel 2 deadline should remain running")
	}
	pendingErr := providerStatePendingError{TaskID: base.ProviderRequestID, Cause: providerHTTPError{StatusCode: 400, Body: `{"code":"task_not_exist"}`}}
	if !svc.shouldDeferVideoProviderTask(base, string(input), pendingErr) {
		t.Fatal("resumable NewAPI Channel 2 provider sync delay should remain running")
	}
	if svc.shouldDeferVideoProviderTask(model.Task{ID: "task-2", Type: "canvas_video"}, string(input), context.DeadlineExceeded) {
		t.Fatal("missing provider task id must not be deferred")
	}
	if svc.shouldDeferVideoProviderTask(model.Task{ID: "task-2", Type: "canvas_video"}, string(input), pendingErr) {
		t.Fatal("provider sync delay without persisted provider task id must not be deferred")
	}
	if svc.shouldDeferVideoProviderTask(base, string(input), context.Canceled) {
		t.Fatal("explicit cancellation must not be deferred")
	}
	if svc.shouldDeferVideoProviderTask(base, string(input), providerHTTPError{StatusCode: 400, Body: `{"code":"task_not_exist"}`}) {
		t.Fatal("untyped provider error must not be deferred")
	}
	other, err := json.Marshal(canvasGenerationInput{Mode: "video", Config: providerConfig{BaseURL: "https://example.com", InterfaceType: string(model.ChannelInterfaceNewAPIVideo)}})
	if err != nil {
		t.Fatal(err)
	}
	if svc.shouldDeferVideoProviderTask(base, string(other), context.DeadlineExceeded) {
		t.Fatal("providers without a verified query-only resume contract must fail closed")
	}
}

func TestResumableVideoDeadlineUsesResolvedSystemChannelProtocol(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}); err != nil {
		t.Fatal(err)
	}
	channel := model.ModelChannel{
		ID: "channel-video", UserID: "admin", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Video",
		BaseURL: "https://example.com", APIKey: "test-key", APIFormat: "openai", ModelsJSON: `["video-model"]`,
	}
	channelModel := model.ChannelModel{
		ID: "model-video", ChannelID: channel.ID, ModelKey: "video-model", Capability: "video",
		Protocol: model.ChannelInterfaceNewAPIChannel2, Enabled: true, PriceConfigured: true,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	input, err := json.Marshal(canvasGenerationInput{Mode: "video", Config: providerConfig{ChannelID: channel.ID, Model: "video-model"}})
	if err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	task := model.Task{ID: "task-system", Type: "canvas_video", ProviderRequestID: "provider-task-1"}
	if !svc.shouldDeferVideoProviderTask(task, string(input), context.DeadlineExceeded) {
		t.Fatal("system-channel task must use the resolved model protocol when deciding query-only recovery")
	}
}

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

func TestRuntimePolicyBackfillsRecycleBinRetentionForLegacyJSON(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	legacy := defaultRuntimePolicy()
	encoded, err := json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(encoded, &value); err != nil {
		t.Fatal(err)
	}
	resource := value["resource"].(map[string]any)
	delete(resource, "recycleBinRetentionDays")
	encoded, err = json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: runtimePolicySettingKey, ValueJSON: string(encoded), UpdatedBy: "admin"}).Error; err != nil {
		t.Fatal(err)
	}

	policy, err := New(repository.New(db), t.TempDir()).RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	if policy.Resource.RecycleBinRetentionDays != 30 {
		t.Fatalf("legacy recycle bin retention = %d, want 30", policy.Resource.RecycleBinRetentionDays)
	}
}
