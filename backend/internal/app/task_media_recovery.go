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

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/repository"
)

// Recovery is keyed by the task, not a second generation or billing order.
type mediaCheckpoint struct {
	Mode           string                `json:"mode"`
	Items          []mediaCheckpointItem `json:"items"`
	StartedAt      time.Time             `json:"startedAt"`
	Attempts       int                   `json:"attempts"`
	ManualAttempts int                   `json:"manualAttempts"`
	LastManualAt   time.Time             `json:"lastManualAt"`
}

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
	if mode != "image" {
		references = references[:1]
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
			resource, err = s.storeTaskMediaFile(task, index, path, item.MIMEType, checkpoint.Mode, resource)
			s.logMediaStage(*task, stage, started, err)
			if err != nil {
				return nil, &mediaRecoveryError{stage: stage, retryable: retryableMediaRecovery(err), cause: err}
			}
		}
		item.ResourceID = resource.ID
		if err := s.saveMediaCheckpoint(task, checkpoint, "register"); err != nil {
			return nil, err
		}
		url := resourceFileURL(resource.ID)
		items = append(items, map[string]interface{}{"dataUrl": url, "url": url, "resourceId": resource.ID, "storageKey": "resource:" + resource.ID, "mimeType": resource.MimeType, "bytes": resource.Size, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs})
	}
	result = map[string]interface{}{"mode": checkpoint.Mode}
	if checkpoint.Mode == "image" {
		result["images"] = items
	} else {
		result[checkpoint.Mode] = items[0]
	}
	return result, nil
}

var errMediaRecoveryBusy = errors.New("作品保存并发已满")

func retryableMediaRecovery(err error) bool {
	if retryableProtocolMediaDownload(err) || errors.Is(err, context.DeadlineExceeded) {
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

func (s *Service) logMediaStage(task model.Task, stage string, started time.Time, err error) {
	status := model.ApiCallStatusSucceeded
	code, message := "", ""
	if err != nil {
		status = model.ApiCallStatusFailed
		code = "media_" + stage + "_failed"
		message = mediaStageLabel(stage)
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
	s.cleanupMediaCheckpointFiles(task)
	return s.terminalCoordinator().handleSuccess(task)
}
