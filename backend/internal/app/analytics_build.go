// 运营统计的聚合计算：概览 KPI、趋势、模型与用户排行、失败归类。
//
// 全部是对已查询出的任务与调用日志做内存聚合的纯函数，便于单测。

package app

import (
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func normalizeAnalyticsFilter(query AnalyticsQuery) repository.AnalyticsFilter {
	now := time.Now().UTC()
	to := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	from := to.AddDate(0, 0, -30)
	if parsed, ok := parseAnalyticsTime(query.From); ok {
		from = parsed
	}
	if parsed, ok := parseAnalyticsTime(query.To); ok {
		to = parsed
		if len(strings.TrimSpace(query.To)) == len("2006-01-02") {
			to = to.AddDate(0, 0, 1)
		}
	}
	if !to.After(from) {
		to = from.AddDate(0, 0, 1)
	}
	if to.Sub(from) > 366*24*time.Hour {
		from = to.AddDate(-1, 0, 0)
	}
	return repository.AnalyticsFilter{From: from, To: to, UserID: strings.TrimSpace(query.UserID), Model: strings.TrimSpace(query.Model), ChannelID: strings.TrimSpace(query.ChannelID), Capability: normalizeCapability(query.Capability)}
}

func parseAnalyticsTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), true
		}
	}
	return time.Time{}, false
}

func normalizeCapability(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "text", "image", "video", "audio":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func buildAnalyticsOverview(filter repository.AnalyticsFilter, tasks []model.Task, rollingTasks []model.Task, rollingLogs []model.ApiCallLog, logs []model.ApiCallLog, activities []model.UserDailyActivity, users []model.User) *AnalyticsOverview {
	result := &AnalyticsOverview{From: filter.From, To: filter.To, Trend: []AnalyticsTrendPoint{}, Models: []AnalyticsModelRow{}, Users: []AnalyticsUserRow{}, Failures: []AnalyticsFailureRow{}}
	result.KPI.GenerationTasks = len(tasks)
	result.KPI.UpstreamRequests = len(logs)
	result.KPI.SuccessRate = successRateLogs(logs)
	durations := make([]int64, 0, len(logs))
	activeUsers := map[string]bool{}
	if !hasCreationDimensionFilter(filter) {
		for _, activity := range activities {
			if activity.Day.Before(filter.From) || !activity.Day.Before(filter.To) || !meaningfulActivity(activity) {
				continue
			}
			activeUsers[activity.UserID] = true
		}
	}
	for _, task := range tasks {
		activeUsers[task.UserID] = true
	}
	for _, log := range logs {
		activeUsers[log.UserID] = true
	}
	result.KPI.ActiveUsers = len(activeUsers)
	rollingActivities := activities
	if hasCreationDimensionFilter(filter) {
		rollingActivities = nil
	}
	result.KPI.DAU = rollingActiveUsers(rollingActivities, rollingTasks, rollingLogs, filter.To.AddDate(0, 0, -1), filter.To)
	result.KPI.WAU = rollingActiveUsers(rollingActivities, rollingTasks, rollingLogs, filter.To.AddDate(0, 0, -7), filter.To)
	result.KPI.MAU = rollingActiveUsers(rollingActivities, rollingTasks, rollingLogs, filter.To.AddDate(0, 0, -30), filter.To)
	for _, log := range logs {
		durations = append(durations, log.DurationMs)
	}
	result.KPI.P95DurationMs = percentile(durations, 0.95)
	result.Trend = buildAnalyticsTrend(filter, tasks, logs, activities)
	result.Models = buildAnalyticsModels(tasks, logs)
	result.Users = buildAnalyticsUsers(filter, tasks, logs, activities, users)
	result.Failures = buildAnalyticsFailures(logs)
	return result
}

func buildAnalyticsTrend(filter repository.AnalyticsFilter, tasks []model.Task, logs []model.ApiCallLog, activities []model.UserDailyActivity) []AnalyticsTrendPoint {
	points := map[string]*AnalyticsTrendPoint{}
	for day := time.Date(filter.From.Year(), filter.From.Month(), filter.From.Day(), 0, 0, 0, 0, time.UTC); day.Before(filter.To); day = day.AddDate(0, 0, 1) {
		key := day.Format("2006-01-02")
		points[key] = &AnalyticsTrendPoint{Day: key}
	}
	requestTotals := map[string]int{}
	requestSuccess := map[string]int{}
	activeByDay := map[string]map[string]bool{}
	for _, task := range tasks {
		key := task.CreatedAt.UTC().Format("2006-01-02")
		if point := points[key]; point != nil {
			point.Tasks++
			if activeByDay[key] == nil {
				activeByDay[key] = map[string]bool{}
			}
			activeByDay[key][task.UserID] = true
		}
	}
	for _, log := range logs {
		key := log.CreatedAt.UTC().Format("2006-01-02")
		if point := points[key]; point != nil {
			point.Requests++
			requestTotals[key]++
			if log.Status == model.ApiCallStatusSucceeded {
				requestSuccess[key]++
			}
			if activeByDay[key] == nil {
				activeByDay[key] = map[string]bool{}
			}
			activeByDay[key][log.UserID] = true
		}
	}
	if !hasCreationDimensionFilter(filter) {
		for _, activity := range activities {
			key := activity.Day.UTC().Format("2006-01-02")
			if points[key] == nil || !meaningfulActivity(activity) {
				continue
			}
			if activeByDay[key] == nil {
				activeByDay[key] = map[string]bool{}
			}
			activeByDay[key][activity.UserID] = true
		}
	}
	keys := make([]string, 0, len(points))
	for key := range points {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]AnalyticsTrendPoint, 0, len(keys))
	for _, key := range keys {
		point := points[key]
		point.ActiveUsers = len(activeByDay[key])
		point.RequestSuccessRate = ratio(requestSuccess[key], requestTotals[key])
		result = append(result, *point)
	}
	return result
}

