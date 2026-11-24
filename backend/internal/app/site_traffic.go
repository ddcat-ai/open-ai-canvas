package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"github.com/google/uuid"
)

const siteTrafficRetentionDays = 365

// 访问统计固定北京时间自然日，不随服务器 time.Local 或数据库 session 时区变化。
var siteTrafficLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

var siteTrafficPages = map[string]struct{}{
	"inspirations": {}, "create": {}, "canvas_list": {}, "canvas": {},
	"assets": {}, "history": {}, "ecommerce": {}, "ecommerce_pipeline": {}, "drama": {},
	"skills": {}, "referral": {}, "tools_image": {}, "tools_video": {},
}

var siteTrafficActions = map[string]struct{}{
	"open_create": {}, "new_canvas": {}, "open_ecommerce": {},
	"creation_submit_text": {}, "creation_submit_image": {},
	"creation_submit_video": {}, "creation_submit_agent": {},
}

type SiteTrafficEventRequest struct {
	ID        string `json:"id"`
	VisitorID string `json:"visitorId"`
	SessionID string `json:"sessionId"`
	Type      string `json:"type"`
	Page      string `json:"page"`
	Action    string `json:"action,omitempty"`
}

type SiteTrafficBatchRequest struct {
	Events []SiteTrafficEventRequest `json:"events"`
}

type SiteTrafficAccepted struct {
	Accepted int64 `json:"accepted"`
}

type SiteTrafficQuery struct {
	From string
	To   string
}

type SiteTrafficRange struct {
	From     string `json:"from"`
	To       string `json:"to"`
	TimeZone string `json:"timeZone"`
}

type SiteTrafficTrendPoint struct {
	Date string `json:"date"`
	repository.SiteTrafficCounts
}

type SiteTrafficEngagement struct {
	repository.SiteTrafficEngagementCounts
	Rate *float64 `json:"rate"`
}

type SiteTrafficComparison struct {
	Range         SiteTrafficRange              `json:"range"`
	EffectiveFrom string                        `json:"effectiveFrom"`
	EffectiveTo   string                        `json:"effectiveTo"`
	Status        string                        `json:"status"`
	KPI           *repository.SiteTrafficCounts `json:"kpi"`
}

type SiteTrafficFeaturePoint struct {
	Date          string           `json:"date"`
	Partial       bool             `json:"partial"`
	HistoryStatus string           `json:"historyStatus"`
	Counts        map[string]int64 `json:"counts"`
}

type SiteTrafficHeatmapCell struct {
	Weekday        int    `json:"weekday"`
	Hour           int    `json:"hour"`
	PageViews      *int64 `json:"pageViews"`
	Hours          int    `json:"hours"`
	CompletedHours int    `json:"completedHours"`
	Partial        bool   `json:"partial"`
	HistoryStatus  string `json:"historyStatus"`
}

type SiteTrafficPageEngagement struct {
	Page          string   `json:"page"`
	Measurement   string   `json:"measurement"`
	Visits        int64    `json:"visits"`
	EngagedVisits *int64   `json:"engagedVisits"`
	Rate          *float64 `json:"rate"`
}

type SiteTrafficDepthBucket struct {
	Key    string   `json:"key"`
	Visits int64    `json:"visits"`
	Rate   *float64 `json:"rate"`
}

type SiteTrafficDepth struct {
	Visits  int64                    `json:"visits"`
	Buckets []SiteTrafficDepthBucket `json:"buckets"`
}

type SiteTrafficInsights struct {
	Heatmap        []SiteTrafficHeatmapCell    `json:"heatmap"`
	FeatureTrend   []SiteTrafficFeaturePoint   `json:"featureTrend"`
	PageEngagement []SiteTrafficPageEngagement `json:"pageEngagement"`
	Depth          SiteTrafficDepth            `json:"depth"`
	Operations     SiteTrafficOperations       `json:"operations"`
}

