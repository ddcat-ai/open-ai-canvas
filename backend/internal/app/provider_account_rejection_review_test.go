package app

import (
	"fmt"
	"testing"

	"yingce/backend/internal/model"
)

func TestAccountPoolRejectionDoesNotTrustLossyPersistedMessage(t *testing.T) {
	for _, tc := range []struct {
		name, body string
	}{
		{"top-level receipt", `{"error":{"message":"No available compatible accounts","type":"api_error"},"task_id":"already-accepted"}`},
		{"nested receipt", `{"error":{"message":"No available compatible accounts","type":"api_error","task_id":"already-accepted"}}`},
		{"different error type", `{"error":{"message":"No available compatible accounts","type":"upstream_error"}}`},
		{"unstructured body", "No available compatible accounts"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			task := model.Task{ID: "lossy-error", UserID: "user", Type: "canvas_image", Status: model.TaskStatusFailed, RouteRun: 1, ExecutionDiagnosticJSON: `{"submissionOutcome":"unknown","retryClass":"reconcile_submission"}`}
			attempt := model.RouteAttempt{ID: "lossy-attempt", TaskID: task.ID, RouteRun: 1, Status: "dispatching", DispatchState: "submission_unknown"}
			for _, row := range []any{&task, &attempt} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			upstreamErr := providerHTTPError{StatusCode: 503, Body: tc.body}
			if providerAccountPoolRejected(upstreamErr) {
				t.Fatal("test fixture unexpectedly classified as a confirmed rejection")
			}
			s.finishTaskRouteAttempt(&attempt, &task, upstreamErr)
			got, err := s.Task("user", task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Diagnostic == nil || got.Diagnostic.SubmissionOutcome != "unknown" {
				t.Errorf("unsafe response reclassified after formatting: attempt=%+v diagnostic=%+v", attempt, got.Diagnostic)
			}
			if _, err := s.cloudAgentMediaRetryPolicy("user", &task); err == nil {
				t.Error("unsafe response became eligible for a new paid task after formatting")
			}
		})
	}
}

func TestTaskReadReconcilesConfirmedRouteRejectionForRetry(t *testing.T) {
	for _, status := range []int{401, 403, 404, 429} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			task := model.Task{ID: "confirmed-rejection", UserID: "user", Type: "canvas_video", Status: model.TaskStatusFailed, RouteRun: 1, ExecutionDiagnosticJSON: `{"submissionOutcome":"unknown","retryClass":"reconcile_submission"}`}
			attempt := model.RouteAttempt{ID: "confirmed-attempt", TaskID: task.ID, RouteRun: 1, Status: "dispatching", DispatchState: "submission_unknown"}
			for _, row := range []any{&task, &attempt} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			s.finishTaskRouteAttempt(&attempt, &task, providerHTTPError{StatusCode: status, Body: `{"error":{"message":"request rejected","type":"api_error"}}`})
			if attempt.DispatchState != "rejected_no_job" {
				t.Fatalf("expected confirmed route rejection, got %+v", attempt)
			}
			got, err := s.Task("user", task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Diagnostic == nil || got.Diagnostic.SubmissionOutcome == "unknown" || got.Diagnostic.RetryClass == "reconcile_submission" {
				t.Fatalf("confirmed rejection remains blocked by frontend retry guard: %+v", got.Diagnostic)
			}
		})
	}
}

func TestConfirmedRouteRejectionTerminalDiagnostic(t *testing.T) {
	for _, status := range []int{401, 429} {
		for _, notSent := range []bool{false, true} {
			t.Run(fmt.Sprintf("%d/not_sent=%t", status, notSent), func(t *testing.T) {
				task := &model.Task{ID: "source", Status: model.TaskStatusRunning}
				c := newTaskTerminalCoordinatorForTest(&taskTerminalRepositoryStub{}, &taskTerminalBillingStub{}, &taskTerminalReplayStub{}, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{})
				_ = c.handleExecutionFailure(task, providerHTTPError{StatusCode: status}, false, notSent)
				want := "rejected"
				if notSent {
					want = "not_submitted"
				}
				diagnostic := taskExecutionDiagnostic(task)
				if diagnostic == nil || diagnostic.SubmissionOutcome != want || diagnostic.RetryClass == "reconcile_submission" {
					t.Fatalf("diagnostic=%+v want outcome %s", diagnostic, want)
				}
			})
		}
	}
}

