package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const providerTaskRecoveryLeaseDuration = 10 * time.Minute

type ProviderTaskQueryResult struct {
	Task           *model.Task `json:"task"`
	ProviderStatus string      `json:"providerStatus"`
	Recovered      bool        `json:"recovered"`
	BillingSettled bool        `json:"billingSettled"`
	Error          string      `json:"error,omitempty"`
}

type ProviderTaskRecoveryItem struct {
	LogID          string `json:"logId"`
	Recovered      bool   `json:"recovered"`
	ProviderStatus string `json:"providerStatus,omitempty"`
	Error          string `json:"error,omitempty"`
}

type ProviderTaskRecoveryBatchResult struct {
	Items   []ProviderTaskRecoveryItem `json:"items"`
	Success int                        `json:"success"`
	Failed  int                        `json:"failed"`
	Skipped int                        `json:"skipped"`
}

func (s *Service) QueryFailedVideoTask(ctx context.Context, userID string, taskID string) (*ProviderTaskQueryResult, error) {
	task, err := s.repo.TaskForUser(strings.TrimSpace(userID), strings.TrimSpace(taskID))
	if err != nil {
		return nil, err
	}
	return s.queryFailedVideoTask(ctx, task, strings.TrimSpace(userID))
}

func (s *Service) AdminQueryFailedVideoTask(ctx context.Context, actor *model.User, logID string, requestedProviderID string) (result *ProviderTaskQueryResult, returnErr error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	log, err := s.repo.APICallLog(strings.TrimSpace(logID))
	if err != nil {
		return nil, err
	}
	var task *model.Task
	defer func() {
		metadata := map[string]any{
			"apiCallLogId":              log.ID,
			"taskId":                    log.TaskID,
			"suppliedProviderRequestId": strings.TrimSpace(requestedProviderID),
			"providerRequestId":         "",
			"providerStatus":            "",
			"recovered":                 result != nil && result.Recovered,
			"outcome":                   "failed",
			"error":                     errorString(returnErr),
		}
		if task != nil {
			metadata["providerRequestId"] = task.ProviderRequestID
		}
		if result != nil {
			metadata["providerStatus"] = result.ProviderStatus
			if result.Recovered {
				metadata["outcome"] = "recovered"
			} else {
				metadata["outcome"] = "provider_processing"
			}
		}
		_ = s.appendAdminAudit(actor, "api_log.query_provider_task", "api_call_log", log.ID, "人工查询失败视频任务", metadata)
	}()
	if log.Capability != "video" || strings.TrimSpace(log.TaskID) == "" {
		return nil, BadAuthRequest("该请求没有可查询的视频任务")
	}
	task, returnErr = s.repo.Task(log.TaskID)
	if returnErr != nil {
		return nil, returnErr
	}
	if task.UserID != log.UserID {
		return nil, BadAuthRequest("请求与任务归属不一致")
	}
	if task.Status == model.TaskStatusSucceeded && !taskNeedsProviderMediaRepair(task) {
		result = &ProviderTaskQueryResult{Task: taskForOutput(*task), ProviderStatus: "succeeded", Recovered: true, BillingSettled: s.billingSettled(task)}
		return result, nil
	}
	if strings.TrimSpace(requestedProviderID) != "" {
		task.ProviderRequestID = strings.TrimSpace(requestedProviderID)
	}
	if task.ProviderRequestID == "" {
		task.ProviderRequestID = strings.TrimSpace(log.ProviderRequestID)
	}
	result, returnErr = s.queryFailedVideoTask(ctx, task, "")
	return result, returnErr
}

