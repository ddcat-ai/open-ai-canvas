package repository

import (
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type SiteTrafficCounts struct {
	Visitors  int64 `json:"visitors"`
	PageViews int64 `json:"pageViews"`
	Visits    int64 `json:"visits"`
	Actions   int64 `json:"actions"`
}

type SiteTrafficDailyCounts struct {
	DayNumber         int64
	SiteTrafficCounts `gorm:"embedded"`
}

type SiteTrafficPage struct {
	Page      string `json:"page"`
	PageViews int64  `json:"pageViews"`
	Visitors  int64  `json:"visitors"`
	Visits    int64  `json:"visits"`
}

type SiteTrafficAction struct {
	Action   string `json:"action"`
	Page     string `json:"page"`
	Count    int64  `json:"count"`
	Visitors int64  `json:"visitors"`
}

type SiteTrafficEngagementCounts struct {
	Visits        int64 `json:"visits"`
	EngagedVisits int64 `json:"engagedVisits"`
}

type SiteTrafficHourlyCounts struct {
	Hour              int `json:"hour"`
	SiteTrafficCounts `gorm:"embedded"`
}

type SiteTrafficTodayAggregates struct {
	ActiveVisitors int64
	Hours          []SiteTrafficHourlyCounts
}

type SiteTrafficHourPageViews struct {
	HourNumber int64
	PageViews  int64
}

type SiteTrafficDailyActionCounts struct {
	DayNumber int64
	Action    string
	Count     int64
}

type SiteTrafficPageEngagementCounts struct {
	Page          string
	Visits        int64
	EngagedVisits int64
}

type SiteTrafficDepthCounts struct {
	Visits   int64
	One      int64
	TwoThree int64
	FourPlus int64
}

type SiteTrafficAggregates struct {
	KPI            SiteTrafficCounts
	Engagement     SiteTrafficEngagementCounts
	Trend          []SiteTrafficDailyCounts
	Pages          []SiteTrafficPage
	Actions        []SiteTrafficAction
	Heatmap        []SiteTrafficHourPageViews
	FeatureTrend   []SiteTrafficDailyActionCounts
	PageEngagement []SiteTrafficPageEngagementCounts
	Depth          SiteTrafficDepthCounts
	Operations     SiteTrafficOperationsAggregates
	EarliestEpoch  *int64
}

func (r *Repository) InsertSiteTrafficEvents(events []model.SiteTrafficEvent) (int64, error) {
	if len(events) == 0 {
		return 0, nil
	}
	result := r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoNothing: true}).Create(&events)
	return result.RowsAffected, result.Error
}

// 只回传聚合结果：范围 UV/会话独立去重，不能累加每日 UV，也不能把操作意图当页面访问。
const siteTrafficCountsSQL = `COUNT(DISTINCT CASE WHEN type = 'page_view' THEN visitor_hash END) AS visitors,
	COUNT(CASE WHEN type = 'page_view' THEN 1 END) AS page_views,
	COUNT(DISTINCT CASE WHEN type = 'page_view' THEN session_hash END) AS visits,
	COUNT(CASE WHEN type = 'action' THEN 1 END) AS actions`

// 所有读聚合共用当前13页范围；旧分类原始行保留，不把旧tools归入图片或视频。
const siteTrafficCurrentPagesSQL = `page IN ('inspirations', 'create', 'canvas_list', 'canvas', 'assets', 'history',
	'ecommerce', 'ecommerce_pipeline', 'drama', 'skills', 'referral', 'tools_image', 'tools_video')`

// 只用于读聚合：12个侧栏来源、灵感/画布显式新建和创作提交；不能据此收紧采集入参。
const siteTrafficMeasuredActionSQL = `((page IN ('inspirations', 'create', 'canvas_list', 'assets', 'history',
	'ecommerce', 'ecommerce_pipeline', 'drama', 'skills', 'referral', 'tools_image', 'tools_video')
	AND action IN ('open_create', 'open_ecommerce'))
	OR (page IN ('inspirations', 'canvas_list', 'canvas') AND action = 'new_canvas')
	OR (page = 'create' AND action IN ('creation_submit_text', 'creation_submit_image',
		'creation_submit_video', 'creation_submit_agent')))`