func TestTaskReadReconcilesOnlyConfirmedMachineDispatchStates(t *testing.T) {
	for _, tc := range []struct {
		name, state, status, providerID, want string
	}{
		{"selected before send", "not_sent", "selected", "", "not_submitted"},
		{"failed before send", "not_sent", "failed", "", "not_submitted"},
		{"dispatching contradicts not sent", "not_sent", "dispatching", "", "unknown"},
		{"rejected but not terminal", "rejected_no_job", "dispatching", "", "unknown"},
		{"rejected with provider receipt", "rejected_no_job", "failed", "accepted", "unknown"},
		{"unknown attempt", "submission_unknown", "failed", "", "unknown"},
		{"accepted attempt", "accepted", "failed", "", "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			task := model.Task{ID: "dispatch-source", UserID: "user", Type: "canvas_image", Status: model.TaskStatusFailed, RouteRun: 1, ExecutionDiagnosticJSON: `{"submissionOutcome":"unknown","retryClass":"reconcile_submission"}`}
			attempt := model.RouteAttempt{ID: "dispatch-attempt", TaskID: task.ID, RouteRun: 1, Status: tc.status, DispatchState: tc.state, ProviderRequestID: tc.providerID}
			for _, row := range []any{&task, &attempt} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			got, err := s.Task("user", task.ID)
			if err != nil || got.Diagnostic == nil || got.Diagnostic.SubmissionOutcome != tc.want {
				t.Fatalf("task=%+v err=%v want outcome %s", got, err, tc.want)
			}
		})
	}
}

func TestOrdinaryRetryHonorsUnknownDiagnosticWithAcceptedAttempt(t *testing.T) {
	for _, reuseTask := range []bool{false, true} {
		t.Run(fmt.Sprintf("reuse_task=%t", reuseTask), func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			req := retryAdmissionVideoRequest()
			original, err := s.CreateTask("user", req)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.Task{}).Where("id = ?", original.ID).Updates(map[string]any{
				"status":                    model.TaskStatusFailed,
				"execution_diagnostic_json": `{"phase":"preparation","submissionOutcome":"unknown","retryClass":"reconcile_submission"}`,
			}).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.repo.RefundBillingOrder(original.BillingOrderID, "local refund does not confirm upstream outcome"); err != nil {
				t.Fatal(err)
			}
			// A reclaimed accepted route without a recoverable provider receipt is
			// marked as an uncertain preparation failure by beginTaskRouteAttempt.
			attempt := model.RouteAttempt{ID: "accepted-attempt", TaskID: original.ID, RouteRun: original.RouteRun, Status: "succeeded", DispatchState: "accepted"}
			if err := db.Create(&attempt).Error; err != nil {
				t.Fatal(err)
			}
			if reuseTask {
				_, err = s.RetryTask("user", original.ID)
			} else {
				req.IdempotencyKey = "retry"
				req.Input["metadata"] = map[string]any{"retryOf": original.ID}
				_, err = s.CreateTask("user", req)
			}
			if err == nil {
				t.Fatal("unknown submission accepted a second paid task solely because a route attempt exists")
			}
		})
	}
}

func TestOrdinaryRetryAllowsConfirmedProviderFailure(t *testing.T) {
	for _, reuseTask := range []bool{false, true} {
		t.Run(fmt.Sprintf("reuse_task=%t", reuseTask), func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			req := retryAdmissionVideoRequest()
			original, err := s.CreateTask("user", req)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.Task{}).Where("id = ?", original.ID).Updates(map[string]any{
				"status": model.TaskStatusFailed, "provider_request_id": "terminal-provider-job",
				"execution_diagnostic_json": `{"phase":"execution","submissionOutcome":"accepted","retryClass":"new_generation_authorization","taskSubmitted":true}`,
			}).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.repo.RefundBillingOrder(original.BillingOrderID, "provider confirmed failure"); err != nil {
				t.Fatal(err)
			}
			attempt := model.RouteAttempt{ID: "failed-provider-attempt", TaskID: original.ID, RouteRun: original.RouteRun, Status: "failed", DispatchState: "accepted", ProviderRequestID: "terminal-provider-job"}
			if err := db.Create(&attempt).Error; err != nil {
				t.Fatal(err)
			}
			if reuseTask {
				_, err = s.RetryTask("user", original.ID)
			} else {
				req.IdempotencyKey = "retry"
				req.Input["metadata"] = map[string]any{"retryOf": original.ID}
				_, err = s.CreateTask("user", req)
			}
			if err != nil {
				t.Fatalf("confirmed provider failure must remain retryable: %v", err)
			}
		})
	}
}
