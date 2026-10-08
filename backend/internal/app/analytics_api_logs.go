// 管理后台的 API 调用日志：分页、详情、CSV 导出、媒体预览与上游响应摘要补全。
//
// 日志只保存脱敏后的请求摘要；上游响应体中的媒体通过资源访问合同读取，不暴露原始地址。

package app

import (
	"bytes"
	"encoding/csv"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func (s *Service) AdminAPICallLogs(actor *model.User, query APICallLogQuery) (*APICallLogPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if query.RecordType != "" && query.RecordType != "request" && query.RecordType != "download" && query.RecordType != "all" {
		return nil, BadAuthRequest("请求明细类型无效")
	}
	filter := normalizeAnalyticsFilter(query.AnalyticsQuery)
	logs, total, err := s.repo.QueryAPICallLogs(repository.APICallLogFilter{AnalyticsFilter: filter, RecordType: query.RecordType, Keyword: query.Keyword, Status: query.Status, Page: query.Page, Limit: query.Limit})
	if err != nil {
		return nil, err
	}
	if err := s.decorateAPICallLogs(logs); err != nil {
		return nil, err
	}
	for index := range logs {
		// 原始报文只允许通过详情接口按单条读取。
		logs[index].RequestBody = ""
		logs[index].ResponseBody = ""
	}
	page, limit := query.Page, query.Limit
	if page <= 0 {
		page = 1
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	return &APICallLogPage{Logs: logs, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) decorateAPICallLogs(logs []model.ApiCallLog) error {
	// 历史日志允许读取逻辑删除渠道的名称，但不读取或返回渠道密钥。
	channels, err := s.repo.HistoricalSystemChannelReferences()
	if err != nil {
		return err
	}
	channelNames := make(map[string]string, len(channels))
	for _, channel := range channels {
		channelNames[channel.ID] = channel.Name
	}
	users, err := s.repo.Users()
	if err != nil {
		return err
	}
	userByID := make(map[string]model.User, len(users))
	for _, user := range users {
		userByID[user.ID] = user
	}
	billingOrderIDs := make([]string, 0, len(logs))
	seenBillingOrderIDs := make(map[string]struct{}, len(logs))
	taskIDs := make([]string, 0, len(logs))
	seenTaskIDs := make(map[string]struct{}, len(logs))
	for _, log := range logs {
		if log.Billable && log.BillingOrderID != "" {
			if _, exists := seenBillingOrderIDs[log.BillingOrderID]; !exists {
				seenBillingOrderIDs[log.BillingOrderID] = struct{}{}
				billingOrderIDs = append(billingOrderIDs, log.BillingOrderID)
			}
		}
		if (log.Capability != "image" && log.Capability != "video" && log.Capability != "audio") || log.TaskID == "" {
			continue
		}
		if _, exists := seenTaskIDs[log.TaskID]; exists {
			continue
		}
		seenTaskIDs[log.TaskID] = struct{}{}
		taskIDs = append(taskIDs, log.TaskID)
	}
	tasks, err := s.repo.APICallLogTasks(taskIDs)
	if err != nil {
		return err
	}
	taskByID := make(map[string]model.Task, len(tasks))
	for _, task := range tasks {
		taskByID[task.ID] = task
	}
	billingOrderByID, err := s.repo.BillingOrdersByIDs(billingOrderIDs)
	if err != nil {
		return err
	}
	for index := range logs {
		if logs[index].StartedAt.IsZero() {
			logs[index].StartedAt = logs[index].CreatedAt
		}
		if logs[index].ChannelID == "" {
			logs[index].ChannelName = "自定义渠道"
		} else if name := channelNames[logs[index].ChannelID]; name != "" {
			logs[index].ChannelName = name
		} else {
			logs[index].ChannelName = "已删除渠道"
		}
		if user, exists := userByID[logs[index].UserID]; exists {
			logs[index].UserDisplayName = user.DisplayName
			logs[index].UserAccount = user.Username
		}
		if logs[index].Billable {
			if order, exists := billingOrderByID[logs[index].BillingOrderID]; exists && order.UserID == logs[index].UserID {
				logs[index].BillingAvailable = true
				logs[index].BillingStatus = order.Status
				if order.ChannelID == logs[index].ChannelID {
					logs[index].CreditCostConfigured = order.CostPricing.Configured
					cost, costErr := billingCreditCost(order)
					if costErr != nil {
						return costErr
					}
					logs[index].CreditCostMicrocredits = cost
				}
				if order.Status == model.BillingStatusSettled {
					logs[index].BillingAmount = order.ActualAmountMicrocredits
				} else if order.Status != model.BillingStatusRefunded {
					logs[index].BillingAmount = order.ReservedAmountMicrocredits
				}
			}
		}
		if task, exists := taskByID[logs[index].TaskID]; exists && task.UserID == logs[index].UserID {
			logs[index].TaskStatus = task.Status
			logs[index].MediaStage = task.MediaStage
			previewURL, previewKind := taskMediaPreview(task.ResultJSON, task.Type)
			if canvasResourceID(previewURL) != "" {
				logs[index].MediaPreviewURL = "/api/admin/api-logs/" + logs[index].ID + "/media"
				logs[index].MediaPreviewKind = previewKind
			} else if strings.HasPrefix(previewURL, "https://") || strings.HasPrefix(previewURL, "http://") {
				logs[index].MediaPreviewURL = previewURL
				logs[index].MediaPreviewKind = previewKind
			}
		}
	}
	return nil
}

// 管理员媒体读取必须同时校验日志、任务和资源归属，不能绕过用户资源边界按资源 ID 任意读取。
func (s *Service) OpenAdminAPICallLogMediaRange(actor *model.User, logID string, rangeHeader string) (*ResourceStream, error) {
	userID, resource, err := s.adminAPICallLogMediaResource(actor, logID)
	if err != nil {
		return nil, err
	}
	return s.openResourceRange(userID, resource, rangeHeader)
}

func (s *Service) PrepareAdminAPICallLogMediaDelivery(actor *model.User, logID string, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	userID, resource, err := s.adminAPICallLogMediaResource(actor, logID)
	if err != nil {
		return nil, err
	}
	if options.Purpose == "" {
		options.Purpose = assets.PurposeDisplay
	}
	return s.prepareResourceDelivery(userID, resource, options, rangeHeader)
}

func (s *Service) adminAPICallLogMediaResource(actor *model.User, logID string) (string, *model.Resource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return "", nil, err
	}
	log, err := s.repo.APICallLog(strings.TrimSpace(logID))
	if err != nil {
		return "", nil, err
	}
	if log.TaskID == "" || (log.Capability != "image" && log.Capability != "video") {
		return "", nil, BadAuthRequest("该请求没有可预览媒体")
	}
	task, err := s.repo.Task(log.TaskID)
	if err != nil {
		return "", nil, err
	}
	if task.UserID != log.UserID {
		return "", nil, BadAuthRequest("请求与媒体归属不一致")
	}
	previewURL, _ := taskMediaPreview(task.ResultJSON, task.Type)
	resourceID := canvasResourceID(previewURL)
	if resourceID == "" {
		return "", nil, BadAuthRequest("该请求没有已持久化媒体")
	}
	resource, err := s.repo.ResourceForUser(log.UserID, resourceID)
	if err != nil {
		return "", nil, err
	}
	return log.UserID, resource, nil
}

func (s *Service) AdminAPICallLog(actor *model.User, id string) (*model.ApiCallLog, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	log, err := s.repo.APICallLog(strings.TrimSpace(id))
	if err != nil {
		return nil, err
	}
	logs := []model.ApiCallLog{*log}
	if err := s.decorateAPICallLogs(logs); err != nil {
		return nil, err
	}
	return &logs[0], nil
}

func (s *Service) AdminAPICallLogsCSV(actor *model.User, query APICallLogQuery) ([]byte, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if query.RecordType != "" && query.RecordType != "request" && query.RecordType != "download" && query.RecordType != "all" {
		return nil, BadAuthRequest("请求明细类型无效")
	}
	filter := normalizeAnalyticsFilter(query.AnalyticsQuery)
	ids := uniqueNonEmpty(query.IDs)
	if len(query.IDs) > 0 && len(ids) == 0 {
		return nil, BadAuthRequest("请选择要导出的请求明细")
	}
	if len(ids) > 200 {
		return nil, BadAuthRequest("单次最多导出 200 条已选请求明细")
	}
	logs, err := s.repo.ExportAPICallLogs(repository.APICallLogFilter{AnalyticsFilter: filter, RecordType: query.RecordType, Keyword: query.Keyword, Status: query.Status, IDs: ids}, 10_000)
	if err != nil {
		return nil, err
	}
	if err := s.decorateAPICallLogs(logs); err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	buffer.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buffer)
	_ = writer.Write([]string{"时间", "用户", "用户账号", "渠道", "模型", "能力", "状态", "轮询次数", "耗时毫秒", "输入Token", "输出Token", "缓存Token", "销售价格(微积分)", "积分计费状态", "成本价格(微积分)", "上游估算费用(微单位)", "币种", "错误码", "错误"})
	for _, log := range logs {
		startedAt := log.StartedAt
		if startedAt.IsZero() {
			startedAt = log.CreatedAt
		}
		billingAmount, billingStatus := "", ""
		if log.BillingAvailable {
			billingAmount = strconv.FormatInt(log.BillingAmount, 10)
			billingStatus = string(log.BillingStatus)
		}
		upstreamCost := ""
		creditCost := ""
		if log.CreditCostMicrocredits != nil {
			creditCost = strconv.FormatInt(*log.CreditCostMicrocredits, 10)
		}
		if log.CostAvailable {
			upstreamCost = strconv.FormatInt(log.EstimatedCostMicros, 10)
		}
		_ = writer.Write([]string{startedAt.UTC().Format(time.RFC3339), log.UserDisplayName, log.UserAccount, log.ChannelName, log.Model, log.Capability, string(log.Status), strconv.Itoa(log.PollCount), strconv.FormatInt(log.DurationMs, 10), strconv.FormatInt(log.InputTokens, 10), strconv.FormatInt(log.OutputTokens, 10), strconv.FormatInt(log.CachedTokens, 10), billingAmount, billingStatus, creditCost, upstreamCost, log.Currency, log.ErrorCode, log.Error})
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func (s *Service) AdminAnalyticsCSV(actor *model.User, query AnalyticsQuery) ([]byte, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	filter := normalizeAnalyticsFilter(query)
	logs, err := s.repo.AnalyticsAPICallLogs(filter)
	if err != nil {
		return nil, err
	}
	records, err := s.analyticsFinancialRecords(logs)
	if err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	buffer.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buffer)
	_ = writer.Write([]string{"时间", "用户ID", "渠道ID", "任务ID", "能力", "请求阶段", "模型", "状态", "状态码", "耗时毫秒", "输入Token", "输出Token", "缓存Token", "媒体数量", "视频秒数", "收入(微积分)", "成本(微积分)", "利润(微积分)", "错误类型"})
	for _, log := range logs {
		revenue, cost, profit := "", "", ""
		if record, exists := records[log.ID]; exists {
			revenue = strconv.FormatInt(record.Revenue, 10)
			if record.Cost != nil {
				cost = strconv.FormatInt(*record.Cost, 10)
				profit = strconv.FormatInt(record.Revenue-*record.Cost, 10)
			}
		}
		inputTokens, outputTokens, cachedTokens := "", "", ""
		if log.UsageAvailable {
			inputTokens = strconv.FormatInt(log.InputTokens, 10)
			outputTokens = strconv.FormatInt(log.OutputTokens, 10)
			cachedTokens = strconv.FormatInt(log.CachedTokens, 10)
		}
		_ = writer.Write([]string{log.CreatedAt.Format(time.RFC3339), log.UserID, log.ChannelID, log.TaskID, log.Capability, log.RequestKind, log.Model, string(log.Status), strconv.Itoa(log.StatusCode), strconv.FormatInt(log.DurationMs, 10), inputTokens, outputTokens, cachedTokens, strconv.Itoa(log.MediaCount), strconv.Itoa(log.VideoSeconds), revenue, cost, profit, classifyAPICallError(log)})
	}
	writer.Flush()
	return buffer.Bytes(), writer.Error()
}
