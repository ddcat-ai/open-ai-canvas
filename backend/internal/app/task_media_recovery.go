package app

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/repository"
)

// Recovery is keyed by the task, not a second generation or billing order.
type mediaCheckpoint struct {
	Mode           string                `json:"mode"`
	Items          []mediaCheckpointItem `json:"items"`
	StartedAt      time.Time             `json:"startedAt"`
	Attempts       int                   `json:"attempts"`
	ManualAttempts int                   `json:"manualAttempts"`
	LastManualAt   time.Time             `json:"lastManualAt"`
	// RefundedBilling 是管理员恢复已退款订单时的计费决定：charge 补扣，waive 免除。
	// 为空时，已退款订单交付成功后也不会自动补扣。
	RefundedBilling string `json:"refundedBilling,omitempty"`
}

const (
	refundedBillingCharge = "charge"
	refundedBillingWaive  = "waive"
)

type mediaCheckpointItem struct {
	Reference  protocol.MediaReference `json:"reference"`
	TempName   string                  `json:"tempName,omitempty"`
	MIMEType   string                  `json:"mimeType,omitempty"`
	ResourceID string                  `json:"resourceId,omitempty"`
}

type mediaRecoveryError struct {
	stage     string
	retryable bool
	cause     error
}
type mediaExecutionTaskKey struct{}

func (e *mediaRecoveryError) Error() string {
	return "作品已生成，但保存未完成：" + mediaStageLabel(e.stage)
}
func (e *mediaRecoveryError) Unwrap() error { return e.cause }

var mediaRecoverySlots = make(chan struct{}, 2)
var mediaRecoveryDelays = []time.Duration{15 * time.Second, time.Minute, 3 * time.Minute, 10 * time.Minute}

func mediaStageLabel(stage string) string {
	switch stage {
	case "download":
		return "下载结果失败"
	case "upload":
		return "上传 OSS 失败"
	case "local_save":
		return "保存本地文件失败"
	case "register":
		return "登记作品失败"
	case "local_fallback":
		return "本地兜底保存失败"
	case "offload":
		return "同步对象存储失败"
	default:
		return "记录恢复信息失败"
	}
}

func (s *Service) decodeMediaCheckpoint(task *model.Task) (*mediaCheckpoint, error) {
	plain, err := s.decryptSettingSecret(task.MediaRecoveryJSON)
	if err != nil {
		return nil, err
	}
	var checkpoint mediaCheckpoint
	if err := json.Unmarshal([]byte(plain), &checkpoint); err != nil {
		return nil, err
	}
	if len(checkpoint.Items) == 0 || len(checkpoint.Items) > 32 || (checkpoint.Mode != "image" && checkpoint.Mode != "video" && checkpoint.Mode != "audio") {
		return nil, errors.New("作品恢复信息无效")
	}
	return &checkpoint, nil
}

func (s *Service) saveMediaCheckpoint(task *model.Task, checkpoint *mediaCheckpoint, stage string) error {
	data, err := json.Marshal(checkpoint)
	if err != nil {
		return err
	}
	encoded, err := s.encryptSettingSecret(string(data))
	if err != nil {
		return err
	}
	return s.repo.SaveTaskMediaCheckpoint(task, encoded, stage)
}

