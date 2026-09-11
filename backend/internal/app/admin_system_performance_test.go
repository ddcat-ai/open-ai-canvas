package app

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/repository"

	"github.com/redis/go-redis/v9"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAdminSystemPerformanceRequiresAdmin(t *testing.T) {
	svc := &Service{}
	user := &model.User{ID: "user-1", Role: model.UserRoleUser}

	if _, err := svc.AdminSystemPerformance(context.Background(), user); authStatus(err) != 403 {
		t.Fatalf("AdminSystemPerformance() error = %#v, want 403", err)
	}
	if _, err := svc.ClearAdminRuntimeCache(context.Background(), user, AdminCacheClearRequest{Scope: "runtime"}); authStatus(err) != 403 {
		t.Fatalf("ClearAdminRuntimeCache() error = %#v, want 403", err)
	}
	if _, err := svc.AdminSystemPerformance(context.Background(), nil); authStatus(err) != 401 {
		t.Fatalf("AdminSystemPerformance(nil) error = %#v, want 401", err)
	}
}

func TestAdminSystemPerformanceReportsSQLiteWithoutRedis(t *testing.T) {
	svc, db := newSystemPerformanceTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}

	result, err := svc.AdminSystemPerformance(context.Background(), admin)
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "healthy" {
		t.Fatalf("status = %q, want healthy", result.Status)
	}
	if result.Database.Driver != "sqlite" || !result.Database.Connected || result.Database.Postgres != nil {
		t.Fatalf("database = %#v", result.Database)
	}
	if result.Database.DatabaseBytes <= 0 {
		t.Fatalf("database bytes = %d, want > 0", result.Database.DatabaseBytes)
	}
	if result.Database.Schema.Expected != database.CurrentSchemaVersion {
		t.Fatalf("schema = %#v", result.Database.Schema)
	}
	if result.Redis.Configured || result.Redis.Connected || result.Redis.Mode != "local" {
		t.Fatalf("redis = %#v", result.Redis)
	}
	if len(result.Redis.CacheGroups) != 1 || result.Redis.CacheGroups[0].ID != "rateLimits" {
		t.Fatalf("cache groups = %#v", result.Redis.CacheGroups)
	}
	if !result.Disk.Available || !result.Disk.Writable {
		t.Fatalf("disk = %#v", result.Disk)
	}
	if result.Host.CPUCores < 1 || result.Host.GOMAXPROCS < 1 || result.Host.ProcessID < 1 {
		t.Fatalf("host = %#v", result.Host)
	}

	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if stats := sqlDB.Stats(); result.Database.Pool.OpenConnections != stats.OpenConnections {
		t.Fatalf("pool open connections = %d, want %d", result.Database.Pool.OpenConnections, stats.OpenConnections)
	}
}

func TestClearAdminRuntimeCacheRejectsUnknownScopeAndAuditsLocalClear(t *testing.T) {
	svc, db := newSystemPerformanceTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	if ok, err := svc.coordinator.Allow(context.Background(), "user-1", 10, time.Hour); err != nil || !ok {
		t.Fatalf("seed local rate cache: ok=%v err=%v", ok, err)
	}

	if _, err := svc.ClearAdminRuntimeCache(context.Background(), admin, AdminCacheClearRequest{Scope: "all"}); authStatus(err) != 400 {
		t.Fatalf("unknown scope error = %#v, want 400", err)
	}
	if svc.coordinator.LocalRateCount() != 1 {
		t.Fatal("invalid scope changed local runtime cache")
	}

	svc.initReadCaches()
	if _, err := svc.routeVersionReadCache.Get(context.Background(), "route-version", func(context.Context) (int64, int, error) {
		return 7, 256, nil
	}); err != nil {
		t.Fatal(err)
	}
	svc.routeHealthBlocked["route-1"] = time.Now().Add(time.Minute)
	svc.routeCatalog = &routeCatalogSnapshot{}
	svc.routeCatalogRetryAt = time.Now().Add(time.Minute)
	svc.routeCatalogRefreshError = errors.New("cached refresh failure")

	result, err := svc.ClearAdminRuntimeCache(context.Background(), admin, AdminCacheClearRequest{Scope: "runtime"})
	if err != nil {
		t.Fatal(err)
	}
	if result.DeletedKeys != 1 || svc.coordinator.LocalRateCount() != 0 {
		t.Fatalf("local clear result = %#v, remaining = %d", result, svc.coordinator.LocalRateCount())
	}
	if result.MemoryEntries != 3 {
		t.Fatalf("memory entries = %d, want 3", result.MemoryEntries)
	}
	if svc.routeCatalog != nil || !svc.routeCatalogRetryAt.IsZero() || svc.routeCatalogRefreshError != nil || len(svc.routeHealthBlocked) != 0 {
		t.Fatalf("route caches were not reset")
	}
	var audit model.AdminAuditEvent
	if err := db.Where("action = ?", "system.runtime_cache.clear").First(&audit).Error; err != nil {
		t.Fatal(err)
	}
	if audit.ActorUserID != admin.ID || audit.TargetID != "runtime-cache" {
		t.Fatalf("audit = %#v", audit)
	}
}