func buildAnalyticsModels(tasks []model.Task, logs []model.ApiCallLog) []AnalyticsModelRow {
	type accumulator struct {
		row            AnalyticsModelRow
		users          map[string]bool
		taskSuccess    int
		taskTotal      int
		requestSuccess int
		durations      []int64
	}
	items := map[string]*accumulator{}
	get := func(modelName string, capability string) *accumulator {
		if modelName == "" {
			modelName = "未识别"
		}
		key := modelName + "\x00" + capability
		if items[key] == nil {
			items[key] = &accumulator{row: AnalyticsModelRow{Model: modelName, Capability: capability}, users: map[string]bool{}}
		}
		return items[key]
	}
	for _, task := range tasks {
		capability := capabilityFromTaskType(task.Type)
		item := get(task.Model, capability)
		item.row.Tasks++
		item.users[task.UserID] = true
		if task.Status != model.TaskStatusCancelled {
			item.taskTotal++
			if task.Status == model.TaskStatusSucceeded {
				item.taskSuccess++
			}
		}
	}
	for _, log := range logs {
		item := get(log.Model, log.Capability)
		item.row.Requests++
		item.users[log.UserID] = true
		item.durations = append(item.durations, log.DurationMs)
		if log.Status == model.ApiCallStatusSucceeded {
			item.requestSuccess++
		}
		if log.UsageAvailable {
			item.row.UsageAvailable = true
			item.row.InputTokens += log.InputTokens
			item.row.OutputTokens += log.OutputTokens
			item.row.CachedTokens += log.CachedTokens
		}
		item.row.MediaCount += log.MediaCount
		item.row.VideoSeconds += log.VideoSeconds
	}
	result := make([]AnalyticsModelRow, 0, len(items))
	for _, item := range items {
		item.row.UniqueUsers = len(item.users)
		item.row.TaskSuccessRate = ratio(item.taskSuccess, item.taskTotal)
		item.row.RequestSuccessRate = ratio(item.requestSuccess, item.row.Requests)
		item.row.P50DurationMs = percentile(item.durations, 0.5)
		item.row.P95DurationMs = percentile(item.durations, 0.95)
		result = append(result, item.row)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Tasks == result[j].Tasks {
			return result[i].Requests > result[j].Requests
		}
		return result[i].Tasks > result[j].Tasks
	})
	return result
}

func buildAnalyticsUsers(filter repository.AnalyticsFilter, tasks []model.Task, logs []model.ApiCallLog, activities []model.UserDailyActivity, users []model.User) []AnalyticsUserRow {
	names := map[string]string{}
	for _, user := range users {
		names[user.ID] = firstNonEmpty(user.DisplayName, user.Username)
	}
	rows := map[string]*AnalyticsUserRow{}
	models := map[string]map[string]int{}
	get := func(userID string) *AnalyticsUserRow {
		if rows[userID] == nil {
			rows[userID] = &AnalyticsUserRow{UserID: userID, Name: firstNonEmpty(names[userID], userID)}
		}
		return rows[userID]
	}
	if !hasCreationDimensionFilter(filter) {
		for _, activity := range activities {
			if activity.Day.Before(filter.From) || !activity.Day.Before(filter.To) || !meaningfulActivity(activity) {
				continue
			}
			row := get(activity.UserID)
			row.ActiveDays++
			row.AgentMessages += activity.AgentMessageCount
			if activity.CanvasActive {
				row.CanvasDays++
			}
			row.Assets += activity.AssetCount
			row.Resources += activity.ResourceCount
		}
	}
	for _, task := range tasks {
		if models[task.UserID] == nil {
			models[task.UserID] = map[string]int{}
		}
		models[task.UserID][task.Model]++
		get(task.UserID).Tasks++
	}
	if hasCreationDimensionFilter(filter) {
		activeDays := map[string]map[string]bool{}
		for _, log := range logs {
			get(log.UserID)
			if activeDays[log.UserID] == nil {
				activeDays[log.UserID] = map[string]bool{}
			}
			activeDays[log.UserID][log.CreatedAt.UTC().Format("2006-01-02")] = true
		}
		for userID, days := range activeDays {
			get(userID).ActiveDays = len(days)
		}
	}
	result := make([]AnalyticsUserRow, 0, len(rows))
	for userID, row := range rows {
		bestCount := 0
		for modelName, count := range models[userID] {
			if modelName != "" && count > bestCount {
				row.CommonModel, bestCount = modelName, count
			}
		}
		result = append(result, *row)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Tasks == result[j].Tasks {
			return result[i].ActiveDays > result[j].ActiveDays
		}
		return result[i].Tasks > result[j].Tasks
	})
	return result
}

