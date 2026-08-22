package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// taskWorkerCoordinator 收敛任务领取、租约维护和执行结果落库，避免 Service 同时承担 worker 生命周期与业务命令。
type taskWorkerCoordinator struct {
	service *Service
}

func newTaskWorkerCoordinator(service *Service) *taskWorkerCoordinator {
	return &taskWorkerCoordinator{service: service}
}

func (s *Service) taskWorker() *taskWorkerCoordinator {
	if s.taskWorkerCoordinator != nil {
		return s.taskWorkerCoordinator
	}
	// 部分单元测试直接构造 Service 字面量；延迟创建保持这些测试和内部工具兼容。
	return newTaskWorkerCoordinator(s)
}

func (w *taskWorkerCoordinator) start() {
	s := w.service
	s.startTextReplayCleanup()
	s.startProviderCancellationReconciliation()
	s.startBillingReviewAudit()
	go func() {
		slots := make(chan struct{}, maxChannelConcurrencyLimit)
		dispatch := func() {
			setting, err := s.runtimeConcurrencySetting()
			if err != nil {
				return
			}
			workerConcurrency := setting.WorkerConcurrency
			for len(slots) < workerConcurrency {
				releaseGlobal, acquired, err := s.coordinator.acquire(context.Background(), "workers", workerConcurrency, 45*time.Minute)
				if err != nil || !acquired {
					return
				}
				task, err := s.repo.ClaimNextTask(s.workerID, 45*time.Second)
				if err != nil || task == nil {
					releaseGlobal()
					return
				}
				slots <- struct{}{}
				go func(task *model.Task) {
					defer func() { <-slots; releaseGlobal() }()
					if err := w.processClaimedTask(task); err != nil {
						_ = s.log(task.UserID, task.ID, "error", "后台任务处理失败", err.Error())
					}
				}(task)
			}
		}

		dispatch()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			dispatch()
		}
	}()
}

func (w *taskWorkerCoordinator) processNextTask() error {
	s := w.service
	task, err := s.repo.ClaimNextTask(s.workerID, 45*time.Second)
	if err != nil || task == nil {
		return err
	}
	return w.processClaimedTask(task)
}

func (w *taskWorkerCoordinator) processClaimedTask(task *model.Task) error {
	s := w.service
	terminal := s.terminalCoordinator()
	_ = s.log(task.UserID, task.ID, "info", "后端任务开始处理", "")
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), taskExecutionTimeoutWithPolicy(task.Type, policy.Task))
	defer cancel()
	leaseDone := make(chan struct{})
	leaseLost := make(chan error, 1)
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := s.repo.RenewTaskLease(task.ID, s.workerID, 45*time.Second); err != nil {
					leaseLost <- err
					cancel()
					return
				}
			case <-leaseDone:
				return
			}
		}
	}()
	defer close(leaseDone)
	s.registerActiveTask(task.ID, cancel)
	defer s.unregisterActiveTask(task.ID)

	task.Stage = "调用生成模型"
	task.Progress = 35
	if err := s.repo.UpdateTaskProgress(task.ID, task.Stage, task.Progress); err != nil {
		return fmt.Errorf("更新任务进度失败，任务暂未调用上游：%w", err)
	}
	routeAttempt, err := s.beginTaskRouteAttempt(task)
	if err != nil {
		return terminal.markPreparationFailure(task, "路由准备失败", err, isRouteDispatchUncertain(err), "路由准备失败，上游请求未发出")
	}
	if err := s.taskBilling().MarkBillingRunning(task.BillingOrderID); err != nil {
		return terminal.markPreparationFailure(task, "计费准备失败", err, false, "计费准备失败，上游请求未发出")
	}
	routeResult, stateErr := s.routeExecutor().execute(ctx, task, routeAttempt)
	if stateErr != nil {
		return stateErr
	}
	result, canvasOps, err := routeResult.result, routeResult.canvasOps, routeResult.err
	providerSucceeded := routeResult.providerSucceeded
	if err == nil {
		result, err = s.persistGeneratedMediaResult(task.UserID, result)
	}
	if err == nil {
		_, err = s.finalizeCharacterTurnaroundTask(*task, result)
	}
	if err != nil {
		channelSlotFailedBeforeRequest := false
		if code, _ := ChannelSlotFailureDetails(err); code != "" {
			channelSlotFailedBeforeRequest = true
		}
		select {
		case leaseErr := <-leaseLost:
			_ = s.log(task.UserID, task.ID, "warn", "任务租约失效，等待其他 worker 恢复", leaseErr.Error())
			return leaseErr
		default:
		}
		if errors.Is(err, context.DeadlineExceeded) {
			decryptedInput, decryptErr := s.decryptTaskInputJSON(task.InputJSON)
			if decryptErr == nil && s.shouldDeferVideoProviderTask(*task, decryptedInput, err) {
				if deferErr := s.repo.DeferRunningTaskForProviderPoll(task.ID, task.LeaseOwner, "后台仍在生成", 15*time.Second); deferErr != nil {
					return deferErr
				}
				_ = s.log(task.UserID, task.ID, "info", "前台等待结束，上游视频仍在生成，将继续回查原任务", task.PollStage)
				return nil
			}
			err = errors.New(taskTimeoutMessage(task.Type))
		}
		return terminal.handleExecutionFailure(task, err, providerSucceeded, channelSlotFailedBeforeRequest)
	}
	latest, err := s.repo.Task(task.ID)
	if err != nil {
		return err
	}
	if latest.Status == model.TaskStatusCancelled {
		return terminal.handleCancelledResult(*latest)
	}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		_, terminalErr := terminal.handleResultPersistenceFailure(task, fmt.Errorf("序列化任务结果失败：%w", err))
		return terminalErr
	}
	opsJSON, err := json.Marshal(canvasOps)
	if err != nil {
		_, terminalErr := terminal.handleResultPersistenceFailure(task, fmt.Errorf("序列化画布操作失败：%w", err))
		return terminalErr
	}
	if err := s.saveTaskCompletionWithinStorageQuota(task, resultJSON, opsJSON, len(canvasOps) > 0); err != nil {
		_, terminalErr := terminal.handleResultPersistenceFailure(task, err)
		return terminalErr
	}
	return terminal.handleSuccess(task)
}