func recoverProtocolMedia(ctx context.Context, config providerConfig, mode string, references []protocol.MediaReference) (map[string]interface{}, bool, error) {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Service == nil || metadata.TaskID == "" {
		return nil, false, nil
	}
	s := metadata.Service
	executing, ok := ctx.Value(mediaExecutionTaskKey{}).(model.Task)
	if !ok {
		return nil, false, nil
	}
	task := &executing
	var err error
	// Manual video queries retain their existing recovery lease and completion path.
	if task.Status != model.TaskStatusRunning {
		return nil, false, nil
	}
	if len(references) == 0 || len(references) > 32 {
		return nil, true, &mediaRecoveryError{stage: "checkpoint", cause: errors.New("生成结果数量超过恢复限制")}
	}
	if task.MediaRecoveryJSON != "" {
		result, err := s.resumeTaskMedia(ctx, task)
		return result, true, err
	}
	checkpoint := &mediaCheckpoint{Mode: mode, StartedAt: time.Now()}
	for _, reference := range references {
		if len(reference.URL) > 16_384 {
			return nil, true, &mediaRecoveryError{stage: "checkpoint", cause: errors.New("上游媒体地址过长")}
		}
		item := mediaCheckpointItem{Reference: protocol.MediaReference{URL: reference.URL, MIMEType: reference.MIMEType}}
		// Inline bytes are staged, never stored as a large base64 DB checkpoint.
		if reference.DataURL != "" {
			mimeType, data, decodeErr := decodeProviderDataURL(reference.DataURL)
			if decodeErr != nil {
				return nil, true, &mediaRecoveryError{stage: "checkpoint", cause: decodeErr}
			}
			policy, policyErr := s.RuntimePolicy()
			if policyErr != nil {
				return nil, true, &mediaRecoveryError{stage: "checkpoint", cause: policyErr}
			}
			if int64(len(data)) > min(megabytes(policy.Resource.GeneratedFileMB), mediaStagingBudget) || !strings.HasPrefix(mimeType, mode+"/") {
				return nil, true, &mediaRecoveryError{stage: "checkpoint", cause: errors.New("生成文件类型或大小不符合限制")}
			}
			item.TempName, err = s.stageInlineMedia(data)
			if err != nil {
				return nil, true, &mediaRecoveryError{stage: "checkpoint", cause: err}
			}
			item.MIMEType = mimeType
			item.Reference.DataURL = ""
		}
		checkpoint.Items = append(checkpoint.Items, item)
	}
	if err := s.saveMediaCheckpoint(task, checkpoint, "download"); err != nil {
		return nil, true, &mediaRecoveryError{stage: "checkpoint", cause: err}
	}
	result, err := s.materializeTaskMedia(ctx, task, config, checkpoint)
	return result, true, err
}

func (s *Service) resumeTaskMedia(ctx context.Context, task *model.Task) (map[string]interface{}, error) {
	checkpoint, err := s.decodeMediaCheckpoint(task)
	if err != nil {
		return nil, &mediaRecoveryError{stage: "checkpoint", cause: err}
	}
	raw, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, &mediaRecoveryError{stage: "checkpoint", cause: err}
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return nil, &mediaRecoveryError{stage: "checkpoint", cause: err}
	}
	return s.materializeTaskMedia(withProviderAnalytics(ctx, s, *task), task, input.Config, checkpoint)
}

