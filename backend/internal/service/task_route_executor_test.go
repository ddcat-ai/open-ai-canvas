package service

import (
	"context"
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
)

type taskRouteExecutionPortStub struct {
	processCalls   []string
	dispatchCalls  []string
	finished       []string
	logs           []string
	nextAttempts   map[string]*model.RouteAttempt
	nextErrors     map[string]error
	processResults map[string]taskRouteExecutionStubResult
}

type taskRouteExecutionStubResult struct {
	result    map[string]interface{}
	canvasOps []map[string]interface{}
	err       error
}

func (p *taskRouteExecutionPortStub) markRouteAttemptDispatching(attempt *model.RouteAttempt) error {
	p.dispatchCalls = append(p.dispatchCalls, attempt.RouteID)
	return nil
}

func (p *taskRouteExecutionPortStub) processTask(_ context.Context, task model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	routeID := task.RouteID
	p.processCalls = append(p.processCalls, routeID)
	result := p.processResults[routeID]
	return result.result, result.canvasOps, result.err
}

func (p *taskRouteExecutionPortStub) refreshTaskProviderState(*model.Task) error {
	return nil
}

func (p *taskRouteExecutionPortStub) finishTaskRouteAttempt(attempt *model.RouteAttempt, _ *model.Task, taskErr error) {
	if taskErr == nil {
		p.finished = append(p.finished, attempt.RouteID+":succeeded")
		return
	}
	p.finished = append(p.finished, attempt.RouteID+":failed")
}

func (p *taskRouteExecutionPortStub) nextRouteAttemptAfterFailure(_ *model.Task, attempt *model.RouteAttempt, _ error) (*model.RouteAttempt, error) {
	if err := p.nextErrors[attempt.RouteID]; err != nil {
		return nil, err
	}
	return p.nextAttempts[attempt.RouteID], nil
}

func (p *taskRouteExecutionPortStub) log(_ string, _ string, _ string, message string, payload string) error {
	p.logs = append(p.logs, message+":"+payload)
	return nil
}

func TestTaskRouteExecutorSwitchesOnlyWhenNextRouteIsAvailable(t *testing.T) {
	first := &model.RouteAttempt{RouteID: "route-a"}
	second := &model.RouteAttempt{RouteID: "route-b"}
	p := &taskRouteExecutionPortStub{
		nextAttempts: map[string]*model.RouteAttempt{"route-a": second},
		nextErrors:   map[string]error{},
		processResults: map[string]taskRouteExecutionStubResult{
			"route-a": {err: errors.New("rejected before job")},
			"route-b": {result: map[string]interface{}{"ok": true}, canvasOps: []map[string]interface{}{{"type": "add_node"}}},
		},
	}
	task := &model.Task{ID: "task-1", UserID: "user-1", RouteID: "route-a"}

	result, err := (&taskRouteExecutor{port: p}).execute(context.Background(), task, first)
	if err != nil {
		t.Fatalf("execute() error = %v", err)
	}
	if !result.providerSucceeded || result.err != nil {
		t.Fatalf("unexpected execution result: %+v", result)
	}
	if len(p.processCalls) != 2 || p.processCalls[0] != "route-a" || p.processCalls[1] != "route-b" {
		t.Fatalf("process calls = %v, want route-a then route-b", p.processCalls)
	}
	if len(p.finished) != 2 || p.finished[0] != "route-a:failed" || p.finished[1] != "route-b:succeeded" {
		t.Fatalf("finished attempts = %v", p.finished)
	}
	if len(p.logs) != 1 || p.logs[0] != "上游未创建任务，切换备用能力路由:route-b" {
		t.Fatalf("route switch logs = %v", p.logs)
	}
}

func TestTaskRouteExecutorStopsWhenRouteSwitchFails(t *testing.T) {
	first := &model.RouteAttempt{RouteID: "route-a"}
	routeError := errors.New("no usable fallback")
	p := &taskRouteExecutionPortStub{
		nextAttempts: map[string]*model.RouteAttempt{},
		nextErrors:   map[string]error{"route-a": routeError},
		processResults: map[string]taskRouteExecutionStubResult{
			"route-a": {err: errors.New("rejected before job")},
		},
	}
	task := &model.Task{ID: "task-1", UserID: "user-1", RouteID: "route-a"}

	result, err := (&taskRouteExecutor{port: p}).execute(context.Background(), task, first)
	if err != nil {
		t.Fatalf("execute() error = %v", err)
	}
	if result.providerSucceeded || !errors.Is(result.err, p.processResults["route-a"].err) {
		t.Fatalf("unexpected execution result: %+v", result)
	}
	if len(p.processCalls) != 1 || len(p.finished) != 1 || len(p.logs) != 1 {
		t.Fatalf("expected one failed route and one warning, calls=%v finished=%v logs=%v", p.processCalls, p.finished, p.logs)
	}
}
