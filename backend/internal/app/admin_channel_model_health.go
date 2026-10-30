// 管理端渠道模型运营视图：跨渠道模型列表、调用稳定性统计与模型单独启停。
//
// 稳定性只统计 request_kind=create 的上游生成请求（与总览、用户端可用率同一口径），
// 管理员需要看到小样本的真实计数，所以这里不设用户端的最少样本门槛。

package app

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	adminModelHealthRecentLimit = 10
	// 只读近 7 天最新的这么多条 create 记录做内存聚合，避免一次读入全部历史日志。
	adminModelHealthLogLimit = 50_000
	adminModelHealthCacheTTL = 30 * time.Second
)

// 成功率为 0–1 的小数，没有样本时为 null。
type AdminChannelModelHealth struct {
	ChannelID        string     `json:"channelId"`
	ModelKey         string     `json:"modelKey"`
	Requests24h      int        `json:"requests24h"`
	Succeeded24h     int        `json:"succeeded24h"`
	Failed24h        int        `json:"failed24h"`
	SuccessRate24h   *float64   `json:"successRate24h"`
	Requests7d       int        `json:"requests7d"`
	SuccessRate7d    *float64   `json:"successRate7d"`
	P95DurationMs24h int64      `json:"p95DurationMs24h"`
	RecentResults    []bool     `json:"recentResults"`
	LastErrorCode    string     `json:"lastErrorCode,omitempty"`
	LastFailedAt     *time.Time `json:"lastFailedAt,omitempty"`
	LastCalledAt     *time.Time `json:"lastCalledAt,omitempty"`
}

type AdminChannelModelHealthReport struct {
	Items      []AdminChannelModelHealth `json:"items"`
	ComputedAt time.Time                 `json:"computedAt"`
	// Truncated 为 true 表示 7 天内记录超过读取上限，7 天指标只覆盖最新的部分记录。
	Truncated bool `json:"truncated"`
}

// AdminChannelModelListItem 在渠道模型上附加所属渠道，用于跨渠道搜索。
type AdminChannelModelListItem struct {
	model.ChannelModel
	ChannelName    string `json:"channelName"`
	ChannelEnabled bool   `json:"channelEnabled"`
}

// AdminAllChannelModels 返回全部系统渠道（含停用渠道）的模型，供“全部模型”视图按名称跨渠道筛选。
func (s *Service) AdminAllChannelModels(actor *model.User) ([]AdminChannelModelListItem, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channels, err := s.repo.SystemChannels(true)
	if err != nil {
		return nil, err
	}
	result := make([]AdminChannelModelListItem, 0)
	for _, channel := range channels {
		items, err := s.AdminChannelModels(actor, channel.ID)
		if err != nil {
			return nil, err
		}
		for _, item := range items {
			result = append(result, AdminChannelModelListItem{ChannelModel: item, ChannelName: channel.Name, ChannelEnabled: channel.Enabled})
		}
	}
	return result, nil
}

func (s *Service) AdminChannelModelHealth(actor *model.User, channelID string) (*AdminChannelModelHealthReport, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	report, err := s.cachedAdminChannelModelHealth(time.Now().UTC())
	if err != nil {
		return nil, err
	}
	channelID = strings.TrimSpace(channelID)
	if channelID == "" {
		return report, nil
	}
	filtered := &AdminChannelModelHealthReport{ComputedAt: report.ComputedAt, Truncated: report.Truncated, Items: make([]AdminChannelModelHealth, 0)}
	for _, item := range report.Items {
		if item.ChannelID == channelID {
			filtered.Items = append(filtered.Items, item)
		}
	}
	return filtered, nil
}

func (s *Service) cachedAdminChannelModelHealth(now time.Time) (*AdminChannelModelHealthReport, error) {
	s.adminModelHealthMu.Lock()
	defer s.adminModelHealthMu.Unlock()
	if s.adminModelHealthCache != nil && now.Sub(s.adminModelHealthCache.ComputedAt) < adminModelHealthCacheTTL {
		return s.adminModelHealthCache, nil
	}
	channels, err := s.repo.SystemChannels(true)
	if err != nil {
		return nil, err
	}
	channelIDs := make([]string, 0, len(channels))
	for _, channel := range channels {
		channelIDs = append(channelIDs, channel.ID)
	}
	logs, err := s.repo.AdminModelHealthLogs(repository.PublicModelAvailabilityFilter{From: now.Add(-7 * 24 * time.Hour), To: now, ChannelIDs: channelIDs}, adminModelHealthLogLimit)
	if err != nil {
		return nil, err
	}
	report := buildAdminChannelModelHealth(logs, now)
	report.Truncated = len(logs) >= adminModelHealthLogLimit
	s.adminModelHealthCache = report
	return report, nil
}