func buildAnalyticsFailures(logs []model.ApiCallLog) []AnalyticsFailureRow {
	items := map[string]*AnalyticsFailureRow{}
	for _, log := range logs {
		if log.Status != model.ApiCallStatusFailed {
			continue
		}
		typeName := classifyAPICallError(log)
		modelName := firstNonEmpty(log.Model, "未识别")
		key := typeName + "\x00" + modelName
		if items[key] == nil {
			items[key] = &AnalyticsFailureRow{Type: typeName, Model: modelName}
		}
		item := items[key]
		item.Count++
		if log.CreatedAt.After(item.LastSeenAt) {
			item.LastSeenAt = log.CreatedAt
			item.LastError = truncateRunes(log.Error, 180)
		}
	}
	result := make([]AnalyticsFailureRow, 0, len(items))
	for _, item := range items {
		result = append(result, *item)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Count > result[j].Count })
	return result
}

func classifyAPICallError(log model.ApiCallLog) string {
	value := strings.ToLower(log.Error)
	switch {
	case log.ErrorCode == contentModerationErrorCode:
		return "内容审核"
	case strings.Contains(value, "timeout"), strings.Contains(value, "超时"), log.StatusCode == 408, log.StatusCode == 504, log.StatusCode == 524:
		return "超时"
	case log.StatusCode == 401 || log.StatusCode == 403 || strings.Contains(value, "unauthorized"):
		return "鉴权失败"
	case log.StatusCode == 429 || strings.Contains(value, "rate limit"):
		return "限流"
	case log.StatusCode >= 400 && log.StatusCode < 500:
		return "请求参数"
	case log.StatusCode >= 500:
		return "上游服务"
	case value != "":
		return "网络或客户端"
	default:
		return "未知错误"
	}
}

func meaningfulActivity(activity model.UserDailyActivity) bool {
	return activity.TaskCount > 0 || activity.AgentMessageCount > 0 || activity.CanvasActive || activity.AssetCount > 0 || activity.ResourceCount > 0
}

func rollingActiveUsers(activities []model.UserDailyActivity, tasks []model.Task, logs []model.ApiCallLog, from time.Time, to time.Time) int {
	users := map[string]bool{}
	for _, activity := range activities {
		if !activity.Day.Before(from) && activity.Day.Before(to) && meaningfulActivity(activity) {
			users[activity.UserID] = true
		}
	}
	for _, task := range tasks {
		if !task.CreatedAt.Before(from) && task.CreatedAt.Before(to) {
			users[task.UserID] = true
		}
	}
	for _, log := range logs {
		if !log.CreatedAt.Before(from) && log.CreatedAt.Before(to) {
			users[log.UserID] = true
		}
	}
	return len(users)
}

func successRateLogs(logs []model.ApiCallLog) float64 {
	succeeded, failed := 0, 0
	for _, log := range logs {
		if log.Status == model.ApiCallStatusSucceeded {
			succeeded++
		} else if log.Status == model.ApiCallStatusFailed {
			failed++
		}
	}
	return ratio(succeeded, succeeded+failed)
}

func ratio(value int, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(value) * 100 / float64(total)
}

func percentile(values []int64, quantile float64) int64 {
	if len(values) == 0 {
		return 0
	}
	items := append([]int64(nil), values...)
	sort.Slice(items, func(i, j int) bool { return items[i] < items[j] })
	index := int(float64(len(items)-1)*quantile + 0.5)
	return items[index]
}

func capabilityFromTaskType(taskType string) string {
	value := strings.ToLower(taskType)
	for _, capability := range []string{"video", "image", "audio", "text"} {
		if strings.Contains(value, capability) {
			return capability
		}
	}
	if strings.Contains(value, "storyboard") || strings.Contains(value, "agent") {
		return "text"
	}
	return ""
}

func hasCreationDimensionFilter(filter repository.AnalyticsFilter) bool {
	return filter.Model != "" || filter.ChannelID != "" || filter.Capability != ""
}

func tasksWithLoggedRequests(tasks []model.Task, logs []model.ApiCallLog) []model.Task {
	ids := map[string]bool{}
	for _, log := range logs {
		if log.TaskID != "" {
			ids[log.TaskID] = true
		}
	}
	result := make([]model.Task, 0, len(tasks))
	for _, task := range tasks {
		if ids[task.ID] {
			result = append(result, task)
		}
	}
	return result
}
