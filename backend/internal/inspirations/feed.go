package inspirations

import (
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// FeedEntry 是公开接口返回的条目，字段与前端 CreationInspiration 对齐；AddedAt 是本站首次收录时间。
type FeedEntry struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Image       string     `json:"image"`
	Mode        string     `json:"mode"`
	Prompt      string     `json:"prompt"`
	Category    string     `json:"category,omitempty"`
	Tags        []string   `json:"tags,omitempty"`
	SourceID    string     `json:"sourceId"`
	Credit      string     `json:"credit,omitempty"`
	SourceURL   string     `json:"sourceUrl,omitempty"`
	AddedAt     time.Time  `json:"addedAt"`
	PublishedAt *time.Time `json:"publishedAt,omitempty"`
}

// Feed 是灵感大厅的上新数据。Enabled 为 false 时 Entries 为空，前台只展示静态目录。
type Feed struct {
	Enabled    bool                         `json:"enabled"`
	Entries    []FeedEntry                  `json:"entries"`
	Categories map[string]map[string]string `json:"categories"`
	SyncedAt   *time.Time                   `json:"syncedAt,omitempty"`
}

// AdminStatus 是后台展示的上新状态：开关、最近一次同步的结果与已收录数量。
type AdminStatus struct {
	Enabled       bool             `json:"enabled"`
	IntervalHours int              `json:"intervalHours"`
	LastAttemptAt *time.Time       `json:"lastAttemptAt,omitempty"`
	LastSuccessAt *time.Time       `json:"lastSuccessAt,omitempty"`
	NextSyncAt    *time.Time       `json:"nextSyncAt,omitempty"`
	LastError     string           `json:"lastError,omitempty"`
	Trigger       string           `json:"trigger,omitempty"`
	Sources       []SourceResult   `json:"sources"`
	Total         int64            `json:"total"`
	BySource      map[string]int64 `json:"bySource"`
}

// Feed 返回公开的上新条目。匿名访客也能看到灵感大厅，所以不校验登录；结果在本进程缓存几分钟。
func (s *Service) Feed() (*Feed, error) {
	s.cacheMu.Lock()
	if s.cached != nil && s.now().Sub(s.cachedAt) < feedCacheTTL {
		feed := s.cached
		s.cacheMu.Unlock()
		return feed, nil
	}
	s.cacheMu.Unlock()

	feed, err := s.loadFeed()
	if err != nil {
		return nil, err
	}
	s.cacheMu.Lock()
	s.cached, s.cachedAt = feed, s.now()
	s.cacheMu.Unlock()
	return feed, nil
}

func (s *Service) loadFeed() (*Feed, error) {
	settings, err := s.settings()
	if err != nil {
		return nil, err
	}
	feed := &Feed{Enabled: settings.Enabled, Entries: []FeedEntry{}, Categories: map[string]map[string]string{}}
	if !settings.Enabled {
		return feed, nil
	}
	state, err := s.readState()
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.InspirationFeedEntries(maxFeedEntries)
	if err != nil {
		return nil, err
	}
	feed.Entries = make([]FeedEntry, 0, len(rows))
	for _, row := range rows {
		feed.Entries = append(feed.Entries, FeedEntry{
			ID: row.ID, Title: row.Title, Description: row.Description, Image: row.Image, Mode: row.Mode, Prompt: row.Prompt,
			Category: row.Category, Tags: row.Tags, SourceID: row.SourceID, Credit: row.Credit, SourceURL: row.SourceURL,
			AddedAt: row.FirstSeenAt, PublishedAt: row.PublishedAt,
		})
	}
	if state.Categories != nil {
		feed.Categories = state.Categories
	}
	feed.SyncedAt = state.LastSuccessAt
	return feed, nil
}

func (s *Service) invalidateFeed() {
	s.cacheMu.Lock()
	s.cached = nil
	s.cacheMu.Unlock()
}

func (s *Service) AdminStatus(actor *model.User) (*AdminStatus, error) {
	if err := s.admin.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.status()
}

// UpdateSettings 保存管理员的开关。关闭立即对本实例生效，其他实例在公开接口缓存过期后生效。
func (s *Service) UpdateSettings(actor *model.User, input SettingsUpdate) (*AdminStatus, error) {
	if err := s.admin.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if input.Enabled == nil {
		return nil, kernel.BadAuthRequest("缺少 enabled")
	}
	before, err := s.settings()
	if err != nil {
		return nil, err
	}
	after := Settings{Enabled: *input.Enabled}
	if err := s.saveSetting(settingKey, after, actor.ID); err != nil {
		return nil, err
	}
	s.invalidateFeed()
	if err := s.admin.AppendAudit(actor, "inspiration_feed.update", "system_setting", settingKey, "更新灵感上新设置", map[string]any{"before": before, "after": after}); err != nil {
		return nil, err
	}
	return s.status()
}

func (s *Service) status() (*AdminStatus, error) {
	settings, err := s.settings()
	if err != nil {
		return nil, err
	}
	state, err := s.readState()
	if err != nil {
		return nil, err
	}
	counts, err := s.repo.InspirationFeedCounts()
	if err != nil {
		return nil, err
	}
	status := &AdminStatus{
		Enabled:       settings.Enabled,
		IntervalHours: int(SyncInterval / time.Hour),
		LastAttemptAt: state.LastAttemptAt,
		LastSuccessAt: state.LastSuccessAt,
		LastError:     state.LastError,
		Trigger:       state.Trigger,
		Sources:       state.Sources,
		BySource:      counts,
	}
	if status.Sources == nil {
		status.Sources = []SourceResult{}
	}
	for _, count := range counts {
		status.Total += count
	}
	if settings.Enabled {
		status.NextSyncAt = nextSyncAt(state)
	}
	return status, nil
}
