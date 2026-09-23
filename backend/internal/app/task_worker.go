package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platform"
)

const newAPIChannel2TaskSyncMaxAge = 5 * time.Minute

// taskWorkerCoordinator 收敛任务领取、租约维护和执行结果落库，避免 Service 同时承担 worker 生命周期与业务命令。
type taskWorkerCoordinator struct {
	service *Service
}

const workerSlotLeaseDuration = time.Minute

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

func (w *taskWorkerCoordinator) start(ctx context.Context) {
	s := w.service
	s.startTextReplayCleanup(ctx)
	s.startProviderCancellationReconciliation(ctx)
	s.startBillingReviewAudit(ctx)
	s.startAgentMemoryCompactScheduler()
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			if ctx.Err() != nil {
				return
			}
			if !s.IsDraining() {
				s.advanceCloudAgents()
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
	s.runWorkerLoop(func(ctx context.Context) {
		slots := make(chan struct{}, maxChannelConcurrencyLimit)
		dispatch := func() {
			if ctx.Err() != nil || s.IsDraining() {
				return
			}
			setting, err := s.runtimeConcurrencySetting()
			if err != nil {
				log.Printf("task dispatch paused: stage=runtime_policy worker_id=%s error=%v", s.workerID, err)
				return
			}
			workerConcurrency := setting.WorkerConcurrency
			for len(slots) < workerConcurrency {
				globalSlot, acquired, err := s.coordinator.AcquireLease(ctx, "workers", workerConcurrency, workerSlotLeaseDuration)
				if err != nil || !acquired {
					if err != nil {
						log.Printf("task dispatch paused: stage=global_slot worker_id=%s error=%v", s.workerID, err)
					}
					return
				}
				claimCtx, cancelClaim := context.WithTimeout(ctx, 5*time.Second)
				// 每次领取使用独立 owner，防止同一进程内旧执行者恢复后覆盖新执行者。
				task, err := s.repo.WithContext(claimCtx).ClaimNextTask(globalSlot.Token(), 45*time.Second)
				cancelClaim()
				if err != nil || task == nil {
					globalSlot.Release()
					if err != nil {
						log.Printf("task dispatch paused: stage=claim worker_id=%s error=%v", s.workerID, err)
					}
					return
				}
				slots <- struct{}{}
				started := s.runWorkerTask(func() {
					defer func() { <-slots; globalSlot.Release() }()
					if err := w.processClaimedTask(task, globalSlot); err != nil {
						_ = s.log(task.UserID, task.ID, "error", "后台任务处理失败", err.Error())
					}
				})
				if !started {
					<-slots
					globalSlot.Release()
					_ = s.repo.ReleaseTaskLease(task.ID, task.LeaseOwner)
					return
				}
			}
		}

		dispatch()
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				dispatch()
			}
		}
	})
}

func (w *taskWorkerCoordinator) processNextTask() error {
	s := w.service
	task, err := s.repo.ClaimNextTask(s.workerID+":"+newID(), 45*time.Second)
	if err != nil || task == nil {
		return err
	}
	return w.processClaimedTask(task, nil)
}

