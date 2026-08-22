package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// taskTerminalCoordinator 收敛任务进入终态后的业务策略。
//
// 任务执行本身仍由 Service 编排，但“失败如何记账、取消如何投影到会话、
// 成功后如何收尾”必须保持一致，不能散落在 provider/worker 分支中。
type taskTerminalCoordinator struct {
	repo              taskTerminalRepository
	billing           taskBillingLifecycle
	replay            taskReplayLifecycle
	sessions          taskSessionLifecycle
	logger            taskLifecycleLogger
	outputs           taskOutputLifecycle
	userFacingMessage func(error) string
}

type taskTerminalRepository interface {
	Task(id string) (*model.Task, error)
	UpdateTaskTerminalState(id string, expected model.TaskStatus, status model.TaskStatus, stage string, errorText string, completedAt time.Time) (bool, error)
}

type taskBillingLifecycle interface {
	MarkBillingUncertain(orderID string, errorText string) error
	RefundBilling(orderID string, errorText string) error
	BillingFailureRequiresReview(orderID string, taskID string, err error) bool
	SettleBilling(orderID string, providerRequestID string) error
}

type taskReplayLifecycle interface {
	finalizeTaskTextReplay(taskID string, status model.TaskStatus) error
}

type taskSessionLifecycle interface {
	markSessionFailed(task model.Task, message string) error
}

type taskLifecycleLogger interface {
	log(userID string, taskID string, level string, message string, payload string) error
}

type taskOutputLifecycle interface {
	RegisterTaskOutputFromTask(task model.Task) error
}

func newTaskTerminalCoordinator(s *Service) *taskTerminalCoordinator {
	return &taskTerminalCoordinator{
		repo:              s.repo,
		billing:           s.taskBilling(),
		replay:            s,
		sessions:          s,
		logger:            s,
		outputs:           s,
		userFacingMessage: s.UserFacingErrorMessage,
	}
}

func (s *Service) terminalCoordinator() *taskTerminalCoordinator {
	if s.taskTerminalCoordinator != nil {
		return s.taskTerminalCoordinator
	}
	// 部分单元测试直接构造 Service 字面量；延迟创建保持这些测试和内部工具兼容。
	return newTaskTerminalCoordinator(s)
}

func (c *taskTerminalCoordinator) markPreparationFailure(task *model.Task, stage string, err error, billingUncertain bool, refundReason string) error {
	task.Status = model.TaskStatusFailed
	task.Stage = stage
	task.Error = c.userFacingMessage(err)
	if terminalErr := c.markTerminalState(task); terminalErr != nil {
		return errors.Join(err, terminalErr)
	}
	var billingErr error
	if billingUncertain {
		billingErr = c.billing.MarkBillingUncertain(task.BillingOrderID, task.Error)
	} else {
		billingErr = c.billing.RefundBilling(task.BillingOrderID, refundReason)
	}
	if billingErr != nil {
		return errors.Join(err, fmt.Errorf("任务计费收尾失败：%w", billingErr))
	}
	return err
}

// handleExecutionFailure 返回 nil 仅表示取消已被正常收尾；普通失败仍返回原始错误，
// 让 worker 保留重试/监控所需的失败语义。
func (c *taskTerminalCoordinator) handleExecutionFailure(task *model.Task, err error, providerSucceeded bool, channelSlotFailedBeforeRequest bool) error {
	if errors.Is(err, context.Canceled) {
		task.Status = model.TaskStatusCancelled
		task.Stage = "任务已取消"
		task.Error = "任务已取消"
		if terminalErr := c.markTerminalState(task); terminalErr != nil {
			return terminalErr
		}
		var billingErr error
		if channelSlotFailedBeforeRequest {
			billingErr = c.billing.RefundBilling(task.BillingOrderID, "等待渠道槽位期间取消，上游请求未发出")
		} else {
			billingErr = c.billing.MarkBillingUncertain(task.BillingOrderID, "任务取消时上游费用状态不明确")
		}
		sessionErr := c.sessions.markSessionFailed(*task, "会话任务已取消。")
		c.finalizeReplay(task, model.TaskStatusCancelled, "文本回放草稿归并失败")
		_ = c.logger.log(task.UserID, task.ID, "warn", "任务已取消", "")
		var resultErr error
		if billingErr != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("任务取消后的计费收尾失败：%w", billingErr))
		}
		if sessionErr != nil {
			resultErr = errors.Join(resultErr, fmt.Errorf("任务取消后的会话状态更新失败：%w", sessionErr))
		}
		return resultErr
	}

	task.Status = model.TaskStatusFailed
	task.Stage = "任务失败"
	task.Error = c.userFacingMessage(err)
	if terminalErr := c.markTerminalState(task); terminalErr != nil {
		return errors.Join(err, terminalErr)
	}
	c.finalizeReplay(task, model.TaskStatusFailed, "文本回放草稿归并失败")
	var billingErr error
	if providerSucceeded || (!channelSlotFailedBeforeRequest && c.billing.BillingFailureRequiresReview(task.BillingOrderID, task.ID, err)) {
		billingErr = c.billing.MarkBillingUncertain(task.BillingOrderID, task.Error)
	} else {
		billingErr = c.billing.RefundBilling(task.BillingOrderID, task.Error)
	}
	sessionErr := c.sessions.markSessionFailed(*task, task.Error)
	_ = c.logger.log(task.UserID, task.ID, "error", "任务处理失败", task.Error)
	resultErr := err
	if billingErr != nil {
		resultErr = errors.Join(resultErr, fmt.Errorf("任务计费收尾失败：%w", billingErr))
	}
	if sessionErr != nil {
		resultErr = errors.Join(resultErr, fmt.Errorf("任务失败后的会话状态更新失败：%w", sessionErr))
	}
	return resultErr
}

