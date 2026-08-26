package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		return nil, err
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
	if task.SessionID != "" {
		session, err := s.repo.SessionForUser(task.UserID, task.SessionID)
		if err != nil {
			return nil, fmt.Errorf("重试任务时读取会话失败：%w", err)
		}
		session.Status = model.SessionStatusActive
		session.CanvasOpsJSON = ""
		if err := s.repo.Save(session); err != nil {
			return nil, fmt.Errorf("重试任务时重置会话失败：%w", err)
		}
	}
	_ = s.log(userID, task.ID, "info", "任务已重新入队", "")
	return taskForOutput(*task), nil
}

func (w *taskLifecycleCoordinator) cancelTask(_ context.Context, userID string, id string) (*model.Task, error) {
	s := w.service
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
	originalStatus := task.Status
	now := time.Now()
	cancelled, err := s.repo.CancelTaskIfStatus(userID, id, task.Status, now)
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
	s.cancelActiveTask(task.ID)

	// 这些收尾操作必须幂等；任何单项失败都记录日志，但不能让已经落库的
	// cancelled 状态重新对用户表现为“取消失败”。
	if err := s.markSessionFailed(*task, "会话任务已取消。"); err != nil {
		_ = s.log(task.UserID, task.ID, "error", "取消任务后更新会话状态失败", err.Error())
	}
	if err := s.finalizeTaskTextReplay(task.ID, model.TaskStatusCancelled); err != nil {
		_ = s.log(task.UserID, task.ID, "error", "取消任务后归并文本回放失败", err.Error())
	}
	_ = s.log(task.UserID, task.ID, "warn", "用户主动取消任务", "")

	if task.ProviderRequestID != "" {
		// 上游取消可能需要轮询确认，不能阻塞取消接口；请求上下文也不能因
		// 浏览器关闭而中断。后台对账会继续负责退款或费用核对。
		cancelTask := *task
		go func() {
			requestCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := s.requestProviderCancellation(requestCtx, &cancelTask); err != nil {
				_ = s.log(cancelTask.UserID, cancelTask.ID, "error", "发送上游取消请求失败", err.Error())
			}
		}()
	} else {
		var billingErr error
		if originalStatus == model.TaskStatusQueued {
			billingErr = s.taskBilling().RefundBilling(task.BillingOrderID, "用户主动取消，且任务尚未开始执行")
		} else {
			// running 任务可能已经发起上游调用但尚未把 request ID 写回，不能
			// 直接退款后放任上游继续生成，先冻结为待核对更安全。
			billingErr = s.taskBilling().MarkBillingUncertain(task.BillingOrderID, "用户取消时上游请求 ID 尚未确认，费用待核对")
		}
		if billingErr != nil {
			_ = s.log(task.UserID, task.ID, "error", "取消任务后处理积分失败，已保留人工核对线索", billingErr.Error())
		}
	}

	return taskForOutput(*task), nil
}
