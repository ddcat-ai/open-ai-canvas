package app

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
	"yingce/backend/internal/platform"
)

const (
	rainyunRealtimeWindow    = 5 * time.Minute
	rainyunRealtimeMaxPoints = 600
	rainyunRealtimeMaxRetry  = 5 * time.Minute
)

type RainyunRealtimePoint struct {
	Time                   time.Time `json:"time"`
	ReceivedBytesPerSecond *float64  `json:"receivedBytesPerSecond,omitempty"`
	SentBytesPerSecond     *float64  `json:"sentBytesPerSecond,omitempty"`
	RequestsTotal          *float64  `json:"requestsTotal,omitempty"`
}

type SystemPerformanceRainyunRealtime struct {
	Enabled               bool                   `json:"enabled"`
	Configured            bool                   `json:"configured"`
	Status                string                 `json:"status"`
	StatusMessage         string                 `json:"statusMessage"`
	InstanceID            int64                  `json:"instanceId,omitempty"`
	CheckedAt             *time.Time             `json:"checkedAt,omitempty"`
	SampleIntervalSeconds *float64               `json:"sampleIntervalSeconds,omitempty"`
	RetryAfterSeconds     int                    `json:"retryAfterSeconds"`
	Points                []RainyunRealtimePoint `json:"points"`
}

type rainyunRealtimeSnapshot struct {
	value    SystemPerformanceRainyunRealtime
	retryAt  time.Time
	failures int
}

type rainyunRealtimeCache struct {
	loads  *platform.BoundedReadCache[[32]byte, rainyunRealtimeSnapshot]
	mu     sync.Mutex
	recent map[[32]byte]rainyunRealtimeSnapshot
}

func (s *Service) initRainyunRealtimeCache() {
	s.rainyunRealtimeOnce.Do(func() {
		s.rainyunRealtimeCache = &rainyunRealtimeCache{
			loads:  platform.NewBoundedReadCache[[32]byte, rainyunRealtimeSnapshot](2, 256<<10, 2, time.Second),
			recent: make(map[[32]byte]rainyunRealtimeSnapshot),
		}
	})
}

func (c *rainyunRealtimeCache) previous(key [32]byte) rainyunRealtimeSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.recent[key]
}

func (c *rainyunRealtimeCache) remember(key [32]byte, value rainyunRealtimeSnapshot) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, exists := c.recent[key]; !exists && len(c.recent) >= 2 {
		var oldest [32]byte
		var at time.Time
		for candidate, snapshot := range c.recent {
			if at.IsZero() || snapshot.retryAt.Before(at) {
				oldest, at = candidate, snapshot.retryAt
			}
		}
		delete(c.recent, oldest)
	}
	c.recent[key] = value
}

func rainyunRealtimeBase(value rainyunMonitorSettingValue) SystemPerformanceRainyunRealtime {
	result := SystemPerformanceRainyunRealtime{
		Enabled: value.Enabled, Configured: value.InstanceID > 0 && value.APIKey != "", InstanceID: value.InstanceID,
		Status: "disabled", StatusMessage: "雨云监控未启用", RetryAfterSeconds: 5,
		Points: make([]RainyunRealtimePoint, 0),
	}
	if value.Enabled {
		result.Status, result.StatusMessage = "unconfigured", "雨云管理凭据或实例 ID 未配置完整"
	}
	return result
}

func (s *Service) AdminRainyunRealtime(ctx context.Context, actor *model.User) (*SystemPerformanceRainyunRealtime, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, rainyunMonitorTimeout)
	defer cancel()
	record, value, err := s.readRainyunMonitorSetting(ctx)
	result := rainyunRealtimeBase(value)
	if err != nil {
		result.Status, result.StatusMessage = "unknown", "雨云监控配置读取失败，未采集实时指标"
		return &result, nil
	}
	if !value.Enabled || !result.Configured {
		return &result, nil
	}
	// 配置正文及保存版本共同隔离缓存，切换后不能命中旧凭据或旧实例的退避快照。
	key := sha256.Sum256([]byte(record.ValueJSON + "\x00" + record.UpdatedAt.UTC().Format(time.RFC3339Nano)))
	s.initRainyunRealtimeCache()
	cache := s.rainyunRealtimeCache
	snapshot, err := cache.loads.Get(ctx, key, func(ctx context.Context) (rainyunRealtimeSnapshot, int, error) {
		previous := cache.previous(key)
		if time.Now().Before(previous.retryAt) {
			return previous, 1024 + len(previous.value.Points)*128, nil
		}
		collected, success, retry := s.loadRainyunRealtime(ctx, value)
		next := rainyunRealtimeSnapshot{value: collected}
		if success {
			retry = time.Second
		} else {
			next.failures = min(previous.failures+1, 5)
			delay := min(5*time.Second<<min(previous.failures, 4), time.Minute)
			retry = min(max(retry, delay), rainyunRealtimeMaxRetry)
		}
		next.retryAt = time.Now().Add(retry)
		// BoundedReadCache 的错误默认仅冷却一秒；独立有界快照保留更长退避。
		// 即使调用方取消也释放回源槽，并短暂冷却，不能用反复取消绕过失败退避。
		cache.remember(key, next)
		if err := ctx.Err(); err != nil {
			return next, 0, err
		}
		return next, 1024 + len(next.value.Points)*128, nil
	})
	if err != nil {
		result.Status, result.StatusMessage = "unknown", "雨云实时采集繁忙、超时或已取消，请稍后重试"
		return &result, nil
	}
	result = snapshot.value
	now := time.Now().UTC()
	result.RetryAfterSeconds = max(1, int((time.Until(snapshot.retryAt)+time.Second-1)/time.Second))
	result.Points = rainyunRealtimeWindowPoints(result.Points, now)
	result.SampleIntervalSeconds = rainyunRealtimeSampleInterval(result.Points)
	if result.Status == "healthy" && len(result.Points) == 0 {
		result.Status, result.StatusMessage = "unknown", "雨云近五分钟暂无有效采样，未补点或沿用窗口外指标"
	}
	return &result, nil
}

