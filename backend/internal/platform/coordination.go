package platform

import (
	"context"
	"errors"
	"fmt"
	"infinite-canvas/backend/internal/kernel"
	"log"
	"math/rand/v2"
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
	MinChannelConcurrencyLimit     = 1
	MaxChannelConcurrencyLimit     = maxRuntimeConcurrency
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

type Coordinator struct {
	redis      *redis.Client
	instanceID string
	localMu    sync.Mutex
	localRate  map[string]localRateEntry
	localSlots map[string]map[string]time.Time
}

var fixedWindowScript = redis.NewScript(`
local existing = tonumber(redis.call('GET', KEYS[1]) or '0')
if existing >= tonumber(ARGV[2]) then return existing + 1 end
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return count
`)

var acquireSlotScript = redis.NewScript(`
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
redis.call('PEXPIRE', KEYS[1], math.max(tonumber(ARGV[5]), tonumber(latest[2]) - tonumber(ARGV[1]) + 60000))
return 1
`)

func NewCoordinator(dialect string) (*Coordinator, error) {
	coordinator := &Coordinator{instanceID: kernel.NewID(), localRate: map[string]localRateEntry{}, localSlots: map[string]map[string]time.Time{}}
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
	// 协调写操作不透明重试；限流/并发失败必须及时向调用方返回，不能放大故障流量。
	options.MaxRetries = -1
	options.ContextTimeoutEnabled = true
	coordinator.redis = redis.NewClient(options)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := coordinator.redis.Ping(ctx).Err(); err != nil {
		return coordinator, fmt.Errorf("Redis 不可用：%w", err)
	}
	return coordinator, nil
}

// NewCoordinatorWithRedis builds a coordinator around an already connected
// Redis client. The composition root normally uses NewCoordinator; this
// constructor keeps integration tests and embedded deployments from reaching
// into Coordinator's private state.
func NewCoordinatorWithRedis(client *redis.Client, instanceID string) *Coordinator {
	if strings.TrimSpace(instanceID) == "" {
		instanceID = kernel.NewID()
	}
	return &Coordinator{
		redis:      client,
		instanceID: instanceID,
		localRate:  map[string]localRateEntry{},
		localSlots: map[string]map[string]time.Time{},
	}
}

func (c *Coordinator) Allow(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	if c.redis != nil {
		count, err := fixedWindowScript.Run(ctx, c.redis, []string{"canvas:rate:" + key}, window.Milliseconds(), limit).Int64()
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

func (c *Coordinator) Acquire(ctx context.Context, scope string, limit int, ttl time.Duration) (func(), bool, error) {
	lease, acquired, err := c.AcquireLease(ctx, scope, limit, ttl)
	if err != nil || !acquired {
		return nil, acquired, err
	}
	return lease.Release, true, nil
}

func (c *Coordinator) AcquireLease(ctx context.Context, scope string, limit int, ttl time.Duration) (*SlotLease, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	if limit <= 0 || ttl <= 0 {
		return nil, false, errors.New("并发租约参数无效")
	}
	lease := &SlotLease{coordinator: c, scope: scope, token: c.instanceID + ":" + kernel.NewID(), ttl: ttl}
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
		slots[lease.token] = now.Add(ttl)
		c.localMu.Unlock()
		return lease, true, nil
	}
	// 有过期分数的有序集合避免实例崩溃后永久占槽，业务数据库仍保存任务与账本真相。
	key := "canvas:slots:" + scope
	ctx, cancel := context.WithTimeout(ctx, CoordinationTimeout)
	defer cancel()
	now := time.Now()
	ok, err := acquireSlotScript.Run(ctx, c.redis, []string{key}, now.UnixMilli(), now.Add(ttl).UnixMilli(), limit, lease.token, (ttl + time.Minute).Milliseconds()).Int()
	if err != nil || ok != 1 {
		return nil, false, err
	}
	return lease, true, nil
}

const CoordinationTimeout = 2 * time.Second

type SlotLease struct {
	coordinator *Coordinator
	scope       string
	token       string
	ttl         time.Duration
	once        sync.Once
}

var renewSlotScript = redis.NewScript(`
local expires = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not expires or tonumber(expires) <= tonumber(ARGV[2]) then return 0 end
redis.call('ZADD', KEYS[1], 'XX', ARGV[3], ARGV[1])
local latest = redis.call('ZREVRANGE', KEYS[1], 0, 0, 'WITHSCORES')
redis.call('PEXPIRE', KEYS[1], math.max(tonumber(ARGV[4]), tonumber(latest[2]) - tonumber(ARGV[2]) + 60000))
return 1
`)

func (l *SlotLease) Token() string {
	if l == nil {
		return ""
	}
	return l.token
}

func (l *SlotLease) Renew(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c := l.coordinator
	now := time.Now()
	if c.redis == nil {
		c.localMu.Lock()
		defer c.localMu.Unlock()
		if !c.localSlots[l.scope][l.token].After(now) {
			return errors.New("并发租约已失效")
		}
		c.localSlots[l.scope][l.token] = now.Add(l.ttl)
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, CoordinationTimeout)
	defer cancel()
	ok, err := renewSlotScript.Run(ctx, c.redis, []string{"canvas:slots:" + l.scope}, l.token, now.UnixMilli(), now.Add(l.ttl).UnixMilli(), (l.ttl + time.Minute).Milliseconds()).Int()
	if err != nil {
		return err
	}
	if ok != 1 {
		return errors.New("并发租约已失效")
	}
	return nil
}

func (l *SlotLease) Release() {
	l.once.Do(func() {
		c := l.coordinator
		if c.redis == nil {
			c.localMu.Lock()
			defer c.localMu.Unlock()
			delete(c.localSlots[l.scope], l.token)
			if len(c.localSlots[l.scope]) == 0 {
				delete(c.localSlots, l.scope)
			}
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), CoordinationTimeout)
		defer cancel()
		if err := c.redis.ZRem(ctx, "canvas:slots:"+l.scope, l.token).Err(); err != nil {
			log.Printf("concurrency lease release failed: scope=%s error=%v", l.scope, err)
		}
	})
}

func (c *Coordinator) AcquireWithWait(ctx context.Context, scope string, limit int, ttl time.Duration) (func(), error) {
	delay := 200 * time.Millisecond
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		release, acquired, err := c.Acquire(ctx, scope, limit, ttl)
		if err != nil {
			return nil, err
		}
		if acquired {
			return release, nil
		}
		// 满载期间退避并错峰，避免每个等待者固定每秒五次同步争抢 Redis。
		wait := time.NewTimer(channelSlotRetryDelay(delay))
		select {
		case <-ctx.Done():
			wait.Stop()
			return nil, ctx.Err()
		case <-wait.C:
		}
		delay = min(delay*2, 2*time.Second)
	}
}

