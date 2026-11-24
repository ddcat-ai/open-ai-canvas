package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"
	"syscall"
	"testing"

	"yingce/backend/internal/model"
)

func TestAgentFailureUsesBusinessCodeInsteadOfMessage(t *testing.T) {
	for _, tc := range []struct {
		name, code, message string
		status              int
		want                bool
	}{
		{"unknown code with transient words", "unknown_vendor_code", "api_error timeout connection reset", 200, false},
		{"no code with transient words", "", "api_error", 200, false},
		{"code substring", "not_api_error", "", 200, false},
		{"known transient with misleading text", "api_error", "authentication safety invalid_request", 200, true},
		{"permanent http wins", "api_error", "", 400, false},
		{"known permanent", "authentication", "api_error", 200, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			call := model.ApiCallLog{Status: model.ApiCallStatusFailed, StatusCode: tc.status, ErrorCode: tc.code, Error: tc.message}
			if got := cloudAgentTransientModelFailure(call); got != tc.want {
				t.Fatalf("transient = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestAgentFailurePersistsWrappedTimeoutWithoutProviderDetails(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	cause := fmt.Errorf("wrapped: %w", &url.Error{Op: "Post", URL: "https://private.invalid?token=private-sentinel", Err: context.DeadlineExceeded})
	task := &model.Task{ID: "typed-timeout", UserID: "user", Operation: cloudAgentStepOperation, Status: model.TaskStatusFailed, Error: "可展示的失败说明"}
	recordTaskDiagnostic(task, "execution", "provider_execution_failed", "unknown", "reconcile_submission", cause)
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	// Reload through a new repository read; only serialized diagnostic facts survive.
	stored, err := s.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	diagnostic := taskExecutionDiagnostic(stored)
	if diagnostic == nil || diagnostic.Code != "model_request_timeout" || diagnostic.SubmissionOutcome != "unknown" || diagnostic.RetryClass != "reconcile_submission" {
		t.Fatalf("persisted failure = %+v", diagnostic)
	}
	message, reason := cloudAgentModelFailure(stored)
	if reason != "model_request_timeout" || !strings.Contains(message, "模型请求超时") {
		t.Fatalf("failure = %q %q", message, reason)
	}
	raw, _ := json.Marshal(diagnostic)
	if strings.Contains(string(raw)+message, "private") {
		t.Fatal("raw provider details leaked")
	}
}

func TestAgentFailureDoesNotInferLocalReasonsFromDisplayText(t *testing.T) {
	task := &model.Task{Status: model.TaskStatusFailed, Error: "没有返回内容 / " + cloudAgentStepTimeoutError + " / 工具参数不是完整 JSON / timeout"}
	if cloudAgentEmptyModelOutput(task) || cloudAgentStepTimedOut(task) || cloudAgentTruncatedToolArguments(task) {
		t.Fatal("display text was interpreted as a local recovery reason")
	}
	_, reason := cloudAgentModelFailure(task)
	if reason != "model_task_failed" {
		t.Fatalf("display text changed failure reason to %q", reason)
	}
}

func TestAgentFailureTypedSourcesAndBillingSemantics(t *testing.T) {
	for _, tc := range []struct {
		name   string
		cause  error
		reason agentModelFailureReason
	}{
		{"deadline", context.DeadlineExceeded, agentModelFailureTimeout},
		{"cancelled", context.Canceled, agentModelFailureCancelled},
		{"reset", syscall.ECONNRESET, agentModelFailureReset},
		{"refused", syscall.ECONNREFUSED, agentModelFailureRefused},
		{"eof", io.EOF, agentModelFailureEOF},
		{"unexpected eof", io.ErrUnexpectedEOF, agentModelFailureEOF},
		{"dns", &net.DNSError{Name: "private.invalid", Err: "resolver failed", IsTimeout: true}, agentModelFailureDNS},
		{"uncertain dispatch", routeDispatchUncertainError{"dispatch state unavailable"}, agentModelFailureSubmission},
		{"unknown words", errors.New("timeout connection reset api_error"), agentModelFailureUnknown},
		{"unknown provider code", providerPayloadError{raw: `{"error":{"code":"vendor_other","message":"api_error timeout"}}`, message: "失败"}, agentModelFailureUnknown},
		{"known provider code", providerPayloadError{raw: `{"error":{"code":"api_error","message":"authentication"}}`, message: "失败"}, agentModelFailureTransient},
		{"http permanent", providerHTTPError{StatusCode: 400, Body: `{"error":{"code":"api_error"}}`}, agentModelFailurePermanent},
		{"http transient", providerHTTPError{StatusCode: 503, Body: `{"error":{"code":"authentication"}}`}, agentModelFailureTransient},
	} {
		t.Run(tc.name, func(t *testing.T) {
			wrapped := fmt.Errorf("wrapper: %w", tc.cause)
			if got := agentModelErrorReason(wrapped); got != tc.reason {
				t.Fatalf("reason = %q, want %q", got, tc.reason)
			}
			typed := agentModelFailure(tc.reason, wrapped)
			if !errors.Is(typed, tc.cause) || typed.Error() != wrapped.Error() {
				t.Fatal("original error chain or text lost")
			}
			if billingFailureUncertain(typed) != billingFailureUncertain(wrapped) {
				t.Fatal("typing changed upstream billing classification")
			}
		})
	}
}

func TestAgentFailurePreparationKeepsInputCorrectionDistinctFromUncertainSubmission(t *testing.T) {
	task := &model.Task{ID: "model-step", Operation: cloudAgentStepOperation, Status: model.TaskStatusFailed}
	recordTaskDiagnostic(task, "preparation", "preparation_failed", "not_submitted", "correct_input", BadAuthRequest("请修正参数"))
	if agentModelTaskReason(task) == agentModelFailureSubmission || taskExecutionDiagnostic(task).RetryClass != "correct_input" {
		t.Fatalf("unsubmitted input lost its correction class: %s", task.ExecutionDiagnosticJSON)
	}
	recordTaskDiagnostic(task, "preparation", "preparation_failed", "unknown", "reconcile_submission", nil)
	if got := agentModelTaskReason(task); got != agentModelFailureSubmission {
		t.Fatalf("uncertain preparation reason = %s", got)
	}
}

func TestAgentFailureParserReasonsSurvivePersistenceAndWait(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	// 流已正常结束（收到结束标记）但没有内容，才是空输出；未结束的流属于中断。
	emptyParser := newStreamingAgentParser("chat-completion", nil)
	emptyParser.terminal = true
	_, empty := emptyParser.result()
	_, claudeEmpty := parseAgentToolPayload(map[string]interface{}{"content": []interface{}{}}, "claude-api")
	parser := newStreamingAgentParser("chat-completion", nil)
	parser.setToolCall(0, "call", "", "test", "{invalid")
	parser.terminal = true
	_, arguments := parser.result()
	for i, tc := range []struct {
		cause  error
		reason agentModelFailureReason
	}{
		{empty, agentModelFailureEmpty}, {claudeEmpty, agentModelFailureEmpty}, {arguments, agentModelFailureArguments},
		{agentModelFailure(agentModelFailureStepTimeout, errors.New("new step timeout wording")), agentModelFailureStepTimeout},
	} {
		if tc.cause == nil {
			t.Fatal("expected parser failure")
		}
		task := &model.Task{ID: fmt.Sprintf("local-%d", i), UserID: "user", Operation: cloudAgentStepOperation, Status: model.TaskStatusFailed, Error: "重新措辞的失败说明"}
		recordTaskDiagnostic(task, "execution", "provider_execution_failed", "unknown", "reconcile_submission", tc.cause)
		if err := db.Create(task).Error; err != nil {
			t.Fatal(err)
		}
		stored, err := s.repo.Task(task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got := agentModelTaskReason(stored); got != tc.reason {
			t.Fatalf("stored reason = %q, want %q", got, tc.reason)
		}
		_, waitErr := s.waitCloudAgentTask(context.Background(), task.ID)
		if got := agentModelErrorReason(waitErr); got != tc.reason {
			t.Fatalf("wait reason = %q, want %q", got, tc.reason)
		}
		if cloudAgentEmptyModelOutput(stored) != (tc.reason == agentModelFailureEmpty) || cloudAgentStepTimedOut(stored) != (tc.reason == agentModelFailureStepTimeout) || cloudAgentTruncatedToolArguments(stored) != (tc.reason == agentModelFailureArguments) {
			t.Fatal("local recovery lost its reason after reload")
		}
	}
}

func TestAgentFailureRetryKeepsHTTPPolicyAndRejectsMessageHints(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	for i, tc := range []struct {
		status int
		code   string
		reason agentModelFailureReason
		want   bool
	}{
		{200, "vendor_unknown", agentModelFailureUnknown, false},
		{200, "api_error", agentModelFailureTransient, true},
		{400, "api_error", agentModelFailurePermanent, false},
		{401, "authentication", agentModelFailurePermanent, false},
		{408, "", agentModelFailureTimeout, true},
		{429, "", agentModelFailureTransient, true},
		{503, "authentication", agentModelFailureTransient, true},
		{0, "", agentModelFailureTimeout, true},
		{0, "", agentModelFailureReset, true},
		{0, "", agentModelFailureRefused, true},
		{0, "", agentModelFailureEOF, true},
		{0, "", agentModelFailureUnknown, false},
	} {
		task := &model.Task{ID: fmt.Sprintf("retry-%d", i), UserID: "user", Status: model.TaskStatusFailed, Error: "api_error timeout connection eof", ExecutionDiagnosticJSON: `{"code":"` + string(tc.reason) + `"}`}
		if err := db.Create(task).Error; err != nil {
			t.Fatal(err)
		}
		call := &model.ApiCallLog{ID: fmt.Sprintf("call-%d", i), TaskID: task.ID, Status: model.ApiCallStatusFailed, StatusCode: tc.status, ErrorCode: tc.code, Error: task.Error}
		if err := db.Create(call).Error; err != nil {
			t.Fatal(err)
		}
		if got := s.cloudAgentModelTaskRetryable(task.ID); got != tc.want {
			t.Fatalf("case %d: retryable = %v, want %v", i, got, tc.want)
		}
	}
}