func (r *Repository) SiteTrafficOverview(from, to, retentionStart time.Time) (*SiteTrafficAggregates, error) {
	result := &SiteTrafficAggregates{
		Trend: make([]SiteTrafficDailyCounts, 0),
		Pages: make([]SiteTrafficPage, 0), Actions: make([]SiteTrafficAction, 0),
		Heatmap: make([]SiteTrafficHourPageViews, 0), FeatureTrend: make([]SiteTrafficDailyActionCounts, 0),
		PageEngagement: make([]SiteTrafficPageEngagementCounts, 0),
	}
	// WithContext可能返回已初始化的GORM句柄；每次独立建语句，保留context但不共享SELECT/GROUP/WHERE。
	fresh := func() *gorm.DB { return r.db.Session(&gorm.Session{NewDB: true}) }
	inRange := func() *gorm.DB {
		return fresh().Model(&model.SiteTrafficEvent{}).Where(siteTrafficCurrentPagesSQL).
			Where("received_at_epoch >= ? AND received_at_epoch < ?", from.Unix(), to.Unix())
	}
	kpi, err := r.SiteTrafficKPI(from, to)
	if err != nil {
		return nil, err
	}
	result.KPI = *kpi
	// 会话PV条数同时给出深度，仍只用原有的一次聚合；action-only及窗外事件不构成访问。
	sessions := inRange().Select(`session_hash,
		COUNT(CASE WHEN type = 'page_view' THEN 1 END) AS page_views,
		MAX(CASE WHEN type = 'action' THEN 1 ELSE 0 END) AS has_action`).Group("session_hash")
	var sessionCounts struct {
		SiteTrafficEngagementCounts `gorm:"embedded"`
		One                         int64
		TwoThree                    int64
		FourPlus                    int64
	}
	if err := fresh().Table("(?) AS session_flags", sessions).
		Select(`COUNT(CASE WHEN page_views > 0 THEN 1 END) AS visits,
			COUNT(CASE WHEN page_views > 0 AND has_action = 1 THEN 1 END) AS engaged_visits,
			COUNT(CASE WHEN page_views = 1 THEN 1 END) AS one,
			COUNT(CASE WHEN page_views BETWEEN 2 AND 3 THEN 1 END) AS two_three,
			COUNT(CASE WHEN page_views >= 4 THEN 1 END) AS four_plus`).
		Scan(&sessionCounts).Error; err != nil {
		return nil, err
	}
	result.Engagement = sessionCounts.SiteTrafficEngagementCounts
	result.Depth = SiteTrafficDepthCounts{Visits: sessionCounts.Visits, One: sessionCounts.One, TwoThree: sessionCounts.TwoThree, FourPlus: sessionCounts.FourPlus}
	// Unix 秒先平移 UTC+8，再按整数自然日分组；SQLite/PostgreSQL 均不依赖连接或宿主机时区。
	day := "CAST((received_at_epoch + 28800) / 86400 AS BIGINT)"
	if err := inRange().Select(day + " AS day_number, " + siteTrafficCountsSQL).
		Group(day).Order("day_number ASC").Limit(365).Scan(&result.Trend).Error; err != nil {
		return nil, err
	}
	if err := inRange().Where("type = ?", "page_view").
		Select("page, COUNT(*) AS page_views, COUNT(DISTINCT visitor_hash) AS visitors, COUNT(DISTINCT session_hash) AS visits").
		Group("page").Order("page_views DESC, page ASC").Limit(20).Scan(&result.Pages).Error; err != nil {
		return nil, err
	}
	if err := inRange().Where("type = ?", "action").
		Select("action, page, COUNT(*) AS count, COUNT(DISTINCT visitor_hash) AS visitors").
		Group("action, page").Order("count DESC, action ASC, page ASC").Limit(140).Scan(&result.Actions).Error; err != nil {
		return nil, err
	}
	// 按绝对北京时间小时聚合后由app折叠到星期/小时，不逐小时发SQL。
	hour := "CAST((received_at_epoch + 28800) / 3600 AS BIGINT)"
	if err := inRange().Where("type = ?", "page_view").
		Select(hour + " AS hour_number, COUNT(*) AS page_views").Group(hour).Order("hour_number ASC").
		Limit(8760).Scan(&result.Heatmap).Error; err != nil {
		return nil, err
	}
	if err := inRange().Where("type = ? AND action IN ?", "action", []string{
		"open_create", "new_canvas", "open_ecommerce", "creation_submit_text",
		"creation_submit_image", "creation_submit_video", "creation_submit_agent",
	}).Select(day + " AS day_number, action, COUNT(*) AS count").Group(day + ", action").
		Order("day_number ASC, action ASC").Limit(2555).Scan(&result.FeatureTrend).Error; err != nil {
		return nil, err
	}
	// 同一session+page先取标志再做交集；跨页操作、非法pair和重复事件不能放大分子。
	pageSessions := inRange().Select(`session_hash, page,
		MAX(CASE WHEN type = 'page_view' THEN 1 ELSE 0 END) AS has_page_view,
		MAX(CASE WHEN type = 'action' AND ` + siteTrafficMeasuredActionSQL + ` THEN 1 ELSE 0 END) AS has_action`).
		Group("session_hash, page")
	if err := fresh().Table("(?) AS page_session_flags", pageSessions).
		Select(`page, COUNT(CASE WHEN has_page_view = 1 THEN 1 END) AS visits,
			COUNT(CASE WHEN has_page_view = 1 AND has_action = 1 THEN 1 END) AS engaged_visits`).
		Group("page").Order("page ASC").Limit(20).Scan(&result.PageEngagement).Error; err != nil {
		return nil, err
	}
	var earliest struct{ Epoch *int64 }
	// 过期事件可能尚待 Worker 单批清理，读取时排除它们；此值不是统计实际启用时刻。
	if err := fresh().Model(&model.SiteTrafficEvent{}).Where(siteTrafficCurrentPagesSQL).Select("MIN(received_at_epoch) AS epoch").
		Where("received_at_epoch >= ?", retentionStart.Unix()).Scan(&earliest).Error; err != nil {
		return nil, err
	}
	result.EarliestEpoch = earliest.Epoch
	result.Operations, err = r.siteTrafficOperations(from, to, retentionStart)
	if err != nil {
		return nil, err
	}
	return result, nil
}

