package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

type taskTerminalRepositoryStub struct {
	task          *model.Task
	taskError     error
	terminalCalls int
	terminalError error
}

func (r *taskTerminalRepositoryStub) Task(string) (*model.Task, error) {
	if r.taskError != nil {
		return nil, r.taskError
	}
	if r.task == nil {
		return nil, errors.New("task not found")
	}
	copy := *r.task
	return &copy, nil
}

func (r *taskTerminalRepositoryStub) UpdateTaskTerminalState(_ string, _ model.TaskStatus, status model.TaskStatus, stage string, errorText string, completedAt time.Time) (bool, error) {
	r.terminalCalls++
	if r.terminalError != nil {
		return false, r.terminalError
	}
	if r.task != nil {
		r.task.Status = status
		r.task.Stage = stage
		r.task.Error = errorText
		r.task.CompletedAt = &completedAt
	}
	return true, nil
}

type taskTerminalBillingStub struct {
	uncertain      []string
	refund         []string
	settleCalls    int
	review         bool
	settleError    error
	uncertainError error
	refundError    error
}

func (b *taskTerminalBillingStub) MarkBillingUncertain(_ string, reason string) error {
	b.uncertain = append(b.uncertain, reason)
	return b.uncertainError
}

func (b *taskTerminalBillingStub) RefundBilling(_ string, reason string) error {
	b.refund = append(b.refund, reason)
	return b.refundError
}

func (b *taskTerminalBillingStub) BillingFailureRequiresReview(string, string, error) bool {
	return b.review
}

func (b *taskTerminalBillingStub) SettleBilling(string, string) error {
	b.settleCalls++
	return b.settleError
}

type taskTerminalReplayStub struct {
	statuses []model.TaskStatus
}

func (r *taskTerminalReplayStub) finalizeTaskTextReplay(_ string, status model.TaskStatus) error {
	r.statuses = append(r.statuses, status)
	return nil
}

type taskTerminalSessionStub struct {
	messages []string
	err      error
}

func (s *taskTerminalSessionStub) markSessionFailed(_ model.Task, message string) error {
	s.messages = append(s.messages, message)
	return s.err
}

type taskTerminalLoggerStub struct {
	messages []string
}

func (l *taskTerminalLoggerStub) log(_ string, _ string, _ string, message string, _ string) error {
	l.messages = append(l.messages, message)
	return nil
}

type taskTerminalOutputStub struct {
	calls int
	err   error
}

func (o *taskTerminalOutputStub) RegisterTaskOutputFromTask(model.Task) error {
	o.calls++
	return o.err
}

func newTaskTerminalCoordinatorForTest(repo taskTerminalRepository, billing *taskTerminalBillingStub, replay *taskTerminalReplayStub, sessions *taskTerminalSessionStub, logger *taskTerminalLoggerStub, outputs *taskTerminalOutputStub) *taskTerminalCoordinator {
	return &taskTerminalCoordinator{
		repo:              repo,
		billing:           billing,
		replay:            replay,
		sessions:          sessions,
		logger:            logger,
		outputs:           outputs,
		userFacingMessage: func(err error) string { return "public: " + err.Error() },
	}
}

func TestTaskTerminalCoordinatorHandlesCancellation(t *testing.T) {
	task := &model.Task{ID: "task-1", UserID: "user-1", BillingOrderID: "order-1", SessionID: "session-1"}
	repo := &taskTerminalRepositoryStub{task: task}
	billing := &taskTerminalBillingStub{}
	replay := &taskTerminalReplayStub{}
	sessions := &taskTerminalSessionStub{}
	logger := &taskTerminalLoggerStub{}
	coordinator := newTaskTerminalCoordinatorForTest(repo, billing, replay, sessions, logger, &taskTerminalOutputStub{})

	if err := coordinator.handleExecutionFailure(task, context.Canceled, false, false); err != nil {
		t.Fatalf("handleExecutionFailure() error = %v", err)
	}
	if task.Status != model.TaskStatusCancelled || task.Error != "任务已取消" {
		t.Fatalf("unexpected cancelled task state: status=%s error=%q", task.Status, task.Error)
	}
	if len(billing.uncertain) != 1 || len(billing.refund) != 0 {
		t.Fatalf("unexpected billing actions: uncertain=%v refund=%v", billing.uncertain, billing.refund)
	}
	if len(replay.statuses) != 1 || replay.statuses[0] != model.TaskStatusCancelled {
		t.Fatalf("unexpected replay statuses: %v", replay.statuses)
	}
	if len(sessions.messages) != 1 || len(logger.messages) != 1 || repo.terminalCalls != 1 {
		t.Fatalf("expected cancellation side effects, replay=%v session=%v logs=%v terminalCalls=%d", replay.statuses, sessions.messages, logger.messages, repo.terminalCalls)
	}
}

