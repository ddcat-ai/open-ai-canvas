package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// taskLifecycleCoordinator 负责任务重试与取消这类会改变任务状态的写命令。
// 读模型和 worker 执行细节留在各自边界，避免写命令跨层拼接状态更新。
type taskLifecycleCoordinator struct {
	service *Service
}

func newTaskLifecycleCoordinator(service *Service) *taskLifecycleCoordinator {
	return &taskLifecycleCoordinator{service: service}
}

func (s *Service) taskLifecycle() *taskLifecycleCoordinator {
	if s.taskLifecycleCoordinator != nil {
		return s.taskLifecycleCoordinator
	}
	// 部分单元测试直接构造 Service 字面量；延迟创建保持这些测试和内部工具兼容。
	return newTaskLifecycleCoordinator(s)
}

func (w *taskLifecycleCoordinator) retryTask(userID string, id string) (*model.Task, error) {
	s := w.service
	if s.IsDraining() {
		return nil, &AppError{Status: 503, Code: 503, Message: "服务正在维护，暂不接受任务重试", Retryable: true}
	}
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		return nil, err
	}
	if task.MediaRecoveryJSON != "" {
		return nil, BadAuthRequest("作品已生成，请使用重试保存，不要重复生成")
	}
	if task.CreationSubmissionID != nil {
		return nil, creationConflict("智能创作重做需要新的报价批准，请回到创作会话继续")
	}
	if task.AgentRunID != "" || task.GenerationID != "" || strings.HasPrefix(task.Operation, "cloud_agent") || taskHasAgentOrigin(task.InputJSON) {
		return nil, BadAuthRequest("Agent 重试需要新的幂等键和预算校验，请回到 Agent 对话重新发送")
	}
	if task.Status != model.TaskStatusFailed && task.Status != model.TaskStatusCancelled {
		return nil, errors.New("only failed or cancelled tasks can be retried")
	}
	if task.ProviderCancelStatus == model.ProviderCancelStatusRequested {
		return nil, BadAuthRequest("上游取消状态仍在确认中，请确认费用结果后再重试")
	}
	if err := s.taskBilling().CheckRetryEligibility(task.BillingOrderID); err != nil {
		if errors.Is(err, errTaskBillingReview) {
			return nil, BadAuthRequest("上一次调用费用仍在核对中，处理完成前不能重复提交")
		}
		return nil, err
	}
	if isContentModerationFailure(task.Error) {
		return nil, BadAuthRequest(contentModerationRetryMessage)
	}
	decryptedInput, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, err
	}
	var billingInput map[string]any
	if err := json.Unmarshal([]byte(decryptedInput), &billingInput); err != nil {
		return nil, err
	}
	if err := s.prepareLogicalTaskRetry(task, billingInput); err != nil {
		return nil, err
	}
	if err := s.requireCustomChannelsForTaskInput(billingInput); err != nil {
		return nil, err
	}
	billingOrder, err := s.taskBillingOrder(userID, task, billingInput)
	if err != nil {
		return nil, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	if err := s.ensureTaskProjectActive(userID, task.ProjectID); err != nil {
		return nil, err
	}
	task, err = s.repo.RetryTaskWithBilling(userID, task, billingOrder, policy.Task.ActiveTaskLimit)
	if errors.Is(err, repository.ErrInsufficientCredits) {
		return nil, BadAuthRequest("积分不足，请先使用兑换码充值")
	}
	if errors.Is(err, repository.ErrActiveTaskLimit) {
		return nil, BadAuthRequest(fmt.Sprintf("同时排队或运行的任务最多 %d 个，请等待已有任务完成", policy.Task.ActiveTaskLimit))
	}
	if errors.Is(err, repository.ErrTaskNotRetryable) {
		return nil, BadAuthRequest("任务已被其他请求重新入队，请勿重复重试")
	}
	if err != nil {
		return nil, err
	}
	_ = s.log(userID, task.ID, "info", "任务已重新入队", "")
	return taskForOutput(*task), nil
}

func (w *taskLifecycleCoordinator) cancelTask(ctx context.Context, userID string, id string) (*model.Task, error) {
	return w.cancelTaskWithIntent(ctx, userID, id, model.TaskCancellationIntent{Source: model.TaskCancellationUserRequest, ActorID: userID})
}