func (s *Service) AdminRecoverVideoByURL(ctx context.Context, actor *model.User, logID string, rawURL string, providerRequestID string) (result *ProviderTaskQueryResult, returnErr error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	log, task, err := s.adminRecoveryTask(logID)
	if err != nil {
		return nil, err
	}
	parsedURL := ""
	defer func() {
		metadata := map[string]any{
			"apiCallLogId":              log.ID,
			"taskId":                    task.ID,
			"suppliedProviderRequestId": strings.TrimSpace(providerRequestID),
			"providerRequestId":         task.ProviderRequestID,
			"url":                       parsedURL,
			"recovered":                 result != nil && result.Recovered,
			"outcome":                   "failed",
			"error":                     errorString(returnErr),
		}
		if result != nil {
			metadata["providerStatus"] = result.ProviderStatus
			if result.Recovered {
				metadata["outcome"] = "recovered"
			}
		}
		_ = s.appendAdminAudit(actor, "api_log.recover_video_url", "api_call_log", log.ID, "人工转存上游视频并回写", metadata)
	}()
	if task.Status == model.TaskStatusSucceeded {
		result = &ProviderTaskQueryResult{Task: taskForOutput(*task), ProviderStatus: "succeeded", Recovered: true, BillingSettled: s.billingSettled(task)}
		return result, nil
	}
	if task.Status != model.TaskStatusFailed {
		return nil, BadAuthRequest("只能恢复失败的视频任务")
	}
	if strings.TrimSpace(providerRequestID) != "" {
		task.ProviderRequestID = strings.TrimSpace(providerRequestID)
	}
	if task.ProviderRequestID == "" {
		task.ProviderRequestID = strings.TrimSpace(log.ProviderRequestID)
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return nil, BadAuthRequest("视频 URL 只支持有效的 http/https 地址")
	}
	parsedURL = recoveryURLForAudit(parsed)
	owner := "manual-recovery:" + newID()
	if err := s.repo.ClaimFailedTaskProviderRecovery(task.ID, "", owner, providerTaskRecoveryLeaseDuration); err != nil {
		if errors.Is(err, repository.ErrTaskProviderRecoveryConflict) {
			return nil, &AuthError{Status: 409, Message: "该任务正在恢复中，请稍后再试"}
		}
		return nil, err
	}
	task.LeaseOwner = owner
	defer func() { _ = s.repo.ReleaseTaskProviderRecovery(task.ID, owner) }()
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	payload, err := downloadRemoteResource(parsed.String(), megabytes(policy.Resource.GeneratedFileMB)+1)
	if err != nil {
		return nil, err
	}
	if !strings.HasPrefix(strings.ToLower(payload.mimeType), "video/") {
		return nil, BadAuthRequest("上游地址返回的不是视频文件")
	}
	resultPayload := map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(payload.mimeType, payload.data), "mimeType": payload.mimeType}}
	resultPayload, err = s.persistGeneratedMediaResult(task.UserID, resultPayload)
	if err != nil {
		return nil, err
	}
	resultJSON, err := json.Marshal(resultPayload)
	if err != nil {
		return nil, err
	}
	task.Error = ""
	task.PollStage = "succeeded"
	task.NextPollAt = nil
	if err := s.saveTaskCompletionWithinStorageQuota(task, resultJSON, nil, false); err != nil {
		return nil, err
	}
	if err := s.settleRecoveredBilling(task, task.ProviderRequestID); err != nil {
		uncertainErr := s.taskBilling().MarkBillingUncertain(task.BillingOrderID, "人工转存视频已成功，但积分结算失败："+err.Error())
		if uncertainErr != nil {
			return nil, errors.Join(err, uncertainErr)
		}
		return nil, err
	}
	if err := s.RegisterTaskOutputFromTask(*task); err != nil {
		return nil, err
	}
	result = &ProviderTaskQueryResult{Task: taskForOutput(*task), ProviderStatus: "succeeded", Recovered: true, BillingSettled: true}
	return result, nil
}

func (s *Service) AdminBatchQueryFailedVideoTasks(ctx context.Context, actor *model.User, logIDs []string) (*ProviderTaskRecoveryBatchResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	ids := uniqueNonEmpty(logIDs)
	result := &ProviderTaskRecoveryBatchResult{Items: make([]ProviderTaskRecoveryItem, len(ids))}
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for index, id := range ids {
		index, id := index, id
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			item := ProviderTaskRecoveryItem{LogID: id}
			log, logErr := s.repo.APICallLog(id)
			if logErr != nil {
				item.Error = logErr.Error()
				_ = s.appendAdminAudit(actor, "api_log.query_provider_task", "api_call_log", id, "批量查询视频任务失败", map[string]any{"apiCallLogId": id, "outcome": "failed", "error": item.Error})
				result.Items[index] = item
				return
			}
			if log.Capability != "video" {
				item.Error = "跳过：不是视频请求明细"
				_ = s.appendAdminAudit(actor, "api_log.query_provider_task", "api_call_log", id, "批量查询跳过非视频请求", map[string]any{"apiCallLogId": id, "outcome": "skipped", "error": item.Error})
				result.Items[index] = item
				return
			}
			queryResult, queryErr := s.AdminQueryFailedVideoTask(ctx, actor, id, "")
			if queryErr != nil {
				item.Error = queryErr.Error()
			} else {
				item.Recovered, item.ProviderStatus = queryResult.Recovered, queryResult.ProviderStatus
			}
			result.Items[index] = item
		}()
	}
	wg.Wait()
	for _, item := range result.Items {
		if strings.HasPrefix(item.Error, "跳过：") {
			result.Skipped++
		} else if item.Error != "" || !item.Recovered {
			result.Failed++
		} else {
			result.Success++
		}
	}
	return result, nil
}

