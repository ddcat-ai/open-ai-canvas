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

const (
	minChannelConcurrencyLimit     = 1
	maxChannelConcurrencyLimit     = 100
	defaultChannelConcurrencyValue = 3
)

type channelSlotError struct {
	scope string
	limit int
	err   error
}

func (e channelSlotError) Error() string {
	if errors.Is(e.err, context.DeadlineExceeded) {
		return fmt.Sprintf("等待渠道并发槽位超时（渠道 %s，并发上限 %d）", e.scope, e.limit)
	}
	if errors.Is(e.err, context.Canceled) {
		return fmt.Sprintf("等待渠道并发槽位已取消（渠道 %s，并发上限 %d）", e.scope, e.limit)
	}
	return fmt.Sprintf("获取渠道并发配额失败（渠道 %s，并发上限 %d）：%v", e.scope, e.limit, e.err)
}

func (e channelSlotError) Unwrap() error { return e.err }

func ChannelSlotFailureDetails(err error) (string, string) {
	var slotErr channelSlotError
	if !errors.As(err, &slotErr) {
		return "", ""
	}
	if errors.Is(slotErr, context.DeadlineExceeded) {
		return "channel_concurrency_wait_timeout", slotErr.Error()
	}
	if errors.Is(slotErr, context.Canceled) {
		return "channel_concurrency_wait_cancelled", slotErr.Error()
	}
	return "channel_concurrency_unavailable", slotErr.Error()
}

type runtimeCoordinator struct {
	redis      *redis.Client
	instanceID string
	localMu    sync.Mutex
	localRate  map[string]localRateEntry
	localSlots map[string]map[string]time.Time
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
	coordinator := &runtimeCoordinator{instanceID: newID(), localRate: map[string]localRateEntry{}, localSlots: map[string]map[string]time.Time{}}
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
		c.localMu.Lock()
		now := time.Now()
		slots := c.localSlots[scope]
		if slots == nil {
			slots = map[string]time.Time{}
			c.localSlots[scope] = slots
		}
		for token, expiresAt := range slots {
			if !expiresAt.After(now) {
				delete(slots, token)
			}
		}
		if len(slots) >= limit {
			c.localMu.Unlock()
			return nil, false, nil
		}
		token := c.instanceID + ":" + newID()
		slots[token] = now.Add(ttl)
		c.localMu.Unlock()
		return func() {
			c.localMu.Lock()
			delete(c.localSlots[scope], token)
			c.localMu.Unlock()
		}, true, nil
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

func (c *runtimeCoordinator) acquireWithWait(ctx context.Context, scope string, limit int, ttl time.Duration) (func(), error) {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		release, acquired, err := c.acquire(ctx, scope, limit, ttl)
		if err != nil {
			return nil, err
		}
		if acquired {
			return release, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-ticker.C:
		}
	}
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

func defaultChannelConcurrencyLimit() int {
	return effectiveChannelConcurrencyLimit(envInt("CANVAS_CHANNEL_CONCURRENCY", defaultChannelConcurrencyValue))
}

func effectiveChannelConcurrencyLimit(configured int) int {
	if configured < minChannelConcurrencyLimit || configured > maxChannelConcurrencyLimit {
		return defaultChannelConcurrencyValue
	}
	return configured
}

func (s *Service) AcquireChannelSlot(ctx context.Context, channelID string, fallbackScope string, ttl time.Duration) (func(), int, error) {
	setting, err := s.runtimeConcurrencySetting()
	limit := defaultChannelConcurrencyLimit()
	if err != nil {
		return nil, limit, channelSlotError{scope: firstNonEmpty(strings.TrimSpace(channelID), strings.TrimSpace(fallbackScope), "unknown"), limit: limit, err: fmt.Errorf("读取全局并发配置失败：%w", err)}
	}
	limit = setting.ChannelConcurrency
	scope := strings.TrimSpace(channelID)
	if scope != "" {
		channel, err := s.repo.SystemChannel(scope)
		if err != nil {
			return nil, limit, channelSlotError{scope: scope, limit: limit, err: fmt.Errorf("读取渠道并发配置失败：%w", err)}
		}
		if channel.ConcurrencyLimit > 0 {
			if channel.ConcurrencyLimit < minChannelConcurrencyLimit || channel.ConcurrencyLimit > maxChannelConcurrencyLimit {
				return nil, limit, channelSlotError{scope: scope, limit: limit, err: errors.New("渠道并发配置超出 1-100 范围")}
			}
			limit = channel.ConcurrencyLimit
		}
	} else {
		scope = strings.TrimSpace(fallbackScope)
	}
	if scope == "" {
		return nil, limit, channelSlotError{scope: "unknown", limit: limit, err: errors.New("渠道并发范围为空")}
	}
	if s.coordinator == nil {
		return nil, limit, channelSlotError{scope: scope, limit: limit, err: errors.New("运行时协调器未初始化")}
	}
	release, err := s.coordinator.acquireWithWait(ctx, "channel:"+scope, limit, ttl)
	if err != nil {
		return nil, limit, channelSlotError{scope: scope, limit: limit, err: err}
	}
	return release, limit, nil
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
