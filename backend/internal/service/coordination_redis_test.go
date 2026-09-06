package service

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// 只运行临时 Unix socket Redis，不读取 REDIS_URL，不连接部署环境。
func TestRuntimeCoordinatorRedisLeasePreservesLongestTTL(t *testing.T) {
	binary, err := exec.LookPath("redis-server")
	if err != nil {
		t.Skip("redis-server unavailable; real Redis lease integration not run")
	}
	// macOS 的 Unix socket 路径有长度限制，不使用包含长测试名的 t.TempDir。
	dir, err := os.MkdirTemp("", "canvas-redis-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "r.sock")
	cmd := exec.Command(binary, "--port", "0", "--unixsocket", socket, "--unixsocketperm", "700", "--save", "", "--appendonly", "no", "--dir", dir)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
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
	c := &runtimeCoordinator{redis: client, instanceID: "isolated-test"}
	long, ok, err := c.acquireLease(ctx, "workers", 2, 45*time.Minute)
	if err != nil || !ok {
		t.Fatalf("legacy lease: %v %v", ok, err)
	}
	defer long.release()
	short, ok, err := c.acquireLease(ctx, "workers", 2, time.Minute)
	if err != nil || !ok {
		t.Fatalf("new lease: %v %v", ok, err)
	}
	defer short.release()
	key := "canvas:slots:workers"
	assertLongestTTL := func() {
		t.Helper()
		ttl, err := client.PTTL(ctx, key).Result()
		if err != nil || ttl < 44*time.Minute {
			t.Fatalf("short lease truncated shared key TTL: %s %v", ttl, err)
		}
	}
	assertLongestTTL()
	if err := short.renew(ctx); err != nil {
		t.Fatal(err)
	}
	assertLongestTTL()
	if _, ok, err := c.acquireLease(ctx, "workers", 2, time.Minute); err != nil || ok {
		t.Fatalf("global capacity exceeded: %v %v", ok, err)
	}
	if err := client.ZAdd(ctx, key, redis.Z{Score: float64(time.Now().Add(-time.Second).UnixMilli()), Member: short.token}).Err(); err != nil {
		t.Fatal(err)
	}
	if err := short.renew(ctx); err == nil {
		t.Fatal("expired Redis lease resurrected")
	}
	replacement, ok, err := c.acquireLease(ctx, "workers", 2, time.Minute)
	if err != nil || !ok {
		t.Fatalf("abandoned slot not reclaimed: %v %v", ok, err)
	}
	defer replacement.release()
	short.release()
	short.release()
	if err := replacement.renew(ctx); err != nil {
		t.Fatalf("old release removed new owner: %v", err)
	}
	assertLongestTTL()
}
