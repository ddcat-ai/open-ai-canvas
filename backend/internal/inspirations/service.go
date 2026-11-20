// Package inspirations 维护灵感大厅的「上新」：定时从上游提示词库同步新条目，补在随版本发布的静态目录之后。
//
// 数据边界：
//   - 只同步托管在 GitHub、按 CC BY 4.0 发布的 YouMind 提示词库与 awesome-seedance；
//     其余来源和人工译审过的条目仍随静态目录（web/public/inspirations）发布。
//   - 只收录正文已是中文的条目。英文正文要人工翻译后随静态目录发布，这里不做机器翻译。
//   - 封面直接引用上游地址，不下载到本站；上游删掉的条目继续保留，管理员关闭上新即整体下线。
//   - 前端按条目 ID 与静态目录去重，静态目录已有的条目以静态目录为准。
package inspirations

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
	"yingce/backend/internal/repository"
)

const (
	settingKey = "inspiration_feed"
	stateKey   = "inspiration_feed_sync"
	lockKey    = "inspiration-feed-sync"

	// SyncInterval 是两次自动同步的间隔；上游大约每天更新一次。
	SyncInterval = 6 * time.Hour
	// 上次有来源失败时提前重试，网络抖动不必等满一个周期。
	retryInterval = time.Hour
	// 启动后先等一会儿再检查，不和启动期的迁移、预热抢资源。
	startupDelay  = 2 * time.Minute
	checkInterval = 10 * time.Minute
	fetchTimeout  = 90 * time.Second
	syncTimeout   = 8 * time.Minute
	// 锁的有效期要长于一次同步的最长耗时，否则另一实例可能在同步中途再开一轮。
	lockTTL      = 15 * time.Minute
	feedCacheTTL = 5 * time.Minute
	// maxFeedEntries 是公开接口一次返回的条目上限，按收录时间保留最新的。
	maxFeedEntries = 3000

	TriggerSchedule = "schedule"
	TriggerManual   = "manual"
)

// AdminGate 由 app 注入：管理员校验与审计写入。
type AdminGate interface {
	RequireAdmin(*model.User) error
	AppendAudit(actor *model.User, action, targetType, targetID, summary string, metadata any) error
}

// Locker 保证同一时间只有一个实例或请求在同步；acquired 为 false 表示同步已在进行。
type Locker func(ctx context.Context, key string, ttl time.Duration) (release func(), acquired bool, err error)

type Service struct {
	repo          *repository.Repository
	admin         AdminGate
	lock          Locker
	runWorkerLoop func(func(context.Context)) bool
	client        *http.Client
	sources       []source
	now           func() time.Time

	cacheMu  sync.Mutex
	cached   *Feed
	cachedAt time.Time
}

// New 由组合根注入仓储、管理员校验、跨实例同步锁和后台循环。
// lock 为 nil 时只在本进程内互斥；runWorkerLoop 为 nil 时不启动定时同步。
func New(repo *repository.Repository, admin AdminGate, lock Locker, runWorkerLoop func(func(context.Context)) bool) *Service {
	if lock == nil {
		lock = processLock()
	}
	if runWorkerLoop == nil {
		runWorkerLoop = func(func(context.Context)) bool { return false }
	}
	return &Service{
		repo:          repo,
		admin:         admin,
		lock:          lock,
		runWorkerLoop: runWorkerLoop,
		client:        outbound.OutboundHTTPClient(fetchTimeout),
		sources:       defaultSources(),
		now:           time.Now,
	}
}

func processLock() Locker {
	var mu sync.Mutex
	return func(context.Context, string, time.Duration) (func(), bool, error) {
		if !mu.TryLock() {
			return nil, false, nil
		}
		return mu.Unlock, true, nil
	}
}

// Settings 是管理员可改的上新配置。关闭后既不同步，也不向用户返回已收录的条目。
type Settings struct {
	Enabled bool `json:"enabled"`
}

type SettingsUpdate struct {
	Enabled *bool `json:"enabled"`
}

// SyncState 记录最近一次同步，供后台查看，也用来判断下次何时同步。
type SyncState struct {
	LastAttemptAt *time.Time     `json:"lastAttemptAt,omitempty"`
	LastSuccessAt *time.Time     `json:"lastSuccessAt,omitempty"`
	LastError     string         `json:"lastError,omitempty"`
	Trigger       string         `json:"trigger,omitempty"`
	Sources       []SourceResult `json:"sources,omitempty"`
	// Categories 是上游分类码的中文名（来源 → 分类码 → 名称）；某个来源本次失败时沿用上次的。
	Categories map[string]map[string]string `json:"categories,omitempty"`
}

// SourceResult 是单个来源在一次同步里的结果。
type SourceResult struct {
	SourceID string `json:"sourceId"`
	// Upstream 是上游可用的条目数，Accepted 是其中正文为中文、予以收录的条目数。
	Upstream int    `json:"upstream"`
	Accepted int    `json:"accepted"`
	Created  int    `json:"created"`
	Updated  int    `json:"updated"`
	Error    string `json:"error,omitempty"`
}

func (state *SyncState) allFailed() bool {
	for _, result := range state.Sources {
		if result.Error == "" {
			return false
		}
	}
	return true
}

func (state *SyncState) totals() (created int, updated int) {
	for _, result := range state.Sources {
		created += result.Created
		updated += result.Updated
	}
	return created, updated
}

// nextSyncAt 返回下一次自动同步的时间；从未同步过时返回 nil，表示现在就该同步。
func nextSyncAt(state SyncState) *time.Time {
	if state.LastAttemptAt == nil {
		return nil
	}
	interval := SyncInterval
	if state.LastError != "" {
		interval = retryInterval
	}
	next := state.LastAttemptAt.Add(interval)
	return &next
}

func (s *Service) settings() (Settings, error) {
	value := Settings{Enabled: true}
	setting, err := s.repo.SystemSettingOptional(settingKey)
	if err != nil || setting == nil || strings.TrimSpace(setting.ValueJSON) == "" {
		return value, err
	}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return Settings{}, fmt.Errorf("灵感上新设置无法解析：%w", err)
	}
	return value, nil
}

func (s *Service) readState() (SyncState, error) {
	state := SyncState{}
	setting, err := s.repo.SystemSettingOptional(stateKey)
	if err != nil || setting == nil || strings.TrimSpace(setting.ValueJSON) == "" {
		return state, err
	}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &state); err != nil {
		return SyncState{}, fmt.Errorf("灵感上新同步记录无法解析：%w", err)
	}
	return state, nil
}

// saveSetting 整行写入一个系统设置；保留原有的创建时间。
// 开关与同步记录分成两个键，后台同步写记录时不会覆盖管理员刚改的开关。
func (s *Service) saveSetting(key string, value any, actorID string) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	setting := &model.SystemSetting{Key: key, ValueJSON: string(payload), UpdatedBy: actorID}
	existing, err := s.repo.SystemSettingOptional(key)
	if err != nil {
		return err
	}
	if existing != nil {
		setting.CreatedAt = existing.CreatedAt
	}
	return s.repo.SaveSystemSetting(setting)
}
