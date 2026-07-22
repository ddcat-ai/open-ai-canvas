package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type localRateEntry struct {
	started time.Time
	count   int
}

type runtimeCoordinator struct {
	redis      *redis.Client
	instanceID string
	localMu    sync.Mutex
	localRate  map[string]localRateEntry
}

var fixedWindowScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`)

var acquireSlotScript = redis.NewScript(`
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`)

func newRuntimeCoordinator(dialect string) (*runtimeCoordinator, error) {
	coordinator := &runtimeCoordinator{instanceID: newID(), localRate: map[string]localRateEntry{}}
	redisURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if redisURL == "" {
		if dialect == "postgres" {
			return coordinator, errors.New("PostgreSQL 多实例模式必须配置 REDIS_URL，用于限流、并发和熔断协调")
		}
		return coordinator, nil
	}
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return coordinator, fmt.Errorf("REDIS_URL 无效：%w", err)
	}
	coordinator.redis = redis.NewClient(options)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := coordinator.redis.Ping(ctx).Err(); err != nil {
		return coordinator, fmt.Errorf("Redis 不可用：%w", err)
	}
	return coordinator, nil
}

func (c *runtimeCoordinator) allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	if c.redis != nil {
		count, err := fixedWindowScript.Run(ctx, c.redis, []string{"canvas:rate:" + key}, window.Milliseconds()).Int64()
		return count <= int64(limit), err
	}
	c.localMu.Lock()
	defer c.localMu.Unlock()
	now := time.Now()
	entry := c.localRate[key]
	if entry.started.IsZero() || now.Sub(entry.started) >= window {
		c.localRate[key] = localRateEntry{started: now, count: 1}
		return true, nil
	}
	if entry.count >= limit {
		return false, nil
	}
	entry.count++
	c.localRate[key] = entry
	return true, nil
}

func (c *runtimeCoordinator) acquire(ctx context.Context, scope string, limit int, ttl time.Duration) (func(), bool, error) {
	if c.redis == nil {
		return func() {}, true, nil
	}
	// 有过期分数的有序集合避免实例崩溃后永久占槽，业务数据库仍保存任务与账本真相。
	key := "canvas:slots:" + scope
	token := c.instanceID + ":" + newID()
	now := time.Now()
	ok, err := acquireSlotScript.Run(ctx, c.redis, []string{key}, now.UnixMilli(), now.Add(ttl).UnixMilli(), limit, token, (ttl + time.Minute).Milliseconds()).Int()
	if err != nil || ok != 1 {
		return nil, false, err
	}
	return func() { _ = c.redis.ZRem(context.Background(), key, token).Err() }, true, nil
}

func (c *runtimeCoordinator) circuitOpen(ctx context.Context, channelID string) (bool, error) {
	if c.redis == nil || strings.TrimSpace(channelID) == "" {
		return false, nil
	}
	count, err := c.redis.Exists(ctx, "canvas:circuit:open:"+channelID).Result()
	return count > 0, err
}

func (c *runtimeCoordinator) recordChannelResult(ctx context.Context, channelID string, failed bool) {
	if c.redis == nil || strings.TrimSpace(channelID) == "" {
		return
	}
	failureKey := "canvas:circuit:failures:" + channelID
	openKey := "canvas:circuit:open:" + channelID
	if !failed {
		_ = c.redis.Del(ctx, failureKey, openKey).Err()
		return
	}
	count, err := c.redis.Incr(ctx, failureKey).Result()
	if err != nil {
		return
	}
	_ = c.redis.Expire(ctx, failureKey, time.Minute).Err()
	if count >= int64(envInt("CANVAS_CHANNEL_CIRCUIT_FAILURES", 5)) {
		_ = c.redis.Set(ctx, openKey, "1", time.Duration(envInt("CANVAS_CHANNEL_CIRCUIT_SECONDS", 60))*time.Second).Err()
	}
}

func envInt(key string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(key)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func (s *Service) ValidateRuntime() error {
	return s.runtimeErr
}

func (s *Service) AllowRequest(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	if s.coordinator == nil {
		return false, errors.New("运行时协调器未初始化")
	}
	return s.coordinator.allow(ctx, key, limit, window)
}