func (s *Service) materializeTaskMedia(ctx context.Context, task *model.Task, config providerConfig, checkpoint *mediaCheckpoint) (result map[string]interface{}, err error) {
	defer func() {
		var failure *mediaRecoveryError
		if err != nil && !errors.As(err, &failure) {
			err = &mediaRecoveryError{stage: task.MediaStage, cause: err}
		}
	}()
	// Do not occupy a worker waiting for a download slot.
	select {
	case mediaRecoverySlots <- struct{}{}:
		defer func() { <-mediaRecoverySlots }()
	default:
		return nil, &mediaRecoveryError{stage: task.MediaStage, retryable: true, cause: errMediaRecoveryBusy}
	}
	if _, err := s.mediaTaskProject(task); err != nil {
		return nil, &mediaRecoveryError{stage: "register", cause: err}
	}
	items := make([]interface{}, 0, len(checkpoint.Items))
	for index := range checkpoint.Items {
		item := &checkpoint.Items[index]
		if err := ctx.Err(); err != nil {
			return nil, &mediaRecoveryError{stage: task.MediaStage, retryable: true, cause: err}
		}
		resource, err := s.resourceForUploadKey(task.UserID, mediaUploadKey(task.ID, index))
		if err != nil {
			return nil, &mediaRecoveryError{stage: "register", retryable: true, cause: err}
		}
		if resource == nil || resource.Status != model.ResourceStatusReady {
			path := s.mediaTempPath(item.TempName)
			info, statErr := os.Lstat(path)
			if path == "" || statErr != nil || !info.Mode().IsRegular() {
				if item.Reference.URL == "" {
					return nil, &mediaRecoveryError{stage: "download", cause: errors.New("暂存结果已过期且上游没有可重新下载的地址")}
				}
				if err := s.saveMediaCheckpoint(task, checkpoint, "download"); err != nil {
					return nil, err
				}
				config, err = s.resolveProviderConfig(config)
				if err != nil {
					return nil, &mediaRecoveryError{stage: "download", cause: err}
				}
				item.TempName, item.MIMEType, err = s.downloadTaskMedia(ctx, config, item.Reference.URL, checkpoint.Mode)
				if err != nil {
					return nil, &mediaRecoveryError{stage: "download", retryable: retryableMediaRecovery(err), cause: err}
				}
				path = s.mediaTempPath(item.TempName)
				if err := s.saveMediaCheckpoint(task, checkpoint, "download"); err != nil {
					return nil, err
				}
			}
			stage := "local_save"
			_, _, oss, settingErr := s.activeResourceOSSSetting(task.UserID)
			if settingErr != nil {
				return nil, &mediaRecoveryError{stage: "upload", cause: settingErr}
			}
			if oss || (resource != nil && resource.Provider != "local") {
				stage = "upload"
			}
			if err := s.saveMediaCheckpoint(task, checkpoint, stage); err != nil {
				return nil, err
			}
			started := time.Now()
			var fallbackCause error
			resource, fallbackCause, err = s.storeTaskMediaFile(task, index, path, item.MIMEType, checkpoint.Mode, resource)
			if fallbackCause != nil {
				// 直传失败已由本地兜底接住：分别记录失败的上传和成功的兜底保存。
				s.logMediaStage(*task, stage, started, fallbackCause)
				s.logMediaStage(*task, "local_fallback", started, nil)
			} else {
				s.logMediaStage(*task, stage, started, err)
			}
			if err != nil {
				return nil, &mediaRecoveryError{stage: stage, retryable: retryableMediaRecovery(err), cause: err}
			}
		}
		item.ResourceID = resource.ID
		stagedName := item.TempName
		// The durable resource is now the recovery source. Persist that fact
		// before deleting the staging copy so a crash cannot lose the only path.
		item.TempName = ""
		if err := s.saveMediaCheckpoint(task, checkpoint, "register"); err != nil {
			return nil, err
		}
		if path := s.mediaTempPath(stagedName); path != "" {
			if removeErr := os.Remove(path); removeErr != nil && !os.IsNotExist(removeErr) {
				_ = s.log(task.UserID, task.ID, "warn", "清理作品暂存文件失败", "")
			}
		}
		url := resourceFileURL(resource.ID)
		items = append(items, map[string]interface{}{"dataUrl": url, "url": url, "resourceId": resource.ID, "storageKey": "resource:" + resource.ID, "mimeType": resource.MimeType, "bytes": resource.Size, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs})
	}
	result = map[string]interface{}{"mode": checkpoint.Mode}
	if checkpoint.Mode == "image" {
		result["images"] = items
	} else if checkpoint.Mode == "audio" {
		result["audios"] = items
		// Keep the legacy singular field for clients that render one audio result.
		result["audio"] = items[0]
	} else {
		result[checkpoint.Mode] = items[0]
	}
	return result, nil
}

var errMediaRecoveryBusy = errors.New("作品保存并发已满")

func retryableMediaRecovery(err error) bool {
	if errors.Is(err, errMediaStagingFull) {
		return true
	}
	if retryableProtocolMediaDownload(err) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	// 对象存储的 503 / 限流 / 超时由各家 SDK 的错误类型表达，不是 providerHTTPError。
	if classifyStorageError(err).Transient {
		return true
	}
	var upstream providerHTTPError
	return errors.As(err, &upstream) && (upstream.StatusCode == 429 || upstream.StatusCode == 408 || upstream.StatusCode >= 500)
}