func TestClearAdminRuntimeCacheUsesRedisWhitelist(t *testing.T) {
	client := startSystemPerformanceRedis(t)
	svc, db := newSystemPerformanceTestService(t)
	svc.coordinator = platform.NewCoordinatorWithRedis(client, "system-performance-test")
	admin := &model.User{ID: "admin-redis", Role: model.UserRoleAdmin}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	clearable := []string{
		"canvas:rate:user-1",
		"canvas:circuit:failures:channel-1",
		"canvas:circuit:open:channel-1",
		"canvas:logical-route-health:route-1",
	}
	preserved := []string{
		"canvas:slots:channel:channel-1",
		"canvas:logical-model-route-catalog:version",
		"canvas:task:task-1",
	}
	for _, key := range append(append([]string{}, clearable...), preserved...) {
		if err := client.Set(ctx, key, "1", 0).Err(); err != nil {
			t.Fatal(err)
		}
	}

	before := svc.collectRedisPerformance(ctx)
	if !before.Configured || !before.Connected || before.Mode != "redis" || before.Keys != int64(len(clearable)+len(preserved)) {
		t.Fatalf("redis performance = %#v", before)
	}

	result, err := svc.ClearAdminRuntimeCache(ctx, admin, AdminCacheClearRequest{Scope: "runtime"})
	if err != nil {
		t.Fatal(err)
	}
	if result.DeletedKeys != int64(len(clearable)) || len(result.Groups) != len(runtimeCacheDefinitions) {
		t.Fatalf("clear result = %#v", result)
	}
	if remaining, err := client.Exists(ctx, clearable...).Result(); err != nil || remaining != 0 {
		t.Fatalf("clearable keys remaining = %d, err = %v", remaining, err)
	}
	if remaining, err := client.Exists(ctx, preserved...).Result(); err != nil || remaining != int64(len(preserved)) {
		t.Fatalf("preserved keys remaining = %d, err = %v", remaining, err)
	}
	var auditCount int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ?", "system.runtime_cache.clear").Count(&auditCount).Error; err != nil {
		t.Fatal(err)
	}
	if auditCount != 1 {
		t.Fatalf("audit count = %d, want 1", auditCount)
	}
}

func newSystemPerformanceTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	dataDir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dataDir, "system-performance.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	return &Service{
		repo:                 repository.New(db),
		dataDir:              dataDir,
		coordinator:          platform.NewCoordinatorWithRedis(nil, "local-test"),
		routeCatalogTTL:      30 * time.Second,
		routeCatalogMaxStale: 5 * time.Minute,
		routeHealthBlocked:   map[string]time.Time{},
	}, db
}

func startSystemPerformanceRedis(t *testing.T) *redis.Client {
	t.Helper()
	binary, err := exec.LookPath("redis-server")
	if err != nil {
		t.Skip("redis-server unavailable; Redis cache whitelist integration not run")
	}
	dir, err := os.MkdirTemp("", "canvas-performance-redis-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "r.sock")
	cmd := exec.Command(binary, "--port", "0", "--unixsocket", socket, "--unixsocketperm", "700", "--save", "", "--appendonly", "no", "--dir", dir)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
	})
	client := redis.NewClient(&redis.Options{Network: "unix", Addr: socket, MaxRetries: -1, ContextTimeoutEnabled: true})
	t.Cleanup(func() { _ = client.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for client.Ping(ctx).Err() != nil {
		if ctx.Err() != nil {
			t.Fatal("temporary Redis did not start")
		}
		time.Sleep(20 * time.Millisecond)
	}
	return client
}

func authStatus(err error) int {
	var authErr *AuthError
	if errors.As(err, &authErr) {
		return authErr.Status
	}
	return 0
}