func (w *taskLifecycleCoordinator) cancelTaskWithIntent(_ context.Context, userID string, id string, intent model.TaskCancellationIntent) (*model.Task, error) {
	s := w.service
	switch intent.Source {
	case model.TaskCancellationUserRequest, model.TaskCancellationParentCancelled, model.TaskCancellationParentFailed, model.TaskCancellationWorkerContext:
	default:
		return nil, BadAuthRequest("取消请求缺少有效来源")
	}
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		return nil, err
	}
	if task.Status != model.TaskStatusQueued && task.Status != model.TaskStatusRunning {
		if task.Status == model.TaskStatusCancelled {
			return taskForOutput(*task), nil
		}
		return nil, fmt.Errorf("任务当前状态为 %s，无法取消", task.Status)
	}

	// 先从账单和请求日志补齐上游 ID，再做条件更新。取消与 worker 完成之间
	// 以数据库终态为准，避免“用户已取消但迟到结果又把任务写成成功”。
	s.hydrateTaskProviderRequestID(task)
	// 用户一旦看到任务进入上游提交/生成阶段，即使 request ID 尚未来得及写回，
	// 也必须按“可能已经产生上游费用”处理。父任务失败和 worker context 属于
	// 内部协调，仍需继续走下面的上游取消/对账流程，不能被这条 UI 规则截断。
	if intent.Source == model.TaskCancellationUserRequest && (strings.TrimSpace(task.ProviderRequestID) != "" || task.MediaStage != "" || !taskStageAllowsUserCancellation(task.Status, task.Stage)) {
		return nil, BadAuthRequest("第三方请求已提交，任务不可取消")
	}
	originalStatus := task.Status
	now := time.Now()
	if intent.RequestedAt.IsZero() {
		intent.RequestedAt = now
	}
	task.Error = "任务已取消"
	recordTaskDiagnostic(task, "cancellation", "task_cancelled", taskSubmissionOutcome(task, originalStatus == model.TaskStatusQueued), "reconcile_cancellation", nil)
	intent.Diagnostic = *task.Diagnostic
	cancelled, err := s.repo.CancelTaskIfStatus(userID, id, task.Status, now, intent)
	if err != nil {
		return nil, err
	}
	if !cancelled {
		latest, latestErr := s.repo.TaskForUser(userID, id)
		if latestErr != nil {
			return nil, latestErr
		}
		if latest.Status == model.TaskStatusCancelled {
			return taskForOutput(*latest), nil
		}
		return nil, errors.New("任务状态已变化，请刷新后重试")
	}

	task.Status = model.TaskStatusCancelled
	task.Stage = "任务已取消"
	task.Error = "任务已取消"
	task.CompletedAt = &now
	task.CancellationSource, task.CancellationActorID, task.CancellationRequestedAt = intent.Source, intent.ActorID, &intent.RequestedAt
	s.cancelActiveTask(task.ID)

	// 这些收尾操作必须幂等；任何单项失败都记录日志，但不能让已经落库的
	// cancelled 状态重新对用户表现为“取消失败”。
	if err := s.finalizeTaskTextReplay(task.ID, model.TaskStatusCancelled); err != nil {
		_ = s.log(task.UserID, task.ID, "error", "取消任务后归并文本回放失败", err.Error())
	}
	_ = s.log(task.UserID, task.ID, "warn", "任务取消请求已保存", task.CancellationSource)

	if task.ProviderRequestID != "" {
		// 上游取消可能需要轮询确认，不能阻塞取消接口；请求上下文也不能因
		// 浏览器关闭而中断。后台对账会继续负责退款或费用核对。
		cancelTask := *task
		started := s.runWorkerTask(func() {
			requestCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := s.requestProviderCancellation(requestCtx, &cancelTask); err != nil {
				_ = s.log(cancelTask.UserID, cancelTask.ID, "error", "发送上游取消请求失败", err.Error())
			}
		})
		if !started {
			// drain 后不能启动未登记 goroutine；当前 HTTP 请求同步完成首次取消，
			// http.Server.Shutdown 会等待该请求，后续确认仍由持久化对账恢复。
			requestCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			if err := s.requestProviderCancellation(requestCtx, &cancelTask); err != nil {
				_ = s.log(cancelTask.UserID, cancelTask.ID, "error", "发送上游取消请求失败", err.Error())
			}
			cancel()
		}
	} else {
		var billingErr error
		if originalStatus == model.TaskStatusQueued {
			billingErr = s.taskBilling().RefundBilling(task.BillingOrderID, "任务取消且尚未开始执行；来源："+intent.Source)
		} else {
			// running 任务可能已经发起上游调用但尚未把 request ID 写回，不能
			// 直接退款后放任上游继续生成，先冻结为待核对更安全。
			billingErr = s.taskBilling().MarkBillingUncertain(task.BillingOrderID, "取消时上游请求 ID 尚未确认，费用待核对；来源："+intent.Source)
		}
		if billingErr != nil {
			_ = s.log(task.UserID, task.ID, "error", "取消任务后处理积分失败，已保留人工核对线索", billingErr.Error())
		}
	}

	return taskForOutput(*task), nil
}

func taskStageAllowsUserCancellation(status model.TaskStatus, stage string) bool {
	switch strings.ToLower(strings.TrimSpace(stage)) {
	case "":
		return status == model.TaskStatusQueued
	case "queued", "等待队列调度":
		return true
	case "后端接管任务", "正在准备创作":
		return status == model.TaskStatusRunning || status == model.TaskStatusQueued
	default:
		return false
	}
}