func (c *taskTerminalCoordinator) handleCancelledResult(task model.Task) error {
	c.finalizeReplay(&task, model.TaskStatusCancelled, "文本回放草稿归并失败")
	billingErr := c.billing.MarkBillingUncertain(task.BillingOrderID, "上游已返回结果，但任务被取消")
	sessionErr := c.sessions.markSessionFailed(task, "会话任务已取消。")
	_ = c.logger.log(task.UserID, task.ID, "warn", "任务已取消，丢弃生成结果", "")
	var resultErr error
	if billingErr != nil {
		resultErr = errors.Join(resultErr, fmt.Errorf("丢弃已生成结果后的计费收尾失败：%w", billingErr))
	}
	if sessionErr != nil {
		resultErr = errors.Join(resultErr, fmt.Errorf("丢弃已生成结果后的会话状态更新失败：%w", sessionErr))
	}
	return resultErr
}

// handleResultPersistenceFailure 处理“上游成功但本地结果保存失败”的收尾。
// 返回 handled=true 表示并发取消已被识别并正常收尾，调用方不应再返回保存错误。
func (c *taskTerminalCoordinator) handleResultPersistenceFailure(task *model.Task, saveErr error) (handled bool, err error) {
	if errors.Is(saveErr, repository.ErrTaskStateConflict) {
		latest, latestErr := c.repo.Task(task.ID)
		if latestErr == nil && latest.Status == model.TaskStatusCancelled {
			if billingErr := c.handleCancelledResult(*latest); billingErr != nil {
				return true, billingErr
			}
			return true, nil
		}
	}

	task.Status = model.TaskStatusFailed
	task.Stage = "任务结果保存失败"
	task.Error = c.userFacingMessage(saveErr)
	if terminalErr := c.markTerminalState(task); terminalErr != nil {
		return false, errors.Join(saveErr, terminalErr)
	}
	c.finalizeReplay(task, model.TaskStatusFailed, "文本回放草稿归并失败")
	billingErr := c.billing.MarkBillingUncertain(task.BillingOrderID, "上游已成功但任务结果未保存："+task.Error)
	sessionErr := c.sessions.markSessionFailed(*task, task.Error)
	_ = c.logger.log(task.UserID, task.ID, "error", "任务结果保存失败", task.Error)
	resultErr := saveErr
	if billingErr != nil {
		resultErr = errors.Join(resultErr, fmt.Errorf("任务结果保存失败后的计费收尾失败：%w", billingErr))
	}
	if sessionErr != nil {
		resultErr = errors.Join(resultErr, fmt.Errorf("任务结果保存失败后的会话状态更新失败：%w", sessionErr))
	}
	return false, resultErr
}

func (c *taskTerminalCoordinator) handleSuccess(task *model.Task) error {
	c.finalizeReplay(task, model.TaskStatusSucceeded, "文本回放窗口更新失败")
	var completionErr error
	completedTask, fetchErr := c.repo.Task(task.ID)
	if fetchErr != nil {
		completionErr = fmt.Errorf("任务成功后读取任务产物失败：%w", fetchErr)
		_ = c.logger.log(task.UserID, task.ID, "error", "任务成功但读取任务产物失败", fetchErr.Error())
	} else {
		if registerErr := c.outputs.RegisterTaskOutputFromTask(*completedTask); registerErr != nil {
			// 任务成功与产物登记分开记账；登记失败保持步骤异常，允许项目页幂等补登记。
			_ = c.logger.log(task.UserID, task.ID, "error", "任务成功但项目产物登记失败", registerErr.Error())
			completionErr = fmt.Errorf("任务成功后的项目产物登记失败：%w", registerErr)
		}
	}
	if err := c.billing.SettleBilling(task.BillingOrderID, ""); err != nil {
		uncertainErr := c.billing.MarkBillingUncertain(task.BillingOrderID, "生成成功但积分结算失败："+err.Error())
		_ = c.logger.log(task.UserID, task.ID, "error", "积分结算失败，已进入待核对", err.Error())
		completionErr = errors.Join(completionErr, fmt.Errorf("积分结算失败：%w", err))
		if uncertainErr != nil {
			completionErr = errors.Join(completionErr, fmt.Errorf("记录计费待核对状态失败：%w", uncertainErr))
		}
	}
	_ = c.logger.log(task.UserID, task.ID, "info", "任务完成，结果已持久化", "")
	return completionErr
}

func (c *taskTerminalCoordinator) markTerminalState(task *model.Task) error {
	completedAt := time.Now()
	task.CompletedAt = &completedAt
	if _, err := c.repo.UpdateTaskTerminalState(task.ID, model.TaskStatusRunning, task.Status, task.Stage, task.Error, completedAt); err != nil {
		return fmt.Errorf("写入任务终态失败：%w", err)
	}
	return nil
}

func (c *taskTerminalCoordinator) finalizeReplay(task *model.Task, status model.TaskStatus, message string) {
	if err := c.replay.finalizeTaskTextReplay(task.ID, status); err != nil {
		_ = c.logger.log(task.UserID, task.ID, "error", message, err.Error())
	}
}
