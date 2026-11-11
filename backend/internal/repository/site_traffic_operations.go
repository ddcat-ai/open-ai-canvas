package repository

import (
	"time"

	"gorm.io/gorm"
)

type SiteTrafficVisitorMixCounts struct {
	Visitors              int64
	FirstObservedVisitors int64
	ReturningVisitors     int64
}

type SiteTrafficEndpointPageCounts struct {
	Page   string
	Visits int64
}

type SiteTrafficEndpointSideCounts struct {
	UndeterminedVisits int64
	Pages              []SiteTrafficEndpointPageCounts
}

type SiteTrafficEndpointCounts struct {
	Visits int64
	First  SiteTrafficEndpointSideCounts
	Last   SiteTrafficEndpointSideCounts
}

type SiteTrafficPathPairCounts struct {
	From   string
	To     string
	Visits int64
}

type SiteTrafficPathCounts struct {
	Visits          int64
	AmbiguousVisits int64
	Rows            []SiteTrafficPathPairCounts
}

type SiteTrafficFunnelCounts struct {
	Step           int
	Visits         int64
	PossibleVisits int64
}

type SiteTrafficOperationsAggregates struct {
	VisitorMix SiteTrafficVisitorMixCounts
	Endpoints  SiteTrafficEndpointCounts
	Paths      SiteTrafficPathCounts
	Funnel     []SiteTrafficFunnelCounts
}

type siteTrafficEndpointRow struct {
	Visits         int64
	Endpoint       string
	Page           string
	EndpointVisits int64
}

type siteTrafficPathRow struct {
	Visits          int64
	AmbiguousVisits int64
	FromPage        string
	ToPage          string
	PairVisits      int64
}

