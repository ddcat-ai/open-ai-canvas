package app

import (
	"encoding/json"
	"errors"
	"net"
	"net/url"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestTaskDiagnosticKeepsExecutionAndWritebackFailuresSeparate(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, tc := range []struct {
		name, outcome, storedMessage, wantError string
		status                                  model.TaskStatus
		writebackErr                            error
	}{
		{"success", "succeeded", "", "", model.TaskStatusSucceeded, nil},
		{"success stale message", "succeeded", "任务未完成，请在任务中心查看诊断", "", model.TaskStatusSucceeded, nil},
		{"writeback failed", "failed", "", "", model.TaskStatusSucceeded, BadAuthRequest("结果无法回写画布")},
		{"execution failed", "succeeded", "上游拒绝请求", "上游拒绝请求", model.TaskStatusFailed, nil},
		{"failed without detail", "succeeded", "", "任务未完成，请在任务中心查看诊断", model.TaskStatusFailed, nil},
		{"cancelled", "succeeded", "任务已取消", "任务已取消", model.TaskStatusCancelled, nil},
		{"sensitive", "succeeded", "https://private-sentinel.invalid?token=private-sentinel", "任务未完成，请在任务中心查看诊断", model.TaskStatusFailed, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			diagnostic := model.TaskExecutionDiagnostic{Code: "task_terminal", Phase: "completion", SafeMessage: tc.storedMessage}
			raw, err := json.Marshal(diagnostic)
			if err != nil {
				t.Fatal(err)
			}
			task := &model.Task{ID: tc.name, UserID: "user", ProjectID: "agent-canvas", Status: tc.status, ExecutionDiagnosticJSON: string(raw)}
			recordTaskWritebackDiagnostic(task, "node", tc.outcome, "", tc.writebackErr)
			if err := db.Create(task).Error; err != nil {
				t.Fatal(err)
			}
			call := cloudAgentCall{ID: "task-query"}
			call.Function.Name, call.Function.Arguments = "task_get", `{"taskId":"`+task.ID+`"}`
			result, err := cloudAgentReadTool(s.repo, "user", &cloudAgentRuntime{Request: agentTestRequest()}, call)
			if err != nil {
				t.Fatal(err)
			}
			facts := result.(map[string]any)
			if tc.wantError == "" {
				if _, exists := facts["error"]; exists {
					t.Fatalf("successful task contains error: %#v", facts)
				}
			} else if facts["error"] != tc.wantError {
				t.Fatalf("failure detail lost: %#v", facts)
			}
			if facts["writebackOutcome"] != tc.outcome || (tc.writebackErr != nil && facts["writebackError"] != "结果无法回写画布") {
				t.Fatalf("writeback facts lost: %#v", facts)
			}
		})
	}
}

func TestTaskDiagnosticSuccessWithoutStoredDiagnosticHasNoError(t *testing.T) {
	task := &model.Task{ID: "success", Status: model.TaskStatusSucceeded}
	recordTaskWritebackDiagnostic(task, "node", "succeeded", "", nil)
	for range 2 {
		facts := cloudAgentTaskDiagnostic(nil, task)
		if _, exists := facts["error"]; exists {
			t.Fatalf("successful writeback fabricated an error: %#v", facts)
		}
		recordTaskWritebackDiagnostic(task, "node", "succeeded", "", nil)
	}
}

func TestCloudAgentDNSDiagnosticSurvivesTransportWrapping(t *testing.T) {
	dnsCause := &net.DNSError{Err: "private-sentinel resolver failure", Name: "private-sentinel.invalid", IsTimeout: true}
	dnsErr := WrapAppError(CodeBadGateway, "外部服务域名解析失败，请检查渠道域名和后端 DNS 配置", dnsCause)
	dnsErr.Reason = ReasonUpstreamDNSFailed
	transportErr := &url.Error{Op: "Post", URL: "https://private-sentinel.invalid?token=private-sentinel", Err: dnsErr}
	for _, cause := range []error{mapOutboundError(dnsErr), transportErr} {
		if !errors.Is(cause, dnsCause) {
			t.Fatal("internal DNS cause lost")
		}
		task := &model.Task{ID: "dns-task", Status: model.TaskStatusFailed, Error: providerUserFacingErrorMessage(cause)}
		recordTaskDiagnostic(task, "execution", "provider_execution_failed", "unknown", "reconcile_submission", cause)
		facts := cloudAgentTaskDiagnostic(nil, task)
		if facts["diagnosticCode"] != string(ReasonUpstreamDNSFailed) || facts["submissionOutcome"] != "unknown" || facts["retryClass"] != "reconcile_submission" {
			t.Fatalf("DNS classification or submission safety changed: %#v", facts)
		}
		message, reason := cloudAgentModelFailure(task)
		if reason != string(ReasonUpstreamDNSFailed) || !strings.Contains(message, "域名解析失败") || !strings.Contains(message, task.ID) {
			t.Fatalf("DNS cause hidden in generic failure: %s %s", reason, message)
		}
		raw, _ := json.Marshal(facts)
		if strings.Contains(string(raw)+message, "private-sentinel") {
			t.Fatal("raw DNS/transport details leaked")
		}
	}
}