type SiteTrafficOverview struct {
	Range         SiteTrafficRange               `json:"range"`
	RetentionDays int                            `json:"retentionDays"`
	AvailableFrom *string                        `json:"availableFrom"`
	AsOf          string                         `json:"asOf"`
	EffectiveFrom string                         `json:"effectiveFrom"`
	EffectiveTo   string                         `json:"effectiveTo"`
	Engagement    SiteTrafficEngagement          `json:"engagement"`
	Comparison    SiteTrafficComparison          `json:"comparison"`
	KPI           repository.SiteTrafficCounts   `json:"kpi"`
	Trend         []SiteTrafficTrendPoint        `json:"trend"`
	Pages         []repository.SiteTrafficPage   `json:"pages"`
	Actions       []repository.SiteTrafficAction `json:"actions"`
	Insights      SiteTrafficInsights            `json:"insights"`
}

type SiteTrafficActiveVisitors struct {
	Visitors   int64  `json:"visitors"`
	WindowFrom string `json:"windowFrom"`
	WindowTo   string `json:"windowTo"`
}

type SiteTrafficHour struct {
	repository.SiteTrafficHourlyCounts
	Partial bool `json:"partial"`
}

type SiteTrafficToday struct {
	Date     string                    `json:"date"`
	TimeZone string                    `json:"timeZone"`
	AsOf     string                    `json:"asOf"`
	Active   SiteTrafficActiveVisitors `json:"active"`
	Hours    []SiteTrafficHour         `json:"hours"`
}

func siteTrafficUUID(value string) (string, bool) {
	// uuid.Parse 也接受 URN/无横线形式；匿名随机 ID 只允许规范 UUIDv4，拒绝 nil 和带时间/节点信息的版本。
	if len(value) != 36 {
		return "", false
	}
	id, err := uuid.Parse(value)
	if err != nil || id.Version() != 4 || id.Variant() != uuid.RFC4122 || !strings.EqualFold(id.String(), value) {
		return "", false
	}
	return id.String(), true
}

func prepareSiteTrafficEvents(request SiteTrafficBatchRequest, now time.Time) ([]model.SiteTrafficEvent, error) {
	if len(request.Events) == 0 || len(request.Events) > 20 {
		return nil, NewAppError(http.StatusBadRequest, "访问事件每批必须为1至20条")
	}
	events := make([]model.SiteTrafficEvent, 0, len(request.Events))
	for _, event := range request.Events {
		id, validID := siteTrafficUUID(event.ID)
		visitor, validVisitor := siteTrafficUUID(event.VisitorID)
		session, validSession := siteTrafficUUID(event.SessionID)
		if !validID || !validVisitor || !validSession {
			return nil, NewAppError(http.StatusBadRequest, "访问事件及访客、会话标识必须为随机UUID")
		}
		if _, allowed := siteTrafficPages[event.Page]; !allowed {
			return nil, NewAppError(http.StatusBadRequest, "访问事件页面不在允许范围内")
		}
		switch event.Type {
		case "page_view":
			if event.Action != "" {
				return nil, NewAppError(http.StatusBadRequest, "页面访问不能携带操作键")
			}
		case "action":
			if _, allowed := siteTrafficActions[event.Action]; !allowed {
				return nil, NewAppError(http.StatusBadRequest, "访问事件操作不在允许范围内")
			}
		default:
			return nil, NewAppError(http.StatusBadRequest, "访问事件类型无效")
		}
		visitorHash := sha256.Sum256([]byte(visitor))
		sessionHash := sha256.Sum256([]byte(session))
		events = append(events, model.SiteTrafficEvent{
			ID: id, VisitorHash: hex.EncodeToString(visitorHash[:]), SessionHash: hex.EncodeToString(sessionHash[:]),
			ReceivedAtEpoch: now.UTC().Unix(), Type: event.Type, Page: event.Page, Action: event.Action,
		})
	}
	return events, nil
}