func TestTaskTerminalCoordinatorRefundsFailureBeforeProviderRequest(t *testing.T) {
	task := &model.Task{ID: "task-1", UserID: "user-1", BillingOrderID: "order-1", SessionID: "session-1"}
	repo := &taskTerminalRepositoryStub{task: task}
	billing := &taskTerminalBillingStub{}
	replay := &taskTerminalReplayStub{}
	sessions := &taskTerminalSessionStub{}
	logger := &taskTerminalLoggerStub{}
	coordinator := newTaskTerminalCoordinatorForTest(repo, billing, replay, sessions, logger, &taskTerminalOutputStub{})
	failure := errors.New("provider unavailable")

	if err := coordinator.handleExecutionFailure(task, failure, false, true); !errors.Is(err, failure) {
		t.Fatalf("handleExecutionFailure() error = %v, want %v", err, failure)
	}
	if task.Status != model.TaskStatusFailed || task.Error != "public: provider unavailable" {
		t.Fatalf("unexpected failed task state: status=%s error=%q", task.Status, task.Error)
	}
	if len(billing.refund) != 1 || len(billing.uncertain) != 0 {
		t.Fatalf("unexpected billing actions: uncertain=%v refund=%v", billing.uncertain, billing.refund)
	}
	if len(replay.statuses) != 1 || replay.statuses[0] != model.TaskStatusFailed {
		t.Fatalf("unexpected replay statuses: %v", replay.statuses)
	}
}

func TestTaskTerminalCoordinatorLogsUnrecordedProviderFailure(t *testing.T) {
	task := &model.Task{ID: "task-1", UserID: "user-1", BillingOrderID: "order-1"}
	coordinator := newTaskTerminalCoordinatorForTest(
		&taskTerminalRepositoryStub{task: task},
		&taskTerminalBillingStub{},
		&taskTerminalReplayStub{},
		&taskTerminalSessionStub{},
		&taskTerminalLoggerStub{},
		&taskTerminalOutputStub{},
	)
	var loggedTask model.Task
	var loggedErr error
	coordinator.logFailedAttempt = func(value model.Task, err error) {
		loggedTask = value
		loggedErr = err
	}
	failure := errors.New("provider preflight failed")

	if err := coordinator.handleExecutionFailure(task, failure, false, true); !errors.Is(err, failure) {
		t.Fatalf("handleExecutionFailure() error = %v, want %v", err, failure)
	}
	if loggedTask.ID != task.ID || !errors.Is(loggedErr, failure) {
		t.Fatalf("logged failure = task:%#v error:%v", loggedTask, loggedErr)
	}
}

func TestTaskTerminalCoordinatorReturnsTerminalStateWriteError(t *testing.T) {
	task := &model.Task{ID: "task-1", UserID: "user-1", BillingOrderID: "order-1"}
	terminalError := errors.New("database unavailable")
	repo := &taskTerminalRepositoryStub{task: task, terminalError: terminalError}
	coordinator := newTaskTerminalCoordinatorForTest(
		repo,
		&taskTerminalBillingStub{},
		&taskTerminalReplayStub{},
		&taskTerminalSessionStub{},
		&taskTerminalLoggerStub{},
		&taskTerminalOutputStub{},
	)

	providerError := errors.New("provider unavailable")
	if err := coordinator.handleExecutionFailure(task, providerError, false, true); !errors.Is(err, providerError) || !errors.Is(err, terminalError) {
		t.Fatalf("handleExecutionFailure() error = %v, want provider and terminal errors", err)
	}
}

