package service

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCachedTextReplayIsolatesUsersCursorsAndCopies(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.TaskTextDelta{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "task", UserID: "user", Type: "canvas_text", Status: model.TaskStatusRunning}).Error; err != nil {
		t.Fatal(err)
	}
	for i, content := range []string{"one", "two"} {
		if err := db.Create(&model.TaskTextDelta{ID: content, UserID: "user", TaskID: "task", Sequence: int64(i + 1), Content: content, ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := &Service{repo: repository.New(db)}
	var queries atomic.Int32
	if err := db.Callback().Query().Before("gorm:query").Register("cache-count", func(*gorm.DB) { queries.Add(1) }); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			result, err := svc.CachedTaskTextReplay(context.Background(), "user", "task", 0)
			if err != nil {
				t.Error(err)
				return
			}
			if len(result.Deltas) != 2 || result.Deltas[0].Content != "one" {
				t.Errorf("unexpected replay: %#v", result)
				return
			}
			result.Deltas[0].Content = "caller mutation"
		}()
	}
	wg.Wait()
	if queries.Load() != 2 {
		t.Fatalf("expected one task+delta query, got %d queries", queries.Load())
	}
	if _, err := svc.CachedTaskTextReplay(context.Background(), "other", "task", 0); err == nil {
		t.Fatal("cross-user cache leak")
	}
	result, err := svc.CachedTaskTextReplay(context.Background(), "user", "task", 1)
	if err != nil || len(result.Deltas) != 1 || result.Deltas[0].Sequence != 2 {
		t.Fatalf("cursor isolation: %#v %v", result, err)
	}
	svc.textReplayReadCache.clear()
	if err := db.Model(&model.Task{}).Where("id = ?", "task").Update("status", model.TaskStatusSucceeded).Error; err != nil {
		t.Fatal(err)
	}
	result, err = svc.CachedTaskTextReplay(context.Background(), "user", "task", 0)
	if err != nil || !result.Complete {
		t.Fatalf("terminal refresh: %#v %v", result, err)
	}
}

func TestRuntimeConcurrencyCacheDoesNotCacheAuthoritativePolicy(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	actor := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	var queries atomic.Int32
	if err := db.Callback().Query().Before("gorm:query").Register("policy-count", func(*gorm.DB) { queries.Add(1) }); err != nil {
		t.Fatal(err)
	}
	for range 20 {
		if _, err := svc.runtimeConcurrencySetting(); err != nil {
			t.Fatal(err)
		}
	}
	if queries.Load() != 1 {
		t.Fatalf("concurrency reads hit DB %d times", queries.Load())
	}
	before := queries.Load()
	for range 2 {
		if _, err := svc.RuntimePolicy(); err != nil {
			t.Fatal(err)
		}
	}
	if queries.Load() != before+2 {
		t.Fatal("authoritative policy incorrectly cached")
	}
	policy := defaultRuntimePolicy()
	policy.Task.WorkerConcurrency = 7
	if _, err := svc.UpdateRuntimePolicySetting(actor, policy); err != nil {
		t.Fatal(err)
	}
	setting, err := svc.runtimeConcurrencySetting()
	if err != nil || setting.WorkerConcurrency != 7 {
		t.Fatalf("save did not invalidate: %#v %v", setting, err)
	}
	if _, err := svc.ResetRuntimePolicySetting(actor); err != nil {
		t.Fatal(err)
	}
	setting, err = svc.runtimeConcurrencySetting()
	if err != nil || setting.WorkerConcurrency != defaultRuntimePolicy().Task.WorkerConcurrency {
		t.Fatalf("reset did not invalidate: %#v %v", setting, err)
	}
}

func TestRouteCatalogFailureStormAndInvalidatedStaleSnapshot(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	wantErr := errors.New("injected database outage")
	var queries atomic.Int32
	if err := db.Callback().Query().Before("gorm:query").Register("catalog-outage", func(tx *gorm.DB) { queries.Add(1); tx.AddError(wantErr) }); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), routeCatalogTTL: time.Second, routeCatalogMaxStale: time.Minute}
	var wg sync.WaitGroup
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.routeCatalogSnapshot(); !errors.Is(err, wantErr) {
				t.Errorf("outage error lost: %v", err)
			}
		}()
	}
	wg.Wait()
	if queries.Load() != 1 {
		t.Fatalf("failure storm retried DB %d times", queries.Load())
	}
	svc.routeCatalog = &routeCatalogSnapshot{LoadedAt: time.Now().Add(-2 * time.Second), CatalogVersion: 0}
	if _, err := svc.routeCatalogSnapshot(); err != nil {
		t.Fatalf("existing same-version bounded fallback lost: %v", err)
	}
	svc.routeCatalogVersion = 1
	if _, err := svc.routeCatalogSnapshot(); !errors.Is(err, wantErr) {
		t.Fatal("explicitly invalidated version was served stale")
	}
	svc.invalidateRouteCatalog()
	if _, err := svc.routeCatalogSnapshot(); !errors.Is(err, wantErr) {
		t.Fatal(err)
	}
	if queries.Load() != 2 {
		t.Fatal("invalidation failed to reset refresh cooldown")
	}
}