// 四条独立聚合只回传计数；NewDB保留取消上下文，不继承原overview的语句状态。
func (r *Repository) siteTrafficOperations(from, to, retentionStart time.Time) (SiteTrafficOperationsAggregates, error) {
	result := SiteTrafficOperationsAggregates{
		Endpoints: SiteTrafficEndpointCounts{
			First: SiteTrafficEndpointSideCounts{Pages: make([]SiteTrafficEndpointPageCounts, 0, 13)},
			Last:  SiteTrafficEndpointSideCounts{Pages: make([]SiteTrafficEndpointPageCounts, 0, 13)},
		},
		Paths:  SiteTrafficPathCounts{Rows: make([]SiteTrafficPathPairCounts, 0, 10)},
		Funnel: make([]SiteTrafficFunnelCounts, 0, 4),
	}
	fresh := func() *gorm.DB { return r.db.Session(&gorm.Session{NewDB: true}) }
	// firstObserved仅表示保留窗内未观察到前置PV，不是个人真实首访或统计启用时间。
	if err := fresh().Raw(`WITH current_visitors AS (
		SELECT DISTINCT visitor_hash FROM site_traffic_events WHERE `+siteTrafficCurrentPagesSQL+`
			AND type = ? AND received_at_epoch >= ? AND received_at_epoch < ?
	), prior_visitors AS (
		SELECT DISTINCT visitor_hash FROM site_traffic_events WHERE `+siteTrafficCurrentPagesSQL+`
			AND type = ? AND received_at_epoch >= ? AND received_at_epoch < ?
	)
	SELECT COUNT(*) AS visitors,
		COUNT(CASE WHEN p.visitor_hash IS NULL THEN 1 END) AS first_observed_visitors,
		COUNT(p.visitor_hash) AS returning_visitors
	FROM current_visitors c LEFT JOIN prior_visitors p ON p.visitor_hash = c.visitor_hash`,
		"page_view", from.Unix(), to.Unix(), "page_view", retentionStart.Unix(), from.Unix()).
		Scan(&result.VisitorMix).Error; err != nil {
		return SiteTrafficOperationsAggregates{}, err
	}

	var endpoints []siteTrafficEndpointRow
	// 同一收到秒多页时不以随机事件ID判先后；同秒同页重复PV仍可确定端点。
	if err := fresh().Raw(`WITH pv AS (
		SELECT session_hash, received_at_epoch, page FROM site_traffic_events WHERE `+siteTrafficCurrentPagesSQL+`
			AND type = ? AND received_at_epoch >= ? AND received_at_epoch < ?
	), bounds AS (
		SELECT session_hash, MIN(received_at_epoch) AS first_epoch, MAX(received_at_epoch) AS last_epoch
		FROM pv GROUP BY session_hash
	), endpoint_buckets AS (
		SELECT 'first' AS endpoint, b.session_hash, MIN(p.page) AS page, COUNT(DISTINCT p.page) AS page_count
		FROM bounds b JOIN pv p ON p.session_hash = b.session_hash AND p.received_at_epoch = b.first_epoch
		GROUP BY b.session_hash
		UNION ALL
		SELECT 'last' AS endpoint, b.session_hash, MIN(p.page) AS page, COUNT(DISTINCT p.page) AS page_count
		FROM bounds b JOIN pv p ON p.session_hash = b.session_hash AND p.received_at_epoch = b.last_epoch
		GROUP BY b.session_hash
	), endpoint_counts AS (
		SELECT endpoint, CASE WHEN page_count = 1 THEN page ELSE '' END AS page, COUNT(*) AS endpoint_visits
		FROM endpoint_buckets GROUP BY endpoint, CASE WHEN page_count = 1 THEN page ELSE '' END
	), totals AS (
		SELECT COUNT(*) AS visits FROM bounds
	)
	SELECT t.visits, COALESCE(c.endpoint, '') AS endpoint, COALESCE(c.page, '') AS page,
		COALESCE(c.endpoint_visits, 0) AS endpoint_visits
	FROM totals t LEFT JOIN endpoint_counts c ON 1 = 1
	ORDER BY c.endpoint ASC, c.endpoint_visits DESC, c.page ASC`, "page_view", from.Unix(), to.Unix()).
		Scan(&endpoints).Error; err != nil {
		return SiteTrafficOperationsAggregates{}, err
	}
	for _, row := range endpoints {
		result.Endpoints.Visits = row.Visits
		var side *SiteTrafficEndpointSideCounts
		switch row.Endpoint {
		case "first":
			side = &result.Endpoints.First
		case "last":
			side = &result.Endpoints.Last
		default:
			continue
		}
		if row.Page == "" {
			side.UndeterminedVisits = row.EndpointVisits
		} else {
			side.Pages = append(side.Pages, SiteTrafficEndpointPageCounts{Page: row.Page, Visits: row.EndpointVisits})
		}
	}

	var paths []siteTrafficPathRow
	// LEAD作用于完整秒桶序列，不能先删除歧义桶后拼接；这里只是接收投影关联，不是真实直接跳转。
	if err := fresh().Raw(`WITH buckets AS (
		SELECT session_hash, received_at_epoch, MIN(page) AS page, COUNT(DISTINCT page) AS page_count
		FROM site_traffic_events WHERE `+siteTrafficCurrentPagesSQL+`
			AND type = ? AND received_at_epoch >= ? AND received_at_epoch < ?
		GROUP BY session_hash, received_at_epoch
	), sequenced AS (
		SELECT session_hash, page, page_count,
			LEAD(page) OVER (PARTITION BY session_hash ORDER BY received_at_epoch) AS next_page,
			LEAD(page_count) OVER (PARTITION BY session_hash ORDER BY received_at_epoch) AS next_page_count
		FROM buckets
	), pairs AS (
		SELECT DISTINCT session_hash, page AS from_page, next_page AS to_page FROM sequenced
		WHERE page_count = 1 AND next_page_count = 1 AND page <> next_page
	), top_pairs AS (
		SELECT from_page, to_page, COUNT(*) AS pair_visits FROM pairs GROUP BY from_page, to_page
		ORDER BY pair_visits DESC, from_page ASC, to_page ASC LIMIT 10
	), totals AS (
		SELECT COUNT(DISTINCT session_hash) AS visits,
			COUNT(DISTINCT CASE WHEN page_count > 1 THEN session_hash END) AS ambiguous_visits FROM buckets
	)
	SELECT t.visits, t.ambiguous_visits, COALESCE(p.from_page, '') AS from_page,
		COALESCE(p.to_page, '') AS to_page, COALESCE(p.pair_visits, 0) AS pair_visits
	FROM totals t LEFT JOIN top_pairs p ON 1 = 1
	ORDER BY p.pair_visits DESC, p.from_page ASC, p.to_page ASC`, "page_view", from.Unix(), to.Unix()).
		Scan(&paths).Error; err != nil {
		return SiteTrafficOperationsAggregates{}, err
	}
	for _, row := range paths {
		result.Paths.Visits, result.Paths.AmbiguousVisits = row.Visits, row.AmbiguousVisits
		if row.FromPage != "" {
			result.Paths.Rows = append(result.Paths.Rows, SiteTrafficPathPairCounts{From: row.FromPage, To: row.ToPage, Visits: row.PairVisits})
		}
	}

	// 每阶段分别贪心取strict(>)及possible(>=)最早后继，不能用各阶段独立MIN漏掉先坏后好的链。
	// 收到秒不等于发生顺序，同秒可能链单列，不把未定顺序当作确定流失。
	if err := fresh().Raw(`WITH events AS (
		SELECT session_hash, received_at_epoch, CASE
			WHEN type = ? AND page = ? THEN 1
			WHEN type = ? AND page = ? AND action = ? THEN 2
			WHEN type = ? AND page = ? THEN 3
			WHEN type = ? AND page = ? AND action IN ? THEN 4 ELSE 0 END AS step
		FROM site_traffic_events WHERE `+siteTrafficCurrentPagesSQL+`
			AND received_at_epoch >= ? AND received_at_epoch < ?
	), first_step AS (
		SELECT session_hash, MIN(received_at_epoch) AS first_epoch FROM events WHERE step = 1 GROUP BY session_hash
	), second_step AS (
		SELECT f.session_hash, f.first_epoch,
			MIN(CASE WHEN e.received_at_epoch > f.first_epoch THEN e.received_at_epoch END) AS strict_second,
			MIN(CASE WHEN e.received_at_epoch >= f.first_epoch THEN e.received_at_epoch END) AS possible_second
		FROM first_step f LEFT JOIN events e ON e.session_hash = f.session_hash AND e.step = 2
		GROUP BY f.session_hash, f.first_epoch
	), third_step AS (
		SELECT s.session_hash, s.first_epoch, s.strict_second, s.possible_second,
			MIN(CASE WHEN e.received_at_epoch > s.strict_second THEN e.received_at_epoch END) AS strict_third,
			MIN(CASE WHEN e.received_at_epoch >= s.possible_second THEN e.received_at_epoch END) AS possible_third
		FROM second_step s LEFT JOIN events e ON e.session_hash = s.session_hash AND e.step = 3
		GROUP BY s.session_hash, s.first_epoch, s.strict_second, s.possible_second
	), fourth_step AS (
		SELECT t.session_hash, t.first_epoch, t.strict_second, t.possible_second, t.strict_third, t.possible_third,
			MIN(CASE WHEN e.received_at_epoch > t.strict_third THEN e.received_at_epoch END) AS strict_fourth,
			MIN(CASE WHEN e.received_at_epoch >= t.possible_third THEN e.received_at_epoch END) AS possible_fourth
		FROM third_step t LEFT JOIN events e ON e.session_hash = t.session_hash AND e.step = 4
		GROUP BY t.session_hash, t.first_epoch, t.strict_second, t.possible_second, t.strict_third, t.possible_third
	), stages AS (
		SELECT 1 AS step, COUNT(*) AS visits, COUNT(*) AS possible_visits FROM fourth_step
		UNION ALL SELECT 2 AS step, COUNT(strict_second) AS visits, COUNT(possible_second) AS possible_visits FROM fourth_step
		UNION ALL SELECT 3 AS step, COUNT(strict_third) AS visits, COUNT(possible_third) AS possible_visits FROM fourth_step
		UNION ALL SELECT 4 AS step, COUNT(strict_fourth) AS visits, COUNT(possible_fourth) AS possible_visits FROM fourth_step
	)
	SELECT step, visits, possible_visits FROM stages ORDER BY step ASC`,
		"page_view", "inspirations", "action", "inspirations", "open_create", "page_view", "create", "action", "create",
		[]string{"creation_submit_text", "creation_submit_image", "creation_submit_video", "creation_submit_agent"}, from.Unix(), to.Unix()).
		Scan(&result.Funnel).Error; err != nil {
		return SiteTrafficOperationsAggregates{}, err
	}
	return result, nil
}
