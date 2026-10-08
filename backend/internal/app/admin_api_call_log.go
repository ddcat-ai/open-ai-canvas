// 上游调用日志写入（LogAPICall）与视频任务多次轮询日志的合并。

package app

import (
	"errors"
	stdlog "log"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func (s *Service) LogAPICall(log model.ApiCallLog) error {
	if log.ID == "" {
		log.ID = newID()
	}
	if log.CreatedAt.IsZero() {
		log.CreatedAt = time.Now()
	}
	if log.StartedAt.IsZero() {
		log.StartedAt = log.CreatedAt.Add(-time.Duration(log.DurationMs) * time.Millisecond)
	}
	s.estimateCallCost(&log)
	if log.BillingOrderID != "" && log.ProviderRequestID != "" {
		if err := s.repo.UpdateBillingProviderRequestID(log.BillingOrderID, log.ProviderRequestID); err != nil {
			// 账单关联是请求日志的辅助状态，不能因为关联更新失败而丢失
			// 已经发生的上游调用记录。后续由任务/账单对账流程补偿关联。
			stdlog.Printf("provider billing request id update failed: billing_order_id=%s provider_request_id=%s error=%v", log.BillingOrderID, log.ProviderRequestID, err)
		}
	}
	if log.TaskID != "" && (log.RequestKind == "create" || log.RequestKind == "poll" || log.RequestKind == "cancel") {
		stage := log.RequestKind
		var nextPollAt *time.Time
		if stage == "create" && log.Status == model.ApiCallStatusSucceeded && log.ProviderRequestID != "" {
			stage = "accepted"
			delay := 2 * time.Second
			if log.Capability == "video" {
				delay = defaultVideoPollInterval
			}
			next := time.Now().Add(delay)
			nextPollAt = &next
		} else if stage == "poll" {
			delay := 5 * time.Second
			if log.Capability == "video" {
				delay = defaultVideoPollInterval
			}
			next := time.Now().Add(delay)
			nextPollAt = &next
		}
		if err := s.repo.UpdateTaskProviderState(log.TaskID, log.ProviderRequestID, stage, nextPollAt); err != nil {
			// 请求日志本身仍需保留；任务状态可由后续任务收尾或恢复流程
			// 重建，不能让一次状态写失败掩盖真实的上游调用。
			stdlog.Printf("provider task state update failed: task_id=%s provider_request_id=%s error=%v", log.TaskID, log.ProviderRequestID, err)
		}
	}
	if merged, err := s.mergeVideoAPICallLog(log); err != nil {
		return err
	} else if merged {
		return nil
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	usage, err := s.repo.UserStorageUsage(log.UserID)
	if err != nil {
		return err
	}
	incomingBytes := int64(len(log.Path) + len(log.Model) + len(log.ProviderRequestID) + len(log.ErrorCode) + len(log.Error) + len(log.UpstreamURL) + len(log.RequestContentType) + len(log.RequestBody) + len(log.ResponseBody))
	if err := validateAPICallLogQuotaWithPolicy(usage, incomingBytes, policy.Resource); err != nil {
		return err
	}
	return s.repo.Create(&log)
}

func (s *Service) mergeVideoAPICallLog(log model.ApiCallLog) (bool, error) {
	// Delivery is a separate outcome: a failed download must not rewrite a
	// successful generation request as failed.
	if log.Capability != "video" || log.RequestKind != "poll" {
		return false, nil
	}
	if log.TaskID == "" && log.ProviderRequestID == "" {
		return false, nil
	}
	root, err := s.repo.VideoAPICallRoot(log)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if log.RequestKind == "poll" {
		root.PollCount++
		if log.ResponseBody != "" {
			root.ResponseBody = log.ResponseBody
		}
	}
	if log.ProviderRequestID != "" {
		root.ProviderRequestID = log.ProviderRequestID
	}
	if log.ProviderStatus != "" {
		root.ProviderStatus = log.ProviderStatus
	}
	startedAt := root.StartedAt
	if startedAt.IsZero() {
		startedAt = root.CreatedAt.Add(-time.Duration(root.DurationMs) * time.Millisecond)
		root.StartedAt = startedAt
	}
	root.DurationMs = max(root.DurationMs, log.CreatedAt.Sub(startedAt).Milliseconds())
	root.StatusCode = log.StatusCode
	root.ConcurrencyLimit = log.ConcurrencyLimit
	if log.Status == model.ApiCallStatusFailed {
		root.Status = log.Status
		root.ErrorCode = log.ErrorCode
		root.Error = log.Error
	} else {
		root.Status = model.ApiCallStatusSucceeded
		root.ErrorCode = ""
		root.Error = ""
	}
	if log.UsageAvailable {
		root.UsageAvailable = true
		root.InputTokens = log.InputTokens
		root.OutputTokens = log.OutputTokens
		root.CachedTokens = log.CachedTokens
	}
	return true, s.repo.Save(root)
}

func (s *Service) APICallLogs(actor *model.User, limit int) ([]model.ApiCallLog, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	return s.repo.ApiCallLogs(actor.ID, actor.Role == model.UserRoleAdmin, limit)
}