func (w *taskWorkerCoordinator) processClaimedTask(task *model.Task, globalSlot *platform.SlotLease) error {
	s := w.service
	terminal := s.terminalCoordinator()
	policyCtx, cancelPolicy := context.WithTimeout(context.Background(), 3*time.Second)
	reader := &Service{repo: s.repo.WithContext(policyCtx)}
	policy, err := reader.RuntimePolicy()
	cancelPolicy()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), taskExecutionTimeout(task, policy.Task))
	defer cancel()
	leaseDone := make(chan struct{})
	leaseLost := make(chan error, 1)
	taskID, leaseOwner := task.ID, task.LeaseOwner
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				renewCtx, cancelRenew := taskLeaseRenewContext(ctx)
				var err error
				if globalSlot != nil {
					err = globalSlot.Renew(renewCtx)
				}
				if err == nil {
					err = s.repo.WithContext(renewCtx).RenewTaskLease(taskID, leaseOwner, 45*time.Second)
				}
				cancelRenew()
				if err != nil {
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
	_ = s.log(task.UserID, task.ID, "info", "后端任务开始处理", "")
	s.registerActiveTask(task.ID, cancel)
	defer s.unregisterActiveTask(task.ID)
	// 取消请求可能在任务领取和注册 worker context 之间到达；再次读取终态
	// 可以避免这种极窄窗口仍然向上游发起调用。
	if latest, latestErr := s.repo.Task(task.ID); latestErr == nil && latest.Status == model.TaskStatusCancelled {
		return terminal.handleAlreadyCancelled(*latest)
	}

	// 时间线转写由本地 whisper.cpp 执行，不经计费与模型渠道路由，
	// 在进入通用生成流程前按类型分叉到独立执行器。
	if task.Type == model.TaskTypeTimelineTranscription {
		return w.processTimelineTranscription(task, ctx)
	}
	if task.Type == model.TaskTypeTimelineRender {
		return w.processTimelineRender(task, ctx)
	}
	if task.MediaRecoveryJSON != "" {
		result, recoveryErr := s.resumeTaskMedia(ctx, task)
		return s.finishTaskMediaRecovery(task, result, recoveryErr)
	}

	s.markAgentMemoryCompactRunning(*task)
	task.Stage = "调用生成模型"
	task.Progress = 35
	if taskUsesUpstreamReportedProgress(task.Type) {
		// 图片/视频百分比只能来自供应商状态响应。连接和提交阶段只展示文案，
		// 不能再用统一的 35% 冒充真实生成进度。
		task.Stage = "作品创作中"
		task.Progress = 0
	}
	if err := s.repo.UpdateTaskProgressForLease(task.ID, task.LeaseOwner, task.Stage, task.Progress); err != nil {
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
	select {
	case leaseErr := <-leaseLost:
		return fmt.Errorf("任务租约失效，停止保存上游结果：%w", leaseErr)
	default:
	}
	result, canvasOps, err := routeResult.result, routeResult.canvasOps, routeResult.err
	latestMedia, readErr := s.repo.Task(task.ID)
	if readErr != nil {
		return readErr
	}
	task.MediaRecoveryJSON, task.MediaStage = latestMedia.MediaRecoveryJSON, latestMedia.MediaStage
	var deliveryFailure *mediaRecoveryError
	if task.MediaRecoveryJSON != "" || errors.As(err, &deliveryFailure) {
		return s.finishTaskMediaRecovery(task, result, err)
	}
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
		// 续租使用独立 context；执行超时不能覆盖真实租约失效，否则旧 worker
		// 可能在新 worker 接管后继续结算或写入终态。
		deadlineExpired := errors.Is(ctx.Err(), context.DeadlineExceeded)
		select {
		case leaseErr := <-leaseLost:
			_ = s.log(task.UserID, task.ID, "warn", "任务租约失效，等待其他 worker 恢复", leaseErr.Error())
			return leaseErr
		default:
		}
		decryptedInput, decryptErr := s.decryptTaskInputJSON(task.InputJSON)
		if decryptErr == nil && s.shouldDeferVideoProviderTask(*task, decryptedInput, err) {
			stage := "后台仍在生成"
			message := "前台等待结束，上游视频仍在生成，将继续回查原任务"
			var pendingErr providerStatePendingError
			if errors.As(err, &pendingErr) {
				stage = "等待上游任务同步"
				message = "上游任务状态暂未同步，将继续回查原任务"
			}
			if deferErr := s.repo.DeferRunningTaskForProviderPoll(task.ID, task.LeaseOwner, stage, 15*time.Second); deferErr != nil {
				return deferErr
			}
			_ = s.log(task.UserID, task.ID, "info", message, task.PollStage)
			return nil
		}
		if newAPIChannel2TaskSyncExpired(*task, err, time.Now()) {
			err = errors.New("上游任务长时间未同步，已停止自动查询，请确认渠道任务状态后重试。")
		}
		if errors.Is(err, context.DeadlineExceeded) || deadlineExpired {
			// 画布 Agent 的单步超时是可恢复事件（运行期会关思考重试同一步），
			// 因此必须与"任务执行超时"区分开，否则只能整轮判死。
			if cloudAgentModelOperation(task) {
				err = errors.New(cloudAgentStepTimeoutError + "，已中止这一步")
			} else {
				err = errors.New(taskTimeoutMessage(task.Type))
			}
		}
		s.noteAgentMemoryCompactTask(*task, nil, err)
		return terminal.handleExecutionFailure(task, err, providerSucceeded, channelSlotFailedBeforeRequest)
	}
	latest, err := s.repo.Task(task.ID)
	if err != nil {
		return err
	}
	if latest.Status == model.TaskStatusCancelled {
		s.noteAgentMemoryCompactTask(*task, nil, errors.New("压缩任务已取消"))
		return terminal.handleCancelledResult(*latest)
	}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		s.noteAgentMemoryCompactTask(*task, nil, err)
		_, terminalErr := terminal.handleResultPersistenceFailure(task, fmt.Errorf("序列化任务结果失败：%w", err))
		return terminalErr
	}
	opsJSON, err := json.Marshal(canvasOps)
	if err != nil {
		s.noteAgentMemoryCompactTask(*task, nil, err)
		_, terminalErr := terminal.handleResultPersistenceFailure(task, fmt.Errorf("序列化画布操作失败：%w", err))
		return terminalErr
	}
	if err := s.saveTaskCompletionWithinStorageQuota(task, resultJSON, opsJSON, len(canvasOps) > 0); err != nil {
		s.noteAgentMemoryCompactTask(*task, nil, err)
		_, terminalErr := terminal.handleResultPersistenceFailure(task, err)
		return terminalErr
	}
	s.noteAgentMemoryCompactTask(*task, result, nil)
	return terminal.handleSuccess(task)
}

