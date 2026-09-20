package app

import (
	"errors"
	"testing"

	"infinite-canvas/backend/internal/platform"
)

func TestTaskWritesAreRejectedDuringDrain(t *testing.T) {
	runtime := &platform.Worker{}
	runtime.Start()
	runtime.BeginDrain()
	svc := &Service{workers: runtime}

	if _, err := svc.CreateTask("user-1", CreateTaskRequest{}); !isAppErrorStatus(err, 503) {
		t.Fatalf("CreateTask during drain error = %v, want 503", err)
	}
	if _, err := svc.RetryTask("user-1", "task-1"); !isAppErrorStatus(err, 503) {
		t.Fatalf("RetryTask during drain error = %v, want 503", err)
	}
}

func isAppErrorStatus(err error, status int) bool {
	var appErr *AppError
	return errors.As(err, &appErr) && appErr.Status == status
}