func taskFailureMessage(err error) string {
	if err == nil {
		return "任务处理失败"
	}
	return truncateRunes(err.Error(), 2_000)
}

func taskExecutionTimeoutWithPolicy(taskType string, policy RuntimeTaskPolicy) time.Duration {
	switch {
	case taskType == "agent_storyboard" || taskType == "agent_storyboard_rows":
		return time.Duration(policy.StoryboardTimeoutMinutes) * time.Minute
	case strings.HasPrefix(taskType, "canvas_video") || strings.HasPrefix(taskType, "video_"):
		return max(time.Duration(policy.VideoTimeoutMinutes)*time.Minute, 5*time.Minute)
	case strings.HasPrefix(taskType, "canvas_image"):
		return time.Duration(policy.ImageTimeoutMinutes) * time.Minute
	case strings.HasPrefix(taskType, "canvas_audio"):
		return time.Duration(policy.AudioTimeoutMinutes) * time.Minute
	case strings.HasPrefix(taskType, "canvas_text"):
		return time.Duration(policy.TextTimeoutMinutes) * time.Minute
	default:
		return time.Duration(policy.DefaultTimeoutMinutes) * time.Minute
	}
}

func (s *Service) shouldDeferVideoProviderTask(task model.Task, decryptedInput string, err error) bool {
	if !errors.Is(err, context.DeadlineExceeded) || strings.TrimSpace(task.ProviderRequestID) == "" || (!strings.HasPrefix(task.Type, "canvas_video") && !strings.HasPrefix(task.Type, "video_")) {
		return false
	}
	var input canvasGenerationInput
	if json.Unmarshal([]byte(decryptedInput), &input) != nil {
		return false
	}
	resolved, resolveErr := s.resolveProviderConfig(input.Config)
	return resolveErr == nil && resolved.InterfaceType == string(model.ChannelInterfaceNewAPIChannel2)
}

func taskTimeoutMessage(taskType string) string {
	if strings.HasPrefix(taskType, "canvas_video") || strings.HasPrefix(taskType, "video_") {
		return "视频生成等待超时，请稍后到任务中心查看或重试。"
	}
	if strings.HasPrefix(taskType, "canvas_image") {
		return "图片生成等待超时，请稍后重试。"
	}
	return "任务执行超时，请稍后重试。"
}
