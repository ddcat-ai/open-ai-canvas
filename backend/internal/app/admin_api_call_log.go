// 上游调用日志写入（LogAPICall）与视频任务多次轮询日志的合并。

package app

import (
	"context"
	"errors"
	stdlog "log"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
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
	if merged, err := s.mergeAsyncMediaAPICallLog(log); err != nil {
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

func (s *Service) mergeAsyncMediaAPICallLog(log model.ApiCallLog) (bool, error) {
	// Delivery is a separate outcome: a failed download must not rewrite a
	// successful generation request as failed.
	if (log.Capability != "video" && log.Capability != "image") || log.RequestKind != "poll" {
		return false, nil
	}
	if log.TaskID == "" && log.ProviderRequestID == "" {
		return false, nil
	}
	root, err := s.repo.AsyncMediaAPICallRoot(log)
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
		root.CacheWriteTokens = log.CacheWriteTokens
	}
	return true, s.repo.Save(root)
}

// recordProviderTaskTerminalFailure 把适配器解析出的失败/取消终态写到本次上游任务的 create 根日志。
// 视频、图片的轮询日志会合并进根日志，音频不合并；两种情况下计费都只看根日志，所以统一改根日志。
// 写回失败只记进程日志：根日志保持 succeeded 时账单会进入待核对，不会误退款。
func recordProviderTaskTerminalFailure(ctx context.Context, failure providerTaskTerminalError) {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Service == nil || metadata.Service.repo == nil {
		return
	}
	probe := model.ApiCallLog{TaskID: metadata.TaskID, UserID: metadata.UserID, ChannelID: metadata.ChannelID, Capability: metadata.Capability, ProviderRequestID: firstNonEmpty(failure.TaskID, metadata.ProviderRequestID)}
	if probe.TaskID == "" && probe.ProviderRequestID == "" {
		return
	}
	if err := metadata.Service.markAPICallRootTerminalFailure(probe, failure); err != nil {
		stdlog.Printf("provider terminal state log update failed: task_id=%s provider_request_id=%s error=%v", probe.TaskID, probe.ProviderRequestID, err)
	}
}

func (s *Service) markAPICallRootTerminalFailure(probe model.ApiCallLog, failure providerTaskTerminalError) error {
	root, err := s.repo.AsyncMediaAPICallRoot(probe)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// 没有根日志时由任务收尾的 ensureFailedProviderAttemptLogged 补一条失败记录。
		return nil
	}
	if err != nil {
		return err
	}
	code := "task_failed"
	if failure.Status == protocol.StatusCancelled {
		code = "task_cancelled"
	}
	changed := root.Status != model.ApiCallStatusFailed
	root.Status = model.ApiCallStatusFailed
	// 日志侧已识别出失败时保留它记下的上游错误码和原文，只补缺失字段。
	if root.ErrorCode == "" {
		root.ErrorCode, changed = code, true
	}
	if root.Error == "" {
		root.Error, changed = truncateRunes(failure.Message, 2_000), true
	}
	if root.ProviderStatus == "" {
		root.ProviderStatus, changed = string(failure.Status), true
	}
	if !changed {
		return nil
	}
	return s.repo.Save(root)
}

func (s *Service) APICallLogs(actor *model.User, limit int) ([]model.ApiCallLog, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	return s.repo.ApiCallLogs(actor.ID, actor.Role == model.UserRoleAdmin, limit)
}