func (s *Service) loadRainyunRealtime(ctx context.Context, value rainyunMonitorSettingValue) (SystemPerformanceRainyunRealtime, bool, time.Duration) {
	result := rainyunRealtimeBase(value)
	now := time.Now().UTC()
	result.CheckedAt = &now
	secret, err := s.rainyunMonitorSecret(value.APIKey)
	if err != nil {
		result.Configured = false
		result.Status, result.StatusMessage = "unconfigured", "雨云管理密钥不可用，请重新保存监控配置"
		return result, false, time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, rainyunMonitorRequestTimeout)
	defer cancel()
	// 只读固定官方路径；ID/Key 仅取服务端保存配置，不接收浏览器指定的上游或时间范围。
	endpoint := fmt.Sprintf("https://api.v2.rainyun.com/product/ros/instance/%d/monitor?start_date=%d&end_date=%d", value.InstanceID, now.Add(-rainyunRealtimeWindow).Unix(), now.Unix())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	result.Status, result.StatusMessage = "error", "雨云实时只读查询失败，请检查网络或监控凭据"
	if err != nil {
		return result, false, 0
	}
	req.Header.Set("X-Api-Key", secret)
	req.Header.Set("Accept", "application/json")
	outbound.ApplyDefaultOutboundHeaders(req)
	client := outbound.OutboundHTTPClient(rainyunMonitorRequestTimeout)
	if s.rainyunMonitorTransport != nil {
		client.Transport = s.rainyunMonitorTransport
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			result.Status, result.StatusMessage = "unknown", "雨云实时只读查询超时或已取消，暂不能获取指标"
		}
		return result, false, 0
	}
	defer resp.Body.Close()
	retry := rainyunRealtimeRetryAfter(resp.Header.Get("Retry-After"), time.Now())
	if resp.StatusCode == http.StatusTooManyRequests {
		result.Status, result.StatusMessage = "warning", "雨云限制了实时查询频率，已暂停回源并等待重试"
		return result, false, retry
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		result.StatusMessage = "雨云管理 API Key 无效或没有实例监控读取权限"
		return result, false, retry
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		result.StatusMessage = "雨云实时接口暂不可用或拒绝了请求，未跟随重定向"
		return result, false, retry
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, rainyunMonitorBodyLimit+1))
	if err != nil || len(body) > rainyunMonitorBodyLimit {
		result.StatusMessage = "雨云实时响应读取失败或超出限制"
		return result, false, retry
	}
	points, err := parseRainyunRealtime(body, now.Truncate(time.Second))
	if err != nil {
		result.StatusMessage = "雨云实时响应格式或业务状态无效"
		return result, false, retry
	}
	result.Points = points
	result.Status, result.StatusMessage = "unknown", "雨云近五分钟暂无有效指标，缺失数据不代表零，未补点"
	for _, point := range points {
		if point.ReceivedBytesPerSecond != nil || point.SentBytesPerSecond != nil || point.RequestsTotal != nil {
			result.Status, result.StatusMessage = "healthy", "按雨云官方展示口径返回真实采样；采样粒度由上游决定"
			break
		}
	}
	return result, true, 0
}

func rainyunRealtimeRetryAfter(raw string, now time.Time) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 128 {
		return 0
	}
	if seconds, err := strconv.ParseUint(raw, 10, 64); err == nil || errors.Is(err, strconv.ErrRange) {
		return time.Duration(min(seconds, uint64(rainyunRealtimeMaxRetry/time.Second))) * time.Second
	}
	if until, err := http.ParseTime(raw); err == nil && until.After(now) {
		return min(until.Sub(now), rainyunRealtimeMaxRetry)
	}
	return 0
}