func taskUsesUpstreamReportedProgress(taskType string) bool {
	return taskType == "canvas_image" || taskType == "canvas_video" || strings.HasPrefix(taskType, "video_")
}

func taskFailureMessage(err error) string {
	if err == nil {
		return "任务处理失败"
	}
	return truncateRunes(err.Error(), 2_000)
}

// taskLeaseRenewContext 给续租单独一份"不继承父 context 取消/时限"的上下文（仅 5 秒上限）。
//
// 续租必须比"这一条任务的执行时限"活得更久：父 context 一旦到点，派生的续租 context 会立刻
// 被取消，续租请求带着 context.Canceled 失败并被误判成"租约失效"，任务于是停在 running，
// 租约过期后又被其它 worker 重跑（实测一次上游调用被重跑成三次）。
func taskLeaseRenewContext(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(parent), 5*time.Second)
}

// taskExecutionTimeout 解析一次任务的执行墙钟：画布 Agent 的单步调用可以配秒级超时
// （AgentStepTimeoutSeconds），没配时沿用文本任务超时。秒级粒度是必要的——一轮里每一步
// 都是分钟级的调用，分钟粒度改不动"某一步卡住"的体验。
// 超时的表现是任务错误里带 cloudAgentStepTimeoutError 标记，运行期据此关思考重试同一步，
// 而不是把整轮判死（见 cloud_agent_step_timeout.go）。
func taskExecutionTimeout(task *model.Task, policy RuntimeTaskPolicy) time.Duration {
	if task != nil && cloudAgentModelOperation(task) && policy.AgentStepTimeoutSeconds > 0 {
		return time.Duration(policy.AgentStepTimeoutSeconds) * time.Second
	}
	if task == nil {
		return time.Duration(policy.DefaultTimeoutMinutes) * time.Minute
	}
	return taskExecutionTimeoutWithPolicy(task.Type, policy)
}

func taskExecutionTimeoutWithPolicy(taskType string, policy RuntimeTaskPolicy) time.Duration {
	switch {
	case strings.HasPrefix(taskType, "canvas_video") || strings.HasPrefix(taskType, "video_"):
		return max(time.Duration(policy.VideoTimeoutMinutes)*time.Minute, 5*time.Minute)
	case strings.HasPrefix(taskType, "canvas_image"):
		return time.Duration(policy.ImageTimeoutMinutes) * time.Minute
	case strings.HasPrefix(taskType, "canvas_audio"):
		return time.Duration(policy.AudioTimeoutMinutes) * time.Minute
	case strings.HasPrefix(taskType, "canvas_text"):
		return time.Duration(policy.TextTimeoutMinutes) * time.Minute
	case taskType == model.TaskTypeTimelineTranscription:
		// 本地转写受媒体时长影响，给出独立宽松超时。
		return 20 * time.Minute
	case taskType == model.TaskTypeTimelineRender:
		// 渲染是整条时间线的重编码，耗时随长度线性增长。
		return 60 * time.Minute
	default:
		return time.Duration(policy.DefaultTimeoutMinutes) * time.Minute
	}
}

func (s *Service) shouldDeferVideoProviderTask(task model.Task, decryptedInput string, err error) bool {
	providerRequestID := strings.TrimSpace(task.ProviderRequestID)
	if providerRequestID == "" || (!strings.HasPrefix(task.Type, "canvas_video") && !strings.HasPrefix(task.Type, "video_")) {
		return false
	}
	deferSignal := errors.Is(err, context.DeadlineExceeded)
	var pendingErr providerStatePendingError
	if errors.As(err, &pendingErr) {
		deferSignal = strings.TrimSpace(pendingErr.TaskID) == providerRequestID && !newAPIChannel2TaskSyncExpired(task, err, time.Now())
	}
	if !deferSignal {
		return false
	}
	var input canvasGenerationInput
	if json.Unmarshal([]byte(decryptedInput), &input) != nil {
		return false
	}
	resolved, resolveErr := s.resolveProviderConfig(input.Config)
	return resolveErr == nil && resolved.InterfaceType == string(model.ChannelInterfaceNewAPIChannel2)
}

func newAPIChannel2TaskSyncExpired(task model.Task, err error, now time.Time) bool {
	var pendingErr providerStatePendingError
	if !errors.As(err, &pendingErr) || strings.TrimSpace(pendingErr.TaskID) == "" || strings.TrimSpace(pendingErr.TaskID) != strings.TrimSpace(task.ProviderRequestID) {
		return false
	}
	if task.StartedAt == nil {
		return true
	}
	return !now.Before(task.StartedAt.Add(newAPIChannel2TaskSyncMaxAge))
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