func channelSlotRetryDelay(delay time.Duration) time.Duration {
	// 上限 2s，下半窗口随机等待，保留首轮至少 100ms 的退让。
	return delay/2 + time.Duration(rand.Int64N(int64(delay/2)+1))
}

func (c *Coordinator) CircuitOpen(ctx context.Context, channelID string) (bool, error) {
	if c.redis == nil || strings.TrimSpace(channelID) == "" {
		return false, nil
	}
	count, err := c.redis.Exists(ctx, "canvas:circuit:open:"+channelID).Result()
	return count > 0, err
}

func (c *Coordinator) RecordChannelResult(ctx context.Context, channelID string, failed bool, failureLimit int, openDuration time.Duration) {
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
	if count >= int64(failureLimit) {
		_ = c.redis.Set(ctx, openKey, "1", openDuration).Err()
	}
}

const RouteCatalogVersionKey = "canvas:logical-model-route-catalog:version"

func (c *Coordinator) RouteCatalogVersion(ctx context.Context) (int64, error) {
	if c == nil || c.redis == nil {
		return 0, nil
	}
	value, err := c.redis.Get(ctx, RouteCatalogVersionKey).Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return value, err
}

func (c *Coordinator) BumpRouteCatalogVersion(ctx context.Context) error {
	if c == nil || c.redis == nil {
		return nil
	}
	return c.redis.Incr(ctx, RouteCatalogVersionKey).Err()
}

func routeHealthKey(key string) string { return "canvas:logical-route-health:" + key }

