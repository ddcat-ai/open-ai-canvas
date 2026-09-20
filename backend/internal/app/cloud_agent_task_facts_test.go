package app

import (
	"encoding/json"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCloudAgentTaskDiagnosticProjectsDurableExecutionFacts(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	now := time.Now().UTC().Truncate(time.Second)
	diagnostic := model.TaskExecutionDiagnostic{
		Code: "invalid_duration", Phase: "preparation", FieldPath: "generationSpec.options.durationSeconds",
		TaskSubmitted: false, SubmissionOutcome: "not_submitted", RetryClass: "correct_input",
		SafeMessage: "视频时长不受支持", DiagnosticID: "diag-1",
	}
	rawDiagnostic, _ := json.Marshal(diagnostic)
	task := &model.Task{
		ID: "task-facts", UserID: "user", ProjectID: "canvas", Type: "canvas_video", Status: model.TaskStatusFailed,
		Operation: "cloud_agent_generate_media", AgentRunID: "run-1", GenerationID: "generation-1", ApprovalID: "approval-1",
		BillingOrderID: "order-facts", AuthorizedChargeMicrocredits: 700, CancellationSource: model.TaskCancellationUserRequest,
		CancellationRequestedAt: &now, InputJSON: `{"metadata":{"source":"cloud_agent","nodeId":"video-node"}}`,
		ExecutionDiagnosticJSON: string(rawDiagnostic), CreatedAt: now,
	}
	order := &model.BillingOrder{
		ID: "order-facts", UserID: "user", TaskID: task.ID, Status: model.BillingStatusRefunded,
		ChargeLimitSet: true, ChargeLimitMicrocredits: 700, ReservedAmountMicrocredits: 700, RefundedAmountMicrocredits: 700,
	}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(order).Error; err != nil {
		t.Fatal(err)
	}

	facts := cloudAgentTaskDiagnostic(s.repo, task)
	for key, want := range map[string]any{
		"taskId": task.ID, "taskStatus": string(model.TaskStatusFailed), "agentRunId": "run-1", "generationId": "generation-1",
		"approvalId": "approval-1", "nodeId": "video-node", "taskSubmitted": false, "submissionOutcome": "not_submitted",
		"phase": "preparation", "diagnosticCode": "invalid_duration", "diagnosticId": "diag-1",
		"fieldPath": "generationSpec.options.durationSeconds", "retryClass": "correct_input", "error": "视频时长不受支持",
		"cancellationSource": model.TaskCancellationUserRequest,
	} {
		if got := facts[key]; got != want {
			t.Fatalf("%s = %#v, want %#v; facts=%#v", key, got, want, facts)
		}
	}
	billing, ok := facts["billing"].(map[string]any)
	if !ok || billing["orderId"] != order.ID || billing["status"] != string(model.BillingStatusRefunded) || billing["stateAvailable"] != true || billing["chargeLimitSet"] != true {
		t.Fatalf("billing facts = %#v", facts["billing"])
	}
	receipt, ok := facts["submissionReceipt"].(map[string]any)
	if !ok || receipt["taskId"] != task.ID || receipt["generationId"] != task.GenerationID {
		t.Fatalf("submission receipt = %#v", facts["submissionReceipt"])
	}
}

func TestRecordTaskDiagnosticDoesNotClaimUnsubmittedRequest(t *testing.T) {
	task := &model.Task{ID: "task", Error: "参数无效"}
	recordTaskDiagnostic(task, "preparation", "preparation_failed", "not_submitted", "correct_input", nil)
	if task.Diagnostic == nil || task.Diagnostic.TaskSubmitted {
		t.Fatalf("diagnostic = %#v", task.Diagnostic)
	}
	recordTaskDiagnostic(task, "execution", "provider_execution_failed", "accepted", "new_generation_authorization", nil)
	if task.Diagnostic == nil || !task.Diagnostic.TaskSubmitted {
		t.Fatalf("diagnostic = %#v", task.Diagnostic)
	}
}

func TestCloudAgentTaskDiagnosticRejectsMismatchedBillingOrderFacts(t *testing.T) {
	_, db, _, _ := creationTestService(t)
	order := &model.BillingOrder{ID: "other-order", UserID: "other", TaskID: "other-task", Status: model.BillingStatusSettled}
	if err := db.Create(order).Error; err != nil {
		t.Fatal(err)
	}
	task := &model.Task{ID: "task", UserID: "user", Status: model.TaskStatusQueued, BillingOrderID: order.ID, AuthorizedChargeMicrocredits: 9}
	facts := cloudAgentTaskDiagnostic(repository.New(db), task)
	billing := facts["billing"].(map[string]any)
	if billing["stateAvailable"] != false || billing["status"] != nil {
		t.Fatalf("cross-owner billing state leaked: %#v", billing)
	}
}
