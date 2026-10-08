package app

import (
	"log"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

type AnalyticsQuery struct {
	From       string
	To         string
	UserID     string
	Model      string
	ChannelID  string
	Capability string
}

type AnalyticsOverview struct {
	From     time.Time             `json:"from"`
	To       time.Time             `json:"to"`
	KPI      AnalyticsKPI          `json:"kpi"`
	Trend    []AnalyticsTrendPoint `json:"trend"`
	Models   []AnalyticsModelRow   `json:"models"`
	Users    []AnalyticsUserRow    `json:"users"`
	Failures []AnalyticsFailureRow `json:"failures"`
}

type AnalyticsKPI struct {
	ActiveUsers        int              `json:"activeUsers"`
	DAU                int              `json:"dau"`
	WAU                int              `json:"wau"`
	MAU                int              `json:"mau"`
	GenerationTasks    int              `json:"generationTasks"`
	UpstreamRequests   int              `json:"upstreamRequests"`
	SuccessRate        float64          `json:"successRate"`
	P95DurationMs      int64            `json:"p95DurationMs"`
	CurrentQueuedTasks int64            `json:"currentQueuedTasks"`
	Finance            AnalyticsFinance `json:"finance"`
}

type AnalyticsTrendPoint struct {
	Day                string  `json:"day"`
	Tasks              int     `json:"tasks"`
	Requests           int     `json:"requests"`
	ActiveUsers        int     `json:"activeUsers"`
	RequestSuccessRate float64 `json:"requestSuccessRate"`
}

type AnalyticsModelRow struct {
	Model              string           `json:"model"`
	Capability         string           `json:"capability"`
	Tasks              int              `json:"tasks"`
	Requests           int              `json:"requests"`
	UniqueUsers        int              `json:"uniqueUsers"`
	TaskSuccessRate    float64          `json:"taskSuccessRate"`
	RequestSuccessRate float64          `json:"requestSuccessRate"`
	P50DurationMs      int64            `json:"p50DurationMs"`
	P95DurationMs      int64            `json:"p95DurationMs"`
	InputTokens        int64            `json:"inputTokens"`
	OutputTokens       int64            `json:"outputTokens"`
	CachedTokens       int64            `json:"cachedTokens"`
	UsageAvailable     bool             `json:"usageAvailable"`
	MediaCount         int              `json:"mediaCount"`
	VideoSeconds       int              `json:"videoSeconds"`
	Finance            AnalyticsFinance `json:"finance"`
}

type AnalyticsUserRow struct {
	UserID        string `json:"userId"`
	Name          string `json:"name"`
	ActiveDays    int    `json:"activeDays"`
	Tasks         int    `json:"tasks"`
	AgentMessages int    `json:"agentMessages"`
	CanvasDays    int    `json:"canvasDays"`
	Assets        int    `json:"assets"`
	Resources     int    `json:"resources"`
	CommonModel   string `json:"commonModel"`
}

type AnalyticsFailureRow struct {
	Type       string    `json:"type"`
	Model      string    `json:"model"`
	Count      int       `json:"count"`
	LastError  string    `json:"lastError"`
	LastSeenAt time.Time `json:"lastSeenAt"`
}

type APICallLogQuery struct {
	AnalyticsQuery
	RecordType string
	Keyword    string
	Status     string
	IDs        []string
	Page       int
	Limit      int
}

type APICallLogPage struct {
	Logs  []model.ApiCallLog `json:"logs"`
	Total int64              `json:"total"`
	Page  int                `json:"page"`
	Limit int                `json:"pageSize"`
}

type ModelPricingRequest struct {
	ChannelID              string `json:"channelId"`
	Model                  string `json:"model"`
	Capability             string `json:"capability"`
	Currency               string `json:"currency"`
	InputPerMillionMicros  int64  `json:"inputPerMillionMicros"`
	OutputPerMillionMicros int64  `json:"outputPerMillionMicros"`
	CachedPerMillionMicros int64  `json:"cachedPerMillionMicros"`
	PerRequestMicros       int64  `json:"perRequestMicros"`
	PerMediaMicros         int64  `json:"perMediaMicros"`
	PerVideoSecondMicros   int64  `json:"perVideoSecondMicros"`
}

func (s *Service) AdminAnalytics(actor *model.User, query AnalyticsQuery) (*AnalyticsOverview, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	filter := normalizeAnalyticsFilter(query)
	tasks, err := s.repo.AnalyticsTasks(filter)
	if err != nil {
		return nil, err
	}
	logs, err := s.repo.AnalyticsAPICallLogs(filter)
	if err != nil {
		return nil, err
	}
	if filter.ChannelID != "" {
		tasks = tasksWithLoggedRequests(tasks, logs)
	}
	activityFilter := filter
	rollingFrom := filter.To.AddDate(0, 0, -30)
	if rollingFrom.Before(activityFilter.From) {
		activityFilter.From = rollingFrom
	}
	activities, err := s.repo.AnalyticsActivities(activityFilter)
	if err != nil {
		return nil, err
	}
	rollingTasks := tasks
	rollingLogs := logs
	if activityFilter.From.Before(filter.From) {
		rollingTasks, err = s.repo.AnalyticsTasks(activityFilter)
		if err != nil {
			return nil, err
		}
		if hasCreationDimensionFilter(filter) {
			rollingLogs, err = s.repo.AnalyticsAPICallLogs(activityFilter)
			if err != nil {
				return nil, err
			}
		}
		if filter.ChannelID != "" {
			rollingTasks = tasksWithLoggedRequests(rollingTasks, rollingLogs)
		}
	}
	users, err := s.repo.Users()
	if err != nil {
		return nil, err
	}
	queued, err := s.repo.CurrentQueuedTaskCount()
	if err != nil {
		return nil, err
	}
	result := buildAnalyticsOverview(filter, tasks, rollingTasks, rollingLogs, logs, activities, users)
	records, err := s.analyticsFinancialRecords(logs)
	if err != nil {
		return nil, err
	}
	applyAnalyticsFinance(result, records)
	result.KPI.CurrentQueuedTasks = queued
	return result, nil
}

func (s *Service) AdminModelPricings(actor *model.User) ([]model.ModelPricing, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.repo.ModelPricings()
}

func (s *Service) SaveModelPricing(actor *model.User, id string, req ModelPricingRequest) (*model.ModelPricing, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	req.Model = strings.TrimSpace(req.Model)
	req.Capability = normalizeCapability(req.Capability)
	req.Currency = strings.ToUpper(strings.TrimSpace(req.Currency))
	if req.Model == "" || req.Capability == "" {
		return nil, BadAuthRequest("请填写模型并选择能力类型")
	}
	if req.Currency == "" {
		req.Currency = "USD"
	}
	if len(req.Currency) > 12 || hasNegativePricing(req) {
		return nil, BadAuthRequest("价格配置格式无效")
	}
	pricing := &model.ModelPricing{ID: newID(), CreatedAt: time.Now()}
	if id != "" {
		current, err := s.repo.ModelPricingByID(id)
		if err != nil {
			return nil, err
		}
		pricing = current
	}
	pricing.ChannelID = strings.TrimSpace(req.ChannelID)
	pricing.Model = req.Model
	pricing.Capability = req.Capability
	pricing.Currency = req.Currency
	pricing.InputPerMillionMicros = req.InputPerMillionMicros
	pricing.OutputPerMillionMicros = req.OutputPerMillionMicros
	pricing.CachedPerMillionMicros = req.CachedPerMillionMicros
	pricing.PerRequestMicros = req.PerRequestMicros
	pricing.PerMediaMicros = req.PerMediaMicros
	pricing.PerVideoSecondMicros = req.PerVideoSecondMicros
	pricing.UpdatedAt = time.Now()
	if err := s.repo.Save(pricing); err != nil {
		return nil, err
	}
	return pricing, nil
}

func (s *Service) DeleteModelPricing(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	return s.repo.DeleteModelPricing(id)
}

func hasNegativePricing(req ModelPricingRequest) bool {
	return req.InputPerMillionMicros < 0 || req.OutputPerMillionMicros < 0 || req.CachedPerMillionMicros < 0 || req.PerRequestMicros < 0 || req.PerMediaMicros < 0 || req.PerVideoSecondMicros < 0
}

func (s *Service) recordActivity(userID string, event string, count int) {
	if err := s.repo.RecordUserActivity(userID, event, count, time.Now()); err != nil {
		log.Printf("record user activity failed: event=%s count=%d error=%v", event, count, err)
	}
}