func TestTaskTerminalCoordinatorReturnsBillingRefundError(t *testing.T) {
	task := &model.Task{ID: "task-1", UserID: "user-1", BillingOrderID: "order-1"}
	billingError := errors.New("billing database unavailable")
	billing := &taskTerminalBillingStub{refundError: billingError}
	coordinator := newTaskTerminalCoordinatorForTest(
		&taskTerminalRepositoryStub{task: task},
		billing,
		&taskTerminalReplayStub{},
		&taskTerminalSessionStub{},
		&taskTerminalLoggerStub{},
		&taskTerminalOutputStub{},
	)

	providerError := errors.New("provider unavailable")
	if err := coordinator.handleExecutionFailure(task, providerError, false, true); !errors.Is(err, providerError) || !errors.Is(err, billingError) {
		t.Fatalf("handleExecutionFailure() error = %v, want provider and billing errors", err)
	}
}

func TestTaskTerminalCoordinatorReturnsSessionProjectionError(t *testing.T) {
	task := &model.Task{ID: "task-1", UserID: "user-1", BillingOrderID: "order-1", SessionID: "session-1"}
	sessionError := errors.New("session database unavailable")
	coordinator := newTaskTerminalCoordinatorForTest(
		&taskTerminalRepositoryStub{task: task},
		&taskTerminalBillingStub{},
		&taskTerminalReplayStub{},
		&taskTerminalSessionStub{err: sessionError},
		&taskTerminalLoggerStub{},
		&taskTerminalOutputStub{},
	)

	providerError := errors.New("provider unavailable")
	if err := coordinator.handleExecutionFailure(task, providerError, false, true); !errors.Is(err, providerError) || !errors.Is(err, sessionError) {
		t.Fatalf("handleExecutionFailure() error = %v, want provider and session errors", err)
	}
}

func TestTaskTerminalCoordinatorReturnsOutputRegistrationErrorAfterSuccess(t *testing.T) {
	task := &model.Task{ID: "task-1", UserID: "user-1", BillingOrderID: "order-1"}
	outputError := errors.New("project output unavailable")
	outputs := &taskTerminalOutputStub{err: outputError}
	billing := &taskTerminalBillingStub{}
	coordinator := newTaskTerminalCoordinatorForTest(
		&taskTerminalRepositoryStub{task: task},
		billing,
		&taskTerminalReplayStub{},
		&taskTerminalSessionStub{},
		&taskTerminalLoggerStub{},
		outputs,
	)

	if err := coordinator.handleSuccess(task); !errors.Is(err, outputError) {
		t.Fatalf("handleSuccess() error = %v, want %v", err, outputError)
	}
	if outputs.calls != 1 || billing.settleCalls != 1 {
		t.Fatalf("expected output registration and billing settlement, calls=%d settle=%d", outputs.calls, billing.settleCalls)
	}
}

func TestTaskTerminalCoordinatorReturnsTaskReadErrorAfterSuccess(t *testing.T) {
	task := &model.Task{ID: "task-1", UserID: "user-1", BillingOrderID: "order-1"}
	taskError := errors.New("task database unavailable")
	billing := &taskTerminalBillingStub{}
	coordinator := newTaskTerminalCoordinatorForTest(
		&taskTerminalRepositoryStub{taskError: taskError},
		billing,
		&taskTerminalReplayStub{},
		&taskTerminalSessionStub{},
		&taskTerminalLoggerStub{},
		&taskTerminalOutputStub{},
	)

	if err := coordinator.handleSuccess(task); !errors.Is(err, taskError) {
		t.Fatalf("handleSuccess() error = %v, want %v", err, taskError)
	}
	if billing.settleCalls != 1 {
		t.Fatalf("billing settlement calls = %d, want 1", billing.settleCalls)
	}
}
