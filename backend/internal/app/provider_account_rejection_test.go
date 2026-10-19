package app

import (
	"errors"
	"testing"

	"yingce/backend/internal/model"
)

func retryAdmissionVideoRequest() CreateTaskRequest {
	return CreateTaskRequest{
		Type: "canvas_video", Operation: "text_to_video", Prompt: "Controlled test video", Model: "seedance-test", IdempotencyKey: "initial-video",
		Input: map[string]any{
			"mode": "video", "prompt": "Controlled test video",
			"config":   map[string]any{"channelId": "channel", "model": "seedance-test", "videoSeconds": "5", "size": "16:9", "vquality": "720"},
			"metadata": map[string]any{"source": "canvas"},
		},
	}
}

func TestAccountPoolRejectionIsConfirmedWithoutBroadeningGatewayFailures(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want bool
	}{
		{"no compatible accounts", providerHTTPError{StatusCode: 503, Body: `{"error":{"message":"No available compatible accounts","type":"api_error"}}`}, true},
		{"gateway unavailable", providerHTTPError{StatusCode: 503, Body: `{"error":{"message":"service unavailable","type":"api_error"}}`}, false},
		{"gateway timeout", providerHTTPError{StatusCode: 504, Body: `{"error":{"message":"No available compatible accounts","type":"api_error"}}`}, false},
		{"receipt present", providerHTTPError{StatusCode: 503, Body: `{"error":{"message":"No available compatible accounts","type":"api_error"},"task_id":"accepted"}`}, false},
		{"nested receipt present", providerHTTPError{StatusCode: 503, Body: `{"error":{"message":"No available compatible accounts","type":"api_error","task_id":"accepted"}}`}, false},
		{"unstructured text", errors.New("No available compatible accounts"), false},
		{"unstructured body", providerHTTPError{StatusCode: 503, Body: "No available compatible accounts"}, false},
		{"different error type", providerHTTPError{StatusCode: 503, Body: `{"error":{"message":"No available compatible accounts","type":"upstream_error"}}`}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := safeRouteRejection(tc.err); got != tc.want {
				t.Fatalf("safe rejection=%v, want=%v", got, tc.want)
			}
		})
	}
}

func TestAccountPoolRejectionClosesOrdinaryAndAgentAttempts(t *testing.T) {
	for _, runID := range []string{"", "agent-run"} {
		for _, providerID := range []string{"", "already-accepted"} {
			s, _, _ := agentMediaFixture(t)
			task := &model.Task{ID: "source", UserID: "user", Type: "canvas_image", AgentRunID: runID, ProviderRequestID: providerID}
			attempt := &model.RouteAttempt{ID: "attempt", TaskID: task.ID, DispatchState: "submission_unknown"}
			if err := s.repo.Create(attempt); err != nil {
				t.Fatal(err)
			}
			s.finishTaskRouteAttempt(attempt, task, providerHTTPError{StatusCode: 503, Body: `{"error":{"message":"No available compatible accounts","type":"api_error"}}`})
			want := "rejected_no_job"
			if providerID != "" {
				want = "accepted"
			}
			if attempt.DispatchState != want {
				t.Fatalf("agent=%q provider=%q state=%s want=%s", runID, providerID, attempt.DispatchState, want)
			}
		}
	}
}

func TestPersistedFailureMessageDoesNotConfirmAgentRetrySafety(t *testing.T) {
	for _, tc := range []struct {
		name, message, providerID string
		wantErr                   bool
	}{
		{"formatted account rejection", "模型服务暂时不可用（HTTP 503）；上游：No available compatible accounts", "", true},
		{"unknown gateway", "模型服务暂时不可用（HTTP 503）", "", true},
		{"extra failure detail", "模型服务暂时不可用（HTTP 503）；上游：No available compatible accounts after dispatch", "", true},
		{"receipt present", "模型服务暂时不可用（HTTP 503）；上游：No available compatible accounts", "accepted", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			task := &model.Task{ID: "source", UserID: "user", Type: "canvas_image", Status: model.TaskStatusFailed, RouteRun: 1}
			attempt := model.RouteAttempt{ID: "attempt", TaskID: task.ID, RouteRun: 1, Status: "failed", DispatchState: "submission_unknown", ProviderRequestID: tc.providerID, FailureCode: "upstream_503", FailureMessage: tc.message}
			if err := db.Create(&attempt).Error; err != nil {
				t.Fatal(err)
			}
			policy, err := s.cloudAgentMediaRetryPolicy("user", task)
			if (err != nil) != tc.wantErr || policy.RequiresPromptChange {
				t.Fatalf("policy=%+v err=%v wantErr=%v", policy, err, tc.wantErr)
			}
		})
	}
}