// buildAdminChannelModelHealth 要求 logs 按时间倒序（最新在前）。
func buildAdminChannelModelHealth(logs []model.ApiCallLog, now time.Time) *AdminChannelModelHealthReport {
	type accumulator struct {
		item      AdminChannelModelHealth
		success7d int
		durations []int64
	}
	items := map[publicModelAvailabilityKey]*accumulator{}
	dayAgo := now.Add(-24 * time.Hour)
	for _, log := range logs {
		key := publicModelAvailabilityKey{channelID: log.ChannelID, modelKey: log.Model}
		acc := items[key]
		if acc == nil {
			acc = &accumulator{item: AdminChannelModelHealth{ChannelID: log.ChannelID, ModelKey: log.Model, RecentResults: []bool{}}}
			items[key] = acc
		}
		succeeded := log.Status == model.ApiCallStatusSucceeded
		acc.item.Requests7d++
		if succeeded {
			acc.success7d++
		}
		if acc.item.LastCalledAt == nil {
			calledAt := log.CreatedAt.UTC()
			acc.item.LastCalledAt = &calledAt
		}
		if len(acc.item.RecentResults) < adminModelHealthRecentLimit {
			acc.item.RecentResults = append(acc.item.RecentResults, succeeded)
		}
		if !succeeded && acc.item.LastFailedAt == nil {
			failedAt := log.CreatedAt.UTC()
			acc.item.LastFailedAt = &failedAt
			acc.item.LastErrorCode = firstNonEmpty(log.ErrorCode, statusCodeErrorCode(log.StatusCode))
		}
		if log.CreatedAt.Before(dayAgo) {
			continue
		}
		acc.item.Requests24h++
		acc.durations = append(acc.durations, log.DurationMs)
		if succeeded {
			acc.item.Succeeded24h++
		} else {
			acc.item.Failed24h++
		}
	}
	report := &AdminChannelModelHealthReport{Items: make([]AdminChannelModelHealth, 0, len(items)), ComputedAt: now}
	for _, acc := range items {
		// 最近结果按时间正序输出，最右侧为最新一次调用，与用户端一致。
		for left, right := 0, len(acc.item.RecentResults)-1; left < right; left, right = left+1, right-1 {
			acc.item.RecentResults[left], acc.item.RecentResults[right] = acc.item.RecentResults[right], acc.item.RecentResults[left]
		}
		acc.item.SuccessRate24h = optionalFraction(acc.item.Succeeded24h, acc.item.Requests24h)
		acc.item.SuccessRate7d = optionalFraction(acc.success7d, acc.item.Requests7d)
		acc.item.P95DurationMs24h = percentile(acc.durations, 0.95)
		report.Items = append(report.Items, acc.item)
	}
	sort.Slice(report.Items, func(i, j int) bool {
		if report.Items[i].ChannelID == report.Items[j].ChannelID {
			return report.Items[i].ModelKey < report.Items[j].ModelKey
		}
		return report.Items[i].ChannelID < report.Items[j].ChannelID
	})
	return report
}

// optionalFraction 返回 0–1 的成功率，与用户端可用率字段一致；没有样本时为 nil。
func optionalFraction(value int, total int) *float64 {
	if total == 0 {
		return nil
	}
	result := float64(value) / float64(total)
	return &result
}

func statusCodeErrorCode(statusCode int) string {
	if statusCode <= 0 {
		return ""
	}
	return "HTTP " + strconv.Itoa(statusCode)
}

// SetAdminChannelModelEnabled 只改启停，不重写价格档与能力配置；列表行内启停走这里。
func (s *Service) SetAdminChannelModelEnabled(actor *model.User, channelID string, id string, enabled bool) (*model.ChannelModel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.AdminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	item, err := s.repo.ChannelModelByID(channelID, strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	if item.Enabled == enabled {
		return item, nil
	}
	if enabled && (item.Protocol == "" || item.Capability == "") {
		return nil, BadAuthRequest("模型尚未配置能力与请求协议，请先编辑模型")
	}
	if err := s.repo.SetChannelModelEnabled(channelID, item.ID, enabled); err != nil {
		return nil, err
	}
	item.Enabled = enabled
	s.invalidateRouteCatalog()
	if err := s.syncChannelModelNames(channel); err != nil {
		return nil, err
	}
	if err := s.syncLogicalModelsFromChannelModel(actor, item); err != nil {
		return nil, err
	}
	action, summary := "channel_model.disable", "停用渠道模型 "+item.ModelKey
	if enabled {
		action, summary = "channel_model.enable", "启用渠道模型 "+item.ModelKey
	}
	if err := s.appendAdminAudit(actor, action, "channel_model", item.ID, summary, map[string]any{"channelId": channelID, "modelKey": item.ModelKey, "enabled": enabled}); err != nil {
		return nil, err
	}
	return item, nil
}
