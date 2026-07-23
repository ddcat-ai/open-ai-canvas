package service

import (
	"context"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRuntimeConcurrencySettingPersistsAndChannelOverrideWins(t *testing.T) {
	t.Setenv("REDIS_URL", "")
	t.Setenv("CANVAS_WORKER_CONCURRENCY", "3")
	t.Setenv("CANVAS_CHANNEL_CONCURRENCY", "3")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}, &model.ModelChannel{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	actor := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	policy := defaultRuntimePolicy()
	policy.Task.WorkerConcurrency = 8
	policy.Task.ChannelConcurrency = 6
	setting, err := svc.UpdateRuntimePolicySetting(actor, policy)
	if err != nil {
		t.Fatal(err)
	}
	if setting.Task.WorkerConcurrency != 8 || setting.Task.ChannelConcurrency != 6 {
		t.Fatalf("setting = %#v", setting)
	}

	channel := model.ModelChannel{ID: "channel-1", Scope: model.ChannelScopeSystem, Enabled: true, ConcurrencyLimit: 0}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	release, limit, err := svc.AcquireChannelSlot(context.Background(), channel.ID, "", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	release()
	if limit != 6 {
		t.Fatalf("global channel limit = %d, want 6", limit)
	}

	if err := db.Model(&channel).Update("concurrency_limit", 9).Error; err != nil {
		t.Fatal(err)
	}
	release, limit, err = svc.AcquireChannelSlot(context.Background(), channel.ID, "", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	release()
	if limit != 9 {
		t.Fatalf("overridden channel limit = %d, want 9", limit)
	}
}