func TestAccountPoolRejectionDiagnosticDoesNotRemainUnknown(t *testing.T) {
	task := &model.Task{ID: "source", Status: model.TaskStatusRunning}
	c := newTaskTerminalCoordinatorForTest(&taskTerminalRepositoryStub{}, &taskTerminalBillingStub{}, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{})
	err := providerHTTPError{StatusCode: 503, Body: `{"error":{"message":"No available compatible accounts","type":"api_error"}}`}
	_ = c.handleExecutionFailure(task, err, false, false)
	if diagnostic := taskExecutionDiagnostic(task); diagnostic == nil || diagnostic.SubmissionOutcome != "rejected" || diagnostic.RetryClass == "reconcile_submission" {
		t.Fatalf("known rejection must be available for a new authorized retry: %+v", diagnostic)
	}
}

func TestTaskReadKeepsHistoricalUnknownUntilDispatchIsConfirmed(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	task := model.Task{ID: "known-rejection", UserID: "user", Type: "canvas_image", Status: model.TaskStatusFailed, RouteRun: 1, ExecutionDiagnosticJSON: `{"submissionOutcome":"unknown","retryClass":"reconcile_submission"}`}
	attempt := model.RouteAttempt{ID: "known-attempt", TaskID: task.ID, RouteRun: 1, Status: "failed", DispatchState: "submission_unknown", FailureCode: "upstream_503", FailureMessage: "模型服务暂时不可用（HTTP 503）；上游：No available compatible accounts"}
	for _, value := range []any{&task, &attempt} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	got, err := s.Task("user", task.ID)
	if err != nil || got.Diagnostic == nil || got.Diagnostic.SubmissionOutcome != "unknown" {
		t.Fatalf("formatted error alone cannot confirm rejection: %+v %v", got, err)
	}
	if err := db.Model(&model.RouteAttempt{}).Where("id = ?", attempt.ID).Update("dispatch_state", "rejected_no_job").Error; err != nil {
		t.Fatal(err)
	}
	got, err = s.Task("user", task.ID)
	if err != nil || got.Diagnostic == nil || got.Diagnostic.SubmissionOutcome != "rejected" {
		t.Fatalf("task query failed to reconcile known rejection: %+v %v", got, err)
	}
	if err := db.Model(&model.RouteAttempt{}).Where("id = ?", attempt.ID).Update("provider_request_id", "accepted").Error; err != nil {
		t.Fatal(err)
	}
	got, err = s.Task("user", task.ID)
	if err != nil || got.Diagnostic == nil || got.Diagnostic.SubmissionOutcome != "unknown" {
		t.Fatalf("receipt must prevent reclassification: %+v %v", got, err)
	}
}

func TestOrdinaryRetryChecksDispatchEvenAfterRefund(t *testing.T) {
	for _, knownRejection := range []bool{false, true} {
		s, db, _ := agentMediaFixture(t)
		req := retryAdmissionVideoRequest()
		original, err := s.CreateTask("user", req)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.Task{}).Where("id = ?", original.ID).Updates(map[string]any{
			"status":                    model.TaskStatusFailed,
			"execution_diagnostic_json": `{"submissionOutcome":"unknown","retryClass":"reconcile_submission"}`,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := s.repo.RefundBillingOrder(original.BillingOrderID, "test refunded"); err != nil {
			t.Fatal(err)
		}
		attempt := model.RouteAttempt{ID: "attempt", TaskID: original.ID, RouteRun: original.RouteRun, Status: "failed", DispatchState: "submission_unknown", FailureCode: "upstream_503", FailureMessage: "模型服务暂时不可用（HTTP 503）；上游：No available compatible accounts"}
		if knownRejection {
			attempt.DispatchState = "rejected_no_job"
		}
		if err := db.Create(&attempt).Error; err != nil {
			t.Fatal(err)
		}
		req.IdempotencyKey = "retry"
		req.Input["metadata"] = map[string]any{"retryOf": original.ID}
		_, err = s.CreateTask("user", req)
		if (err == nil) != knownRejection {
			t.Fatalf("known=%v retry err=%v", knownRejection, err)
		}
		var count int64
		if err := db.Model(&model.Task{}).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		want := int64(1)
		if knownRejection {
			want++
		}
		if count != want {
			t.Fatalf("tasks=%d want=%d", count, want)
		}
	}
}