func (c *Coordinator) RouteBlockedUntil(ctx context.Context, key string) (time.Time, error) {
	if c == nil || c.redis == nil {
		return time.Time{}, nil
	}
	value, err := c.redis.Get(ctx, routeHealthKey(key)).Int64()
	if err == redis.Nil {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	return time.UnixMilli(value), nil
}

func (c *Coordinator) BlockRoute(ctx context.Context, key string, until time.Time) error {
	if c == nil || c.redis == nil {
		return nil
	}
	ttl := time.Until(until)
	if ttl <= 0 {
		return c.redis.Del(ctx, routeHealthKey(key)).Err()
	}
	return c.redis.Set(ctx, routeHealthKey(key), until.UnixMilli(), ttl).Err()
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
	if configured < MinChannelConcurrencyLimit || configured > MaxChannelConcurrencyLimit {
		return defaultChannelConcurrencyValue
	}
	return configured
}

func (s *Service) AcquireChannelSlot(ctx context.Context, channelID string, fallbackScope string, ttl time.Duration) (func(), int, error) {
	setting, err := s.RuntimeConcurrencySetting()
	limit := defaultChannelConcurrencyLimit()
	if err != nil {
		return nil, limit, channelSlotError{scope: kernel.FirstNonEmpty(strings.TrimSpace(channelID), strings.TrimSpace(fallbackScope), "unknown"), limit: limit, err: fmt.Errorf("读取全局并发配置失败：%w", err)}
	}
	limit = setting.ChannelConcurrency
	scope := strings.TrimSpace(channelID)
	if scope != "" {
		channelLimit, err := s.host.ChannelConcurrencyLimit(scope)
		if err != nil {
			return nil, limit, channelSlotError{scope: scope, limit: limit, err: fmt.Errorf("读取渠道并发配置失败：%w", err)}
		}
		if channelLimit > 0 {
			if channelLimit < MinChannelConcurrencyLimit || channelLimit > MaxChannelConcurrencyLimit {
				return nil, limit, channelSlotError{scope: scope, limit: limit, err: errors.New("渠道并发配置超出 1-999 范围")}
			}
			limit = channelLimit
		}
	} else {
		scope = strings.TrimSpace(fallbackScope)
	}
	if scope == "" {
		return nil, limit, channelSlotError{scope: "unknown", limit: limit, err: errors.New("渠道并发范围为空")}
	}
	if s.Coordinator == nil {
		return nil, limit, channelSlotError{scope: scope, limit: limit, err: errors.New("运行时协调器未初始化")}
	}
	release, err := s.Coordinator.AcquireWithWait(ctx, "channel:"+scope, limit, ttl)
	if err != nil {
		return nil, limit, channelSlotError{scope: scope, limit: limit, err: err}
	}
	return release, limit, nil
}

func (s *Service) Close() error {
	if s == nil || s.Coordinator == nil || !s.Coordinator.HasRedis() {
		return nil
	}
	return s.Coordinator.Redis().Close()
}

func (s *Service) AllowRequest(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	if s.Coordinator == nil {
		return false, errors.New("运行时协调器未初始化")
	}
	return s.Coordinator.Allow(ctx, key, limit, window)
}

func (s *Service) RequestRetryAfter(ctx context.Context, key string, window time.Duration) time.Duration {
	if s == nil || s.Coordinator == nil {
		return window
	}
	return s.Coordinator.RateRetryAfter(ctx, key, window)
}

func (s *Service) AcquireCustomRelaySlot(ctx context.Context, userID string, limit int, ttl time.Duration) (func(), bool, error) {
	if s.Coordinator == nil {
		return nil, false, errors.New("运行时协调器未初始化")
	}
	return s.Coordinator.Acquire(ctx, "custom-relay:"+userID, limit, ttl)
}

func (c *Coordinator) HasRedis() bool {
	return c != nil && c.redis != nil
}

func (c *Coordinator) Redis() *redis.Client {
	if c == nil {
		return nil
	}
	return c.redis
}

func (c *Coordinator) LocalRateCount() int {
	if c == nil {
		return 0
	}
	c.localMu.Lock()
	defer c.localMu.Unlock()
	return len(c.localRate)
}

func (c *Coordinator) ClearLocalRate() int {
	if c == nil {
		return 0
	}
	c.localMu.Lock()
	defer c.localMu.Unlock()
	count := len(c.localRate)
	c.localRate = map[string]localRateEntry{}
	return count
}

func (c *Coordinator) RateRetryAfter(ctx context.Context, key string, window time.Duration) time.Duration {
	if c == nil {
		return window
	}
	if c.redis != nil {
		ttl, err := c.redis.PTTL(ctx, "canvas:rate:"+key).Result()
		if err == nil && ttl > 0 {
			return ttl
		}
		return window
	}
	c.localMu.Lock()
	defer c.localMu.Unlock()
	if entry, ok := c.localRate[key]; ok {
		return max(time.Second, time.Until(entry.started.Add(window)))
	}
	return time.Second
}

func (s *Service) RecordChannelResult(ctx context.Context, channelID string, failed bool) error {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	if s.Coordinator == nil {
		return errors.New("运行时协调器未初始化")
	}
	s.Coordinator.RecordChannelResult(ctx, channelID, failed, policy.Request.ChannelCircuitFailureCount, time.Duration(policy.Request.ChannelCircuitOpenSeconds)*time.Second)
	return nil
}
