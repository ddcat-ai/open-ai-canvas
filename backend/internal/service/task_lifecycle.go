package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

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
	// 任务创建后可能已经产生上游费用。取消接口保留用于兼容旧客户端，
	// 但不能再改变任务状态、退款或结束关联会话；页面离开只应停止监听。
	if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning || task.ProviderRequestID != "" {
		return nil, errors.New("任务已发起，无法取消，请等待任务完成")
	}
	return nil, fmt.Errorf("任务当前状态为 %s，无法取消", task.Status)
}