// RecordSiteTrafficEvents 不读取可选登录态；整个批次先强校验，再按事件ID幂等插入。
func (s *Service) RecordSiteTrafficEvents(ctx context.Context, request SiteTrafficBatchRequest) (*SiteTrafficAccepted, error) {
	events, err := prepareSiteTrafficEvents(request, time.Now())
	if err != nil {
		return nil, err
	}
	accepted, err := s.repo.WithContext(ctx).InsertSiteTrafficEvents(events)
	if err != nil {
		return nil, err
	}
	return &SiteTrafficAccepted{Accepted: accepted}, nil
}

func siteTrafficToday(now time.Time) time.Time {
	local := now.In(siteTrafficLocation)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, siteTrafficLocation)
}

func siteTrafficRetentionStart(now time.Time) time.Time {
	return siteTrafficToday(now).AddDate(0, 0, -(siteTrafficRetentionDays - 1))
}

func parseSiteTrafficRange(query SiteTrafficQuery, now time.Time) (time.Time, time.Time, error) {
	today := siteTrafficToday(now)
	parse := func(value string) (time.Time, error) {
		date, err := time.ParseInLocation("2006-01-02", value, siteTrafficLocation)
		if err != nil || date.Format("2006-01-02") != value {
			return time.Time{}, NewAppError(http.StatusBadRequest, "访问统计日期必须为有效的YYYY-MM-DD")
		}
		return date, nil
	}
	to := today
	var err error
	if query.To != "" {
		to, err = parse(query.To)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
	}
	from := to.AddDate(0, 0, -29)
	if query.From != "" {
		from, err = parse(query.From)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
	}
	if from.After(to) || to.After(today) || from.Before(siteTrafficRetentionStart(now)) {
		return time.Time{}, time.Time{}, NewAppError(http.StatusBadRequest, "访问统计范围必须顺序正确且位于含今日的最近365个北京时间自然日内")
	}
	return from, to.AddDate(0, 0, 1), nil
}

func (s *Service) AdminSiteTrafficOverview(ctx context.Context, actor *model.User, query SiteTrafficQuery) (*SiteTrafficOverview, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.adminSiteTrafficOverviewAt(ctx, query, time.Now())
}