func (s *Service) adminRecoveryTask(logID string) (*model.ApiCallLog, *model.Task, error) {
	log, err := s.repo.APICallLog(strings.TrimSpace(logID))
	if err != nil {
		return nil, nil, err
	}
	if log.Capability != "video" || strings.TrimSpace(log.TaskID) == "" {
		return nil, nil, BadAuthRequest("该请求没有可恢复的视频任务")
	}
	task, err := s.repo.Task(log.TaskID)
	if err != nil {
		return nil, nil, err
	}
	if task.UserID != log.UserID {
		return nil, nil, BadAuthRequest("请求与任务归属不一致")
	}
	return log, task, nil
}

func (s *Service) billingSettled(task *model.Task) bool {
	if task == nil || task.BillingOrderID == "" {
		return true
	}
	order, err := s.repo.BillingOrder(task.BillingOrderID)
	return err == nil && order.Status == model.BillingStatusSettled
}

func (s *Service) settleRecoveredBilling(task *model.Task, providerRequestID string) error {
	if task == nil || task.BillingOrderID == "" {
		return nil
	}
	billing := s.taskBilling()
	order, err := billing.BillingOrder(task.BillingOrderID)
	if err != nil {
		return err
	}
	if order == nil {
		return fmt.Errorf("任务计费订单不存在：%s", task.BillingOrderID)
	}
	if order.Status == model.BillingStatusSettled {
		return nil
	}
	if order.Status == model.BillingStatusRefunded {
		return billing.RestoreRefundedBilling(task.BillingOrderID, providerRequestID)
	}
	return billing.SettleBilling(task.BillingOrderID, providerRequestID)
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func recoveryURLForAudit(value *url.URL) string {
	if value == nil {
		return ""
	}
	return value.Scheme + "://" + value.Host + value.Path
}

func (s *Service) queryFailedVideoTask(ctx context.Context, task *model.Task, claimUserID string) (*ProviderTaskQueryResult, error) {
	billing := s.taskBilling()
	ctx = withProtocolRegistry(ctx, s.protocolRegistry())
	if task == nil || task.ID == "" {
		return nil, BadAuthRequest("任务不存在")
	}
	allowSucceededRepair := task.Status == model.TaskStatusSucceeded && taskNeedsProviderMediaRepair(task)
	if task.Status != model.TaskStatusFailed && !allowSucceededRepair {
		return nil, BadAuthRequest("只能人工查询失败或结果未保存的视频任务")
	}
	if task.MediaRecoveryJSON != "" {
		return nil, BadAuthRequest("该任务已生成作品，请在任务中心重试保存，无需重新查询生成")
	}
	if !strings.HasPrefix(task.Type, "canvas_video") && !strings.HasPrefix(task.Type, "video_") {
		return nil, BadAuthRequest("该任务不是视频生成任务")
	}

	s.hydrateTaskProviderRequestID(task)
	providerRequestID := strings.TrimSpace(task.ProviderRequestID)
	if providerRequestID == "" {
		return nil, BadAuthRequest("该任务没有可恢复的上游任务 ID")
	}
	if task.BillingOrderID != "" {
		order, err := s.repo.BillingOrder(task.BillingOrderID)
		if err != nil {
			return nil, err
		}
		if order.UserID != task.UserID || order.TaskID != task.ID {
			return nil, BadAuthRequest("任务与计费订单归属不一致")
		}
	}

	decryptedInput, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, fmt.Errorf("读取任务配置失败：%w", err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(decryptedInput), &input); err != nil {
		return nil, fmt.Errorf("任务输入解析失败：%w", err)
	}
	config, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return nil, err
	}
	ctx = ensureOfficialProtocolAdapter(ctx, config.InterfaceType)
	adapter, declarative := declarativeProtocolAdapterForContext(ctx, config.InterfaceType)
	if !declarative {
		return nil, BadAuthRequest("该任务的请求协议不支持安全查询上游状态")
	}
	input.Config = config
	task.InputJSON = decryptedInput
	task.ProviderRequestID = providerRequestID

	owner := "manual-recovery:" + newID()
	if err := s.repo.ClaimTaskProviderRecovery(task.ID, claimUserID, owner, providerTaskRecoveryLeaseDuration, allowSucceededRepair); err != nil {
		if errors.Is(err, repository.ErrTaskProviderRecoveryConflict) {
			return nil, &AuthError{Status: 409, Message: "该任务正在查询上游状态，请稍后再试"}
		}
		return nil, err
	}
	task.LeaseOwner = owner
	defer func() {
		if releaseErr := s.repo.ReleaseTaskProviderRecovery(task.ID, owner); releaseErr != nil {
			_ = s.log(task.UserID, task.ID, "error", "人工查询租约释放失败", releaseErr.Error())
		}
	}()

	// 上游已成功后的完整媒体下载和本地入库可能持续数十秒。浏览器关闭抽屉、
	// 页面刷新或代理断开都不应中断这项运维恢复，否则任务会再次停在
	// failed/refunded。保留请求值用于审计，但把执行生命周期交给恢复租约控制。
	recoveryCtx, cancelRecovery := providerTaskRecoveryContext(ctx)
	defer cancelRecovery()
	queryCtx := withProviderAnalytics(recoveryCtx, s, *task)
	var result map[string]interface{}
	var providerStatus string
	result, providerStatus, err = queryProtocolAdapterVideoTask(queryCtx, input, adapter, providerRequestID)
	if err != nil {
		_ = s.log(task.UserID, task.ID, "error", "人工查询上游视频任务失败", err.Error())
		return nil, err
	}
	if result == nil {
		_ = s.log(task.UserID, task.ID, "info", "人工查询完成，上游任务仍在处理", providerStatus)
		return &ProviderTaskQueryResult{Task: taskForOutput(*task), ProviderStatus: providerStatus, Recovered: false}, nil
	}

	result, err = s.persistGeneratedMediaResult(task.UserID, result)
	if err != nil {
		_ = s.log(task.UserID, task.ID, "error", "人工查询已取得视频，但结果保存失败", err.Error())
		return nil, err
	}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	task.Error = ""
	task.PollStage = strings.ToLower(providerStatus)
	task.NextPollAt = nil
	task.MediaStage = "completed"
	if err := s.saveTaskCompletionWithinStorageQuota(task, resultJSON, nil, false); err != nil {
		uncertainErr := billing.MarkBillingUncertain(task.BillingOrderID, "人工查询确认上游成功，但任务结果未保存："+err.Error())
		_ = s.log(task.UserID, task.ID, "error", "人工查询已取得视频，但任务恢复失败", err.Error())
		if uncertainErr != nil {
			return nil, errors.Join(err, fmt.Errorf("记录任务结果未保存的计费待核对状态失败：%w", uncertainErr))
		}
		return nil, err
	}
	billingSettled := true
	var billingErr error
	billingErr = s.settleRecoveredBilling(task, providerRequestID)
	if billingErr != nil {
		billingSettled = false
		uncertainErr := billing.MarkBillingUncertain(task.BillingOrderID, "人工查询确认生成成功，但积分结算失败："+billingErr.Error())
		_ = s.log(task.UserID, task.ID, "error", "任务恢复成功但积分结算失败，已进入待核对", billingErr.Error())
		if uncertainErr != nil {
			return nil, errors.Join(billingErr, fmt.Errorf("记录任务恢复后的计费待核对状态失败：%w", uncertainErr))
		}
		return nil, billingErr
	}
	if err := s.RegisterTaskOutputFromTask(*task); err != nil {
		_ = s.log(task.UserID, task.ID, "error", "任务恢复成功但项目产物登记失败", err.Error())
		return nil, fmt.Errorf("任务已恢复并完成扣费，但项目素材登记失败：%w", err)
	}
	message := "人工查询确认生成成功，任务已恢复、完成结算并登记项目产物"
	if allowSucceededRepair {
		message = "人工补拉确认生成成功，视频已重新入库并登记项目产物"
	}
	_ = s.log(task.UserID, task.ID, "info", message, providerStatus)
	return &ProviderTaskQueryResult{Task: taskForOutput(*task), ProviderStatus: providerStatus, Recovered: true, BillingSettled: billingSettled}, nil
}

func taskNeedsProviderMediaRepair(task *model.Task) bool {
	if task == nil || task.Status != model.TaskStatusSucceeded || (!strings.HasPrefix(task.Type, "canvas_video") && !strings.HasPrefix(task.Type, "video_")) {
		return false
	}
	previewURL, _ := taskMediaPreview(task.ResultJSON, task.Type)
	return canvasResourceID(previewURL) == ""
}

func providerTaskRecoveryContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(parent), providerTaskRecoveryLeaseDuration)
}