// Called before the generic execution failure path, so result delivery cannot be
// mistaken for model failure or trigger a second generation.
func (s *Service) handleMediaRecoveryFailure(task *model.Task, cause error) error {
	latest, err := s.repo.Task(task.ID)
	if err != nil {
		return err
	}
	if latest.Status != model.TaskStatusRunning || latest.LeaseOwner != task.LeaseOwner {
		return repository.ErrTaskStateConflict
	}
	task.MediaRecoveryJSON, task.MediaStage = latest.MediaRecoveryJSON, latest.MediaStage
	var failure *mediaRecoveryError
	if !errors.As(cause, &failure) {
		failure = &mediaRecoveryError{stage: task.MediaStage, retryable: true, cause: cause}
	}
	if task.MediaRecoveryJSON != "" {
		checkpoint, decodeErr := s.decodeMediaCheckpoint(task)
		if decodeErr != nil {
			return decodeErr
		}
		if errors.Is(cause, errMediaRecoveryBusy) && time.Since(checkpoint.StartedAt) < 20*time.Minute {
			return s.repo.DeferRunningTaskForProviderPoll(task.ID, task.LeaseOwner, "作品已生成，等待保存", 5*time.Second)
		}
		if failure.retryable && checkpoint.Attempts < len(mediaRecoveryDelays) && time.Since(checkpoint.StartedAt) < 20*time.Minute {
			delay := mediaRecoveryDelays[checkpoint.Attempts] + time.Duration(rand.IntN(5_000))*time.Millisecond
			var upstream providerHTTPError
			if errors.As(cause, &upstream) {
				delay = max(delay, min(upstream.RetryAfter, 10*time.Minute))
			}
			checkpoint.Attempts++
			if err := s.saveMediaCheckpoint(task, checkpoint, failure.stage); err != nil {
				return err
			}
			return s.repo.DeferRunningTaskForProviderPoll(task.ID, task.LeaseOwner, "作品已生成，保存遇到问题，正在自动恢复", delay)
		}
		if err := s.saveMediaCheckpoint(task, checkpoint, failure.stage); err != nil {
			return err
		}
	}
	// Billing belongs to the original generation. A delivery failure cannot refund
	// or submit it again implicitly; the existing reconciliation path is retained.
	return s.terminalCoordinator().handleResultPersistenceFailureError(task, failure)
}

func (s *Service) RecoverTaskMedia(userID, id string) (*model.Task, error) {
	if s.IsDraining() {
		return nil, BadAuthRequest("服务正在维护，请稍后重试保存")
	}
	task, err := s.repo.TaskForUser(userID, strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("任务不存在")
	}
	if err != nil {
		return nil, err
	}
	if task.MediaRecoveryJSON == "" {
		return nil, BadAuthRequest("该任务没有可恢复的作品，请先核对上游结果")
	}
	if task.Status == model.TaskStatusRunning || task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusSucceeded {
		return taskForOutput(*task), nil
	}
	if task.Status != model.TaskStatusFailed {
		return nil, BadAuthRequest("仅保存失败的作品可以恢复")
	}
	if _, err := s.mediaTaskProject(task); err != nil {
		return nil, err
	}
	if err := s.taskBilling().CheckRetryEligibility(task.BillingOrderID); err != nil && !errors.Is(err, errTaskBillingReview) {
		return nil, err
	}
	// Never silently restore a refunded order (the old video recovery does that).
	if task.BillingOrderID != "" {
		order, err := s.repo.BillingOrder(task.BillingOrderID)
		if err != nil {
			return nil, err
		}
		if order.UserID != task.UserID || order.TaskID != task.ID {
			return nil, BadAuthRequest("任务与计费订单归属不一致")
		}
		if order.Status == model.BillingStatusRefunded {
			return nil, BadAuthRequest("原任务已退款，请联系管理员处理作品，不会自动重新扣费")
		}
	}
	checkpoint, err := s.decodeMediaCheckpoint(task)
	if err != nil {
		return nil, err
	}
	if checkpoint.ManualAttempts >= 3 {
		return nil, BadAuthRequest("已达到重试保存上限，请联系管理员核对渠道结果")
	}
	if time.Since(checkpoint.LastManualAt) < time.Minute {
		return nil, BadAuthRequest("请稍后再试，重试保存间隔至少一分钟")
	}
	checkpoint.ManualAttempts++
	checkpoint.LastManualAt = time.Now()
	// Manual recovery is one attempt, not another full automatic retry budget.
	checkpoint.Attempts = len(mediaRecoveryDelays)
	data, err := json.Marshal(checkpoint)
	if err != nil {
		return nil, err
	}
	encrypted, err := s.encryptSettingSecret(string(data))
	if err != nil {
		return nil, err
	}
	if err := s.repo.RequeueTaskMediaRecovery(task, encrypted); err != nil {
		if errors.Is(err, repository.ErrTaskStateConflict) {
			if latest, readErr := s.repo.TaskForUser(userID, task.ID); readErr == nil && (latest.Status == model.TaskStatusQueued || latest.Status == model.TaskStatusRunning || latest.Status == model.TaskStatusSucceeded) {
				return taskForOutput(*latest), nil
			}
		}
		return nil, err
	}
	next, err := s.repo.TaskForUser(userID, task.ID)
	if err != nil {
		return nil, err
	}
	return taskForOutput(*next), nil
}