func (s *Service) adminSiteTrafficOverviewAt(ctx context.Context, query SiteTrafficQuery, now time.Time) (*SiteTrafficOverview, error) {
	// 入库精度为秒；整次读取共用一个半开截止点，含今日时不把未来时段混入本期或上期。
	now = now.In(siteTrafficLocation).Truncate(time.Second)
	from, to, err := parseSiteTrafficRange(query, now)
	if err != nil {
		return nil, err
	}
	effectiveTo := to
	if now.Before(effectiveTo) {
		effectiveTo = now
	}
	retentionStart := siteTrafficRetentionStart(now)
	repo := s.repo.WithContext(ctx)
	aggregates, err := repo.SiteTrafficOverview(from, effectiveTo, retentionStart)
	if err != nil {
		return nil, err
	}
	days := int(to.Sub(from) / (24 * time.Hour))
	previousFrom, previousTo := from.AddDate(0, 0, -days), to.AddDate(0, 0, -days)
	previousEffectiveTo := effectiveTo.AddDate(0, 0, -days)
	result := &SiteTrafficOverview{
		Range:         SiteTrafficRange{From: from.Format("2006-01-02"), To: to.AddDate(0, 0, -1).Format("2006-01-02"), TimeZone: "Asia/Shanghai"},
		RetentionDays: siteTrafficRetentionDays, KPI: aggregates.KPI,
		AsOf: now.UTC().Format(time.RFC3339), EffectiveFrom: from.UTC().Format(time.RFC3339), EffectiveTo: effectiveTo.UTC().Format(time.RFC3339),
		Engagement: SiteTrafficEngagement{SiteTrafficEngagementCounts: aggregates.Engagement},
		Comparison: SiteTrafficComparison{
			Range:         SiteTrafficRange{From: previousFrom.Format("2006-01-02"), To: previousTo.AddDate(0, 0, -1).Format("2006-01-02"), TimeZone: "Asia/Shanghai"},
			EffectiveFrom: previousFrom.UTC().Format(time.RFC3339), EffectiveTo: previousEffectiveTo.UTC().Format(time.RFC3339),
			Status: "insufficient_history",
		},
		Trend: make([]SiteTrafficTrendPoint, 0, 365), Pages: aggregates.Pages, Actions: aggregates.Actions,
		Insights: buildSiteTrafficInsights(aggregates, from, to, effectiveTo, now),
	}
	if aggregates.Engagement.Visits > 0 {
		rate := float64(aggregates.Engagement.EngagedVisits) / float64(aggregates.Engagement.Visits)
		result.Engagement.Rate = &rate
	}
	if aggregates.EarliestEpoch != nil {
		first := time.Unix(*aggregates.EarliestEpoch, 0).UTC().Format(time.RFC3339)
		result.AvailableFrom = &first
	}
	if previousFrom.Before(retentionStart) {
		result.Comparison.Status = "outside_retention"
	} else if aggregates.EarliestEpoch != nil && *aggregates.EarliestEpoch <= previousFrom.Unix() {
		// 最早留存记录只能排除明确不足；ready 不保证期间采集完整，也不把未知上期补成零。
		result.Comparison.KPI, err = repo.SiteTrafficKPI(previousFrom, previousEffectiveTo)
		if err != nil {
			return nil, err
		}
		result.Comparison.Status = "ready"
	}
	result.Insights.Operations = buildSiteTrafficOperations(aggregates.Operations, from, retentionStart, result.KPI, result.Comparison)
	daily := make(map[string]repository.SiteTrafficCounts, len(aggregates.Trend))
	for _, point := range aggregates.Trend {
		date := time.Unix(point.DayNumber*86400, 0).UTC().Format("2006-01-02")
		daily[date] = point.SiteTrafficCounts
	}
	for day := from; day.Before(to); day = day.AddDate(0, 0, 1) {
		date := day.Format("2006-01-02")
		result.Trend = append(result.Trend, SiteTrafficTrendPoint{Date: date, SiteTrafficCounts: daily[date]})
	}
	return result, nil
}

func (s *Service) AdminSiteTrafficToday(ctx context.Context, actor *model.User) (*SiteTrafficToday, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.adminSiteTrafficTodayAt(ctx, time.Now())
}

func (s *Service) adminSiteTrafficTodayAt(ctx context.Context, now time.Time) (*SiteTrafficToday, error) {
	now = now.In(siteTrafficLocation).Truncate(time.Second)
	today := siteTrafficToday(now)
	activeFrom := now.Add(-300 * time.Second)
	aggregates, err := s.repo.WithContext(ctx).SiteTrafficToday(today, activeFrom, now)
	if err != nil {
		return nil, err
	}
	result := &SiteTrafficToday{
		Date: today.Format("2006-01-02"), TimeZone: "Asia/Shanghai", AsOf: now.UTC().Format(time.RFC3339),
		Active: SiteTrafficActiveVisitors{
			Visitors: aggregates.ActiveVisitors, WindowFrom: activeFrom.UTC().Format(time.RFC3339), WindowTo: now.UTC().Format(time.RFC3339),
		},
		Hours: make([]SiteTrafficHour, 0, 24),
	}
	hourly := make(map[int]repository.SiteTrafficHourlyCounts, len(aggregates.Hours))
	for _, point := range aggregates.Hours {
		hourly[point.Hour] = point
	}
	currentHour := now.In(siteTrafficLocation).Hour()
	for hour := 0; hour <= currentHour; hour++ {
		point := hourly[hour]
		point.Hour = hour
		result.Hours = append(result.Hours, SiteTrafficHour{SiteTrafficHourlyCounts: point, Partial: hour == currentHour})
	}
	return result, nil
}
