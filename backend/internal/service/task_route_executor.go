package service

import (
	"context"

	"infinite-canvas/backend/internal/model"
)

// taskRouteExecutor 负责一次任务执行中的路由提交与失败切换策略。
// Provider 具体协议仍由 processTask 和各 provider 函数负责；这里仅管理“何时结束当前路由、何时允许换路由”。
type taskRouteExecutor struct {
	port taskRouteExecutionPort
}

type taskRouteExecutionPort interface {
	markRouteAttemptDispatching(attempt *model.RouteAttempt) error
	processTask(ctx context.Context, task model.Task) (map[string]interface{}, []map[string]interface{}, error)
	refreshTaskProviderState(task *model.Task) error
	finishTaskRouteAttempt(attempt *model.RouteAttempt, task *model.Task, taskErr error)
	nextRouteAttemptAfterFailure(task *model.Task, attempt *model.RouteAttempt, taskErr error) (*model.RouteAttempt, error)
	log(userID string, taskID string, level string, message string, payload string) error
}

type taskRouteExecutionResult struct {
	result            map[string]interface{}
	canvasOps         []map[string]interface{}
	err               error
	providerSucceeded bool
}

func newTaskRouteExecutor(s *Service) *taskRouteExecutor {
	return &taskRouteExecutor{port: s}
}

func (s *Service) routeExecutor() *taskRouteExecutor {
	if s.taskRouteExecutor != nil {
		return s.taskRouteExecutor
	}
	// 部分单元测试直接构造 Service 字面量；延迟创建保持内部测试和工具兼容。
	return newTaskRouteExecutor(s)
}

func (e *taskRouteExecutor) execute(ctx context.Context, task *model.Task, attempt *model.RouteAttempt) (taskRouteExecutionResult, error) {
	var execution taskRouteExecutionResult
	for {
		if dispatchErr := e.port.markRouteAttemptDispatching(attempt); dispatchErr != nil {
			execution.err = dispatchErr
			break
		}
		execution.result, execution.canvasOps, execution.err = e.port.processTask(ctx, *task)
		if stateErr := e.port.refreshTaskProviderState(task); stateErr != nil {
			return taskRouteExecutionResult{}, stateErr
		}
		e.port.finishTaskRouteAttempt(attempt, task, execution.err)
		if execution.err == nil {
			break
		}
		nextAttempt, routeErr := e.port.nextRouteAttemptAfterFailure(task, attempt, execution.err)
		if routeErr != nil {
			_ = e.port.log(task.UserID, task.ID, "warn", "备用路由不可用，保留原始失败", routeErr.Error())
			break
		}
		if nextAttempt == nil {
			break
		}
		// Route selection updates the persisted task in the service port. Keep the
		// in-memory task aligned as well because the next provider execution reads
		// its route from this object before it reaches the repository again.
		task.RouteID = nextAttempt.RouteID
		attempt = nextAttempt
		_ = e.port.log(task.UserID, task.ID, "warn", "上游未创建任务，切换备用能力路由", nextAttempt.RouteID)
	}
	execution.providerSucceeded = execution.err == nil
	return execution, nil
}