// AdminRecoverTaskMedia 由管理员把“作品已生成但保存失败”的任务重新排队保存。
// 与用户重试不同：不受手动次数限制，重新给满自动重试窗口，并且可以处理已退款订单。
// 订单已退款时必须明确选择补扣（charge）或免除（waive）。
func (s *Service) AdminRecoverTaskMedia(actor *model.User, logID string, refundedBilling string) (result *model.Task, returnErr error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if s.IsDraining() {
		return nil, BadAuthRequest("服务正在维护，请稍后重试")
	}
	log, err := s.repo.APICallLog(strings.TrimSpace(logID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("请求日志不存在")
	}
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(log.TaskID) == "" {
		return nil, BadAuthRequest("该请求没有关联任务")
	}
	task, err := s.repo.Task(log.TaskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("任务不存在")
	}
	if err != nil {
		return nil, err
	}
	if task.UserID != log.UserID {
		return nil, BadAuthRequest("请求与任务归属不一致")
	}
	billingStatus := ""
	refundedBilling = strings.TrimSpace(refundedBilling)
	defer func() {
		outcome := "requeued"
		if returnErr != nil {
			outcome = "failed"
		}
		_ = s.appendAdminAudit(actor, "api_log.recover_task_media", "api_call_log", log.ID, "人工恢复作品保存", map[string]any{
			"apiCallLogId": log.ID, "taskId": task.ID, "billingOrderId": task.BillingOrderID, "billingStatus": billingStatus,
			"refundedBilling": refundedBilling, "outcome": outcome, "error": errorString(returnErr),
		})
	}()
	if task.MediaRecoveryJSON == "" {
		return nil, BadAuthRequest("该任务没有作品恢复信息，请改用查询上游或 URL 转存")
	}
	if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning || task.Status == model.TaskStatusSucceeded {
		return taskForOutput(*task), nil
	}
	if task.Status != model.TaskStatusFailed {
		return nil, BadAuthRequest("仅保存失败的作品可以恢复")
	}
	if task.BillingOrderID != "" {
		order, err := s.repo.BillingOrder(task.BillingOrderID)
		if err != nil {
			return nil, err
		}
		if order.UserID != task.UserID || order.TaskID != task.ID {
			return nil, BadAuthRequest("任务与计费订单归属不一致")
		}
		billingStatus = string(order.Status)
		if order.Status == model.BillingStatusRefunded {
			if refundedBilling != refundedBillingCharge && refundedBilling != refundedBillingWaive {
				return nil, BadAuthRequest("原订单已退款，请选择恢复后补扣或免除扣费")
			}
		} else {
			refundedBilling = ""
		}
	} else {
		refundedBilling = ""
	}
	checkpoint, err := s.decodeMediaCheckpoint(task)
	if err != nil {
		return nil, err
	}
	// 管理员恢复给一次完整的自动重试窗口；存储仍不可用时由本地兜底接住。
	checkpoint.Attempts, checkpoint.StartedAt, checkpoint.RefundedBilling = 0, time.Now(), refundedBilling
	data, err := json.Marshal(checkpoint)
	if err != nil {
		return nil, err
	}
	encrypted, err := s.encryptSettingSecret(string(data))
	if err != nil {
		return nil, err
	}
	if err := s.repo.RequeueTaskMediaRecovery(task, encrypted); err != nil {
		if errors.Is(err, repository.ErrTaskStateConflict) {
			return nil, &AuthError{Status: 409, Message: "任务状态已变化，请刷新后重试"}
		}
		return nil, err
	}
	next, err := s.repo.Task(task.ID)
	if err != nil {
		return nil, err
	}
	return taskForOutput(*next), nil
}

func (s *Service) logMediaStage(task model.Task, stage string, started time.Time, err error) {
	status := model.ApiCallStatusSucceeded
	code, message := "", ""
	if err != nil {
		status = model.ApiCallStatusFailed
		code = "media_" + stage + "_failed"
		message = mediaStageLabel(stage)
		// 只附加存储服务返回的错误码和状态码，不写对象路径、URL 或凭据。
		if label := classifyStorageError(err).Label(); label != "" {
			message += "（存储返回 " + label + "）"
		} else if errors.Is(err, errStorageCircuitOpen) {
			message += "（存储熔断中，未直传）"
		}
	}
	if logErr := s.LogAPICall(model.ApiCallLog{UserID: task.UserID, TaskID: task.ID, BillingOrderID: task.BillingOrderID, ProviderRequestID: task.ProviderRequestID, Source: "backend-task", Capability: capabilityFromTaskType(task.Type), Model: task.Model, RequestKind: stage, Method: "INTERNAL", Path: "task/media/" + stage, Status: status, ErrorCode: code, Error: message, DurationMs: time.Since(started).Milliseconds()}); logErr != nil {
		_ = s.log(task.UserID, task.ID, "error", "记录作品保存阶段失败", logErr.Error())
	}
}

func (s *Service) mediaTempPath(name string) string {
	if !strings.HasPrefix(name, "result-") || filepath.Base(name) != name || strings.ContainsAny(name, `/\\`) {
		return ""
	}
	return filepath.Join(s.dataDir, "media-staging", name)
}

func (c *taskTerminalCoordinator) handleResultPersistenceFailureError(task *model.Task, err error) error {
	_, failure := c.handleResultPersistenceFailure(task, err)
	return failure
}

func (s *Service) finishTaskMediaRecovery(task *model.Task, result map[string]interface{}, err error) error {
	if err != nil {
		return s.handleMediaRecoveryFailure(task, err)
	}
	started := time.Now()
	if _, err = s.finalizeCharacterTurnaroundTask(*task, result); err == nil {
		var encoded []byte
		encoded, err = json.Marshal(result)
		if err == nil {
			err = s.saveTaskCompletionWithinStorageQuota(task, encoded, nil, false)
		}
	}
	s.logMediaStage(*task, "register", started, err)
	if err != nil {
		return s.handleMediaRecoveryFailure(task, &mediaRecoveryError{stage: "register", cause: err})
	}
	settle := s.refundedMediaSettlement(task)
	s.cleanupMediaCheckpointFiles(task)
	return s.terminalCoordinator().handleSuccessWithSettlement(task, settle)
}

// refundedMediaSettlement 处理“订单已退款、作品后来交付成功”的结算。未退款订单返回
// nil，走常规结算。已退款订单只按管理员的决定补扣或免除，绝不静默重新扣费。
func (s *Service) refundedMediaSettlement(task *model.Task) func() error {
	if task.BillingOrderID == "" {
		return nil
	}
	order, err := s.repo.BillingOrder(task.BillingOrderID)
	if err != nil {
		// 读不到订单时交给常规结算报错，进入待核对并记录日志。
		return nil
	}
	if order.Status != model.BillingStatusRefunded {
		return nil
	}
	action := ""
	if checkpoint, err := s.decodeMediaCheckpoint(task); err == nil {
		action = checkpoint.RefundedBilling
	}
	return func() error {
		switch action {
		case refundedBillingCharge:
			if err := s.settleRecoveredBilling(task, task.ProviderRequestID); err != nil {
				return err
			}
			_ = s.log(task.UserID, task.ID, "info", "作品已恢复，管理员确认补扣原订单", "")
		case refundedBillingWaive:
			_ = s.log(task.UserID, task.ID, "info", "作品已恢复，管理员确认免除扣费", "")
		default:
			_ = s.log(task.UserID, task.ID, "warn", "作品已交付，但订单此前已退款，未自动补扣", "")
		}
		return nil
	}
}