// SiteTrafficKPI 上期只聚合范围指标，不重复查询趋势和排行。
func (r *Repository) SiteTrafficKPI(from, to time.Time) (*SiteTrafficCounts, error) {
	var result SiteTrafficCounts
	if err := r.db.Session(&gorm.Session{NewDB: true}).Model(&model.SiteTrafficEvent{}).Where(siteTrafficCurrentPagesSQL).
		Where("received_at_epoch >= ? AND received_at_epoch < ?", from.Unix(), to.Unix()).
		Select(siteTrafficCountsSQL).Scan(&result).Error; err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *Repository) SiteTrafficToday(dayStart, activeFrom, to time.Time) (*SiteTrafficTodayAggregates, error) {
	result := &SiteTrafficTodayAggregates{Hours: make([]SiteTrafficHourlyCounts, 0, 24)}
	hour := "CAST((received_at_epoch + 28800) / 3600 AS BIGINT) % 24"
	if err := r.db.Model(&model.SiteTrafficEvent{}).Where(siteTrafficCurrentPagesSQL).
		Where("received_at_epoch >= ? AND received_at_epoch < ?", dayStart.Unix(), to.Unix()).
		Select(hour + " AS hour, " + siteTrafficCountsSQL).Group(hour).Order("hour ASC").
		Scan(&result.Hours).Error; err != nil {
		return nil, err
	}
	// 活跃访客按两类已采集事件独立去重，滚动窗口跨午夜也不截断到今日零点。
	if err := r.db.Model(&model.SiteTrafficEvent{}).Where(siteTrafficCurrentPagesSQL).
		Where("received_at_epoch >= ? AND received_at_epoch < ?", activeFrom.Unix(), to.Unix()).
		Where("type IN ?", []string{"page_view", "action"}).
		Select("COUNT(DISTINCT visitor_hash)").Scan(&result.ActiveVisitors).Error; err != nil {
		return nil, err
	}
	return result, nil
}

// DeleteSiteTrafficEventsBefore 每次最多删除1000行，DELETE 重验截止点，只触及独立访问事件表。
func (r *Repository) DeleteSiteTrafficEventsBefore(cutoff time.Time, batchSize int) (int64, error) {
	if cutoff.IsZero() {
		return 0, nil
	}
	if batchSize <= 0 || batchSize > 1000 {
		batchSize = 1000
	}
	var ids []string
	if err := r.db.Model(&model.SiteTrafficEvent{}).Where("received_at_epoch < ?", cutoff.Unix()).
		Order("received_at_epoch ASC, id ASC").Limit(batchSize).Pluck("id", &ids).Error; err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, nil
	}
	result := r.db.Where("id IN ? AND received_at_epoch < ?", ids, cutoff.Unix()).Delete(&model.SiteTrafficEvent{})
	return result.RowsAffected, result.Error
}
