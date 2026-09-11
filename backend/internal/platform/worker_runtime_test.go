package platform

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestWorkerRuntimeStopsLoopsAndWaitsForTasks(t *testing.T) {
	runtime := &Worker{}
	ctx, started := runtime.Start()
	if !started {
		t.Fatal("worker runtime should start")
	}
	loopStopped := make(chan struct{})
	if !runtime.GoLoop(func(context.Context) {
		<-ctx.Done()
		close(loopStopped)
	}) {
		t.Fatal("worker loop should start")
	}
	taskRelease := make(chan struct{})
	if !runtime.GoTask(func() { <-taskRelease }) {
		t.Fatal("worker task should start")
	}

	stopCtx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := runtime.Stop(stopCtx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("stop should wait for the active task, got %v", err)
	}
	select {
	case <-loopStopped:
	case <-time.After(time.Second):
		t.Fatal("worker loop did not observe drain cancellation")
	}
	if runtime.ActiveTaskCount() != 1 {
		t.Fatalf("active task count = %d, want 1", runtime.ActiveTaskCount())
	}

	close(taskRelease)
	finalCtx, finalCancel := context.WithTimeout(context.Background(), time.Second)
	defer finalCancel()
	if err := runtime.Stop(finalCtx); err != nil {
		t.Fatal(err)
	}
	if runtime.ActiveTaskCount() != 0 {
		t.Fatalf("active task count = %d, want 0", runtime.ActiveTaskCount())
	}
	if runtime.GoTask(func() {}) {
		t.Fatal("drained runtime should reject new tasks")
	}
}
