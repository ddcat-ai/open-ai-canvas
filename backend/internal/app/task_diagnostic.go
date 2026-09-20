package app

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
)

func taskHasAgentOrigin(raw string) bool {
	var input struct {
		Metadata struct {
			Source string `json:"source"`
		} `json:"metadata"`
	}
	return json.Unmarshal([]byte(raw), &input) == nil && input.Metadata.Source == "cloud_agent"
}

func safeTaskDiagnosticMessage(message string) string {
	message = strings.TrimSpace(message)
	if message == "" || !utf8.ValidString(message) || strings.ContainsAny(message, "\r\n\x00") {
		return "任务未完成，请在任务中心查看诊断"
	}
	lower := strings.ToLower(message)
	for _, marker := range []string{"http://", "https://", "file://", "ftp://", "authorization", "cookie", "secret", "token", "api_key", "apikey", "x-api-key", "/var/", "/tmp/", "\\", "stack trace", "traceback", "sql:", "sqlite", "postgres"} {
		if strings.Contains(lower, marker) {
			return "任务未完成，请在任务中心查看诊断"
		}
	}
	return truncateRunes(message, 240)
}

func recordTaskDiagnostic(task *model.Task, phase, code, outcome, retryClass string, cause error) {
	var appErr *AppError
	if errors.As(cause, &appErr) && appErr.Reason != "" {
		code = string(appErr.Reason)
	}
	diagnostic := &model.TaskExecutionDiagnostic{
		Code: code, Phase: phase, TaskSubmitted: outcome == "accepted" || outcome == "submitted", SubmissionOutcome: outcome,
		RetryClass: retryClass, SafeMessage: safeTaskDiagnosticMessage(task.Error), DiagnosticID: task.ID,
	}
	raw, _ := json.Marshal(diagnostic)
	task.ExecutionDiagnosticJSON, task.Diagnostic = string(raw), diagnostic
}

func recordTaskWritebackDiagnostic(task *model.Task, nodeID, outcome, reason string, cause error) {
	if task == nil {
		return
	}
	diagnostic := taskExecutionDiagnostic(task)
	if diagnostic == nil {
		diagnostic = &model.TaskExecutionDiagnostic{
			Code:              "task_terminal",
			Phase:             "completion",
			TaskSubmitted:     true,
			SubmissionOutcome: cloudAgentTaskSubmissionOutcome(task),
			RetryClass:        "none",
			DiagnosticID:      task.ID,
		}
		if task.Status == model.TaskStatusFailed || task.Status == model.TaskStatusCancelled {
			diagnostic.SafeMessage = cloudAgentSafeMediaTaskError(task)
		}
	}
	diagnostic.WritebackOutcome = outcome
	diagnostic.WritebackReason = strings.TrimSpace(reason)
	diagnostic.WritebackNodeID = strings.TrimSpace(nodeID)
	diagnostic.WritebackMessage = ""
	if cause != nil {
		diagnostic.WritebackMessage = safeTaskDiagnosticMessage(cloudAgentSafeToolError(cause))
	}
	raw, _ := json.Marshal(diagnostic)
	task.ExecutionDiagnosticJSON, task.Diagnostic = string(raw), diagnostic
}

// taskExecutionDiagnostic exposes stored execution facts; it never derives a
// failure category from a node's presentation state or the model's explanation.
func taskExecutionDiagnostic(task *model.Task) *model.TaskExecutionDiagnostic {
	if task == nil || task.ExecutionDiagnosticJSON == "" {
		return nil
	}
	var diagnostic model.TaskExecutionDiagnostic
	if json.Unmarshal([]byte(task.ExecutionDiagnosticJSON), &diagnostic) != nil {
		return nil
	}
	diagnostic.SafeMessage = safeTaskDiagnosticMessage(diagnostic.SafeMessage)
	return &diagnostic
}

func taskSubmissionOutcome(task *model.Task, notSent bool) string {
	if notSent {
		return "not_submitted"
	}
	if task.ProviderRequestID != "" {
		return "accepted"
	}
	return "unknown"
}
