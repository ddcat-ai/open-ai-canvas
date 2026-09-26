package app

import (
	"encoding/json"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// cloudAgentTaskFacts is the model-facing projection of durable task state.
// Keep this typed: canvas reads, task_get and the fresh context frame must not
// independently invent string-key contracts for the same execution facts.
type cloudAgentTaskFacts struct {
	TaskID             string                       `json:"taskId"`
	TaskStatus         model.TaskStatus             `json:"taskStatus"`
	TaskType           string                       `json:"taskType,omitempty"`
	Operation          string                       `json:"operation,omitempty"`
	AgentRunID         string                       `json:"agentRunId,omitempty"`
	GenerationID       string                       `json:"generationId,omitempty"`
	ApprovalID         string                       `json:"approvalId,omitempty"`
	NodeID             string                       `json:"nodeId,omitempty"`
	TaskSubmitted      bool                         `json:"taskSubmitted"`
	SubmissionOutcome  string                       `json:"submissionOutcome"`
	Phase              string                       `json:"phase,omitempty"`
	DiagnosticCode     string                       `json:"diagnosticCode,omitempty"`
	DiagnosticID       string                       `json:"diagnosticId,omitempty"`
	FieldPath          string                       `json:"fieldPath,omitempty"`
	RetryClass         string                       `json:"retryClass,omitempty"`
	Error              string                       `json:"error,omitempty"`
	WritebackOutcome   string                       `json:"writebackOutcome,omitempty"`
	WritebackReason    string                       `json:"writebackReason,omitempty"`
	WritebackNodeID    string                       `json:"writebackNodeId,omitempty"`
	WritebackError     string                       `json:"writebackError,omitempty"`
	CancellationSource string                       `json:"cancellationSource,omitempty"`
	CancellationAt     *time.Time                   `json:"cancellationRequestedAt,omitempty"`
	SubmissionReceipt  *cloudAgentSubmissionReceipt `json:"submissionReceipt,omitempty"`
	Billing            *cloudAgentTaskBillingFacts  `json:"billing,omitempty"`
}

type cloudAgentSubmissionReceipt struct {
	TaskID       string    `json:"taskId"`
	GenerationID string    `json:"generationId,omitempty"`
	RecordedAt   time.Time `json:"recordedAt"`
}

type cloudAgentTaskBillingFacts struct {
	OrderID                      string              `json:"orderId"`
	Status                       model.BillingStatus `json:"status,omitempty"`
	AuthorizedChargeMicrocredits int64               `json:"authorizedChargeMicrocredits"`
	ChargeLimitSet               bool                `json:"chargeLimitSet"`
	ChargeLimitMicrocredits      int64               `json:"chargeLimitMicrocredits"`
	ReservedAmountMicrocredits   int64               `json:"reservedAmountMicrocredits,omitempty"`
	ActualAmountMicrocredits     int64               `json:"actualAmountMicrocredits,omitempty"`
	RefundedAmountMicrocredits   int64               `json:"refundedAmountMicrocredits,omitempty"`
	ReservedCredits              float64             `json:"reservedCredits"`
	ActualCredits                float64             `json:"actualCredits"`
	RefundedCredits              float64             `json:"refundedCredits"`
	ChargeState                  string              `json:"chargeState"`
	ChargeSummary                string              `json:"chargeSummary"`
	StateAvailable               bool                `json:"stateAvailable"`
}

func cloudAgentChargeState(status model.BillingStatus) (string, string) {
	switch status {
	case model.BillingStatusSettled:
		return "settled", "已结算，实际扣费以 actualCredits 为准"
	case model.BillingStatusRefunded:
		return "refunded", "已退款，本次不计入已消费"
	case model.BillingStatusReserved, model.BillingStatusRunning:
		return "pending", "仅预授权/执行中，尚未确认实际扣费"
	case model.BillingStatusUncertain:
		return "uncertain", "扣费状态待确认，不得称为已扣费"
	default:
		return "unknown", "扣费状态未知，不得称为已扣费"
	}
}

func cloudAgentTaskDiagnostic(repo *repository.Repository, task *model.Task) map[string]any {
	if task == nil {
		return map[string]any{"taskStatus": "unavailable", "taskSubmitted": false, "submissionOutcome": "unavailable"}
	}
	facts := cloudAgentTaskFacts{
		TaskID: task.ID, TaskStatus: task.Status, TaskType: task.Type, Operation: task.Operation,
		AgentRunID: task.AgentRunID, GenerationID: task.GenerationID, ApprovalID: task.ApprovalID,
		TaskSubmitted: true, SubmissionOutcome: cloudAgentTaskSubmissionOutcome(task),
		CancellationSource: task.CancellationSource, CancellationAt: task.CancellationRequestedAt,
		SubmissionReceipt: &cloudAgentSubmissionReceipt{TaskID: task.ID, GenerationID: task.GenerationID, RecordedAt: task.CreatedAt},
	}
	if context := taskClientContext(task.InputJSON); context != nil {
		facts.NodeID = context.NodeID
	}
	if diagnostic := taskExecutionDiagnostic(task); diagnostic != nil {
		facts.TaskSubmitted = diagnostic.TaskSubmitted
		facts.SubmissionOutcome = diagnostic.SubmissionOutcome
		facts.Phase = diagnostic.Phase
		facts.DiagnosticCode = diagnostic.Code
		facts.DiagnosticID = diagnostic.DiagnosticID
		facts.FieldPath = diagnostic.FieldPath
		facts.RetryClass = diagnostic.RetryClass
		facts.Error = diagnostic.SafeMessage
		facts.WritebackOutcome = diagnostic.WritebackOutcome
		facts.WritebackReason = diagnostic.WritebackReason
		facts.WritebackNodeID = diagnostic.WritebackNodeID
		facts.WritebackError = diagnostic.WritebackMessage
	} else if task.Status == model.TaskStatusFailed || task.Status == model.TaskStatusCancelled {
		facts.Error = cloudAgentSafeMediaTaskError(task)
	}
	if task.BillingOrderID != "" {
		facts.Billing = &cloudAgentTaskBillingFacts{
			OrderID: task.BillingOrderID, AuthorizedChargeMicrocredits: task.AuthorizedChargeMicrocredits,
		}
		if repo != nil {
			if order, err := repo.BillingOrder(task.BillingOrderID); err == nil && order.UserID == task.UserID && (order.TaskID == "" || order.TaskID == task.ID) {
				facts.Billing.Status = order.Status
				facts.Billing.ChargeLimitSet = order.ChargeLimitSet
				facts.Billing.ChargeLimitMicrocredits = order.ChargeLimitMicrocredits
				facts.Billing.ReservedAmountMicrocredits = order.ReservedAmountMicrocredits
				facts.Billing.ActualAmountMicrocredits = order.ActualAmountMicrocredits
				facts.Billing.RefundedAmountMicrocredits = order.RefundedAmountMicrocredits
				facts.Billing.ReservedCredits = float64(order.ReservedAmountMicrocredits) / float64(CreditScale)
				facts.Billing.ActualCredits = float64(order.ActualAmountMicrocredits) / float64(CreditScale)
				facts.Billing.RefundedCredits = float64(order.RefundedAmountMicrocredits) / float64(CreditScale)
				facts.Billing.ChargeState, facts.Billing.ChargeSummary = cloudAgentChargeState(order.Status)
				facts.Billing.StateAvailable = true
			}
		}
	}
	raw, err := json.Marshal(facts)
	if err != nil {
		return map[string]any{"taskId": task.ID, "taskStatus": task.Status, "taskSubmitted": true, "submissionOutcome": "unknown"}
	}
	result := map[string]any{}
	if json.Unmarshal(raw, &result) != nil {
		return map[string]any{"taskId": task.ID, "taskStatus": task.Status, "taskSubmitted": true, "submissionOutcome": "unknown"}
	}
	return result
}

func cloudAgentTaskSubmissionOutcome(task *model.Task) string {
	if task == nil {
		return "unavailable"
	}
	if task.ProviderRequestID != "" {
		return "accepted"
	}
	switch task.Status {
	case model.TaskStatusQueued:
		return "queued"
	case model.TaskStatusRunning:
		return "submitted"
	default:
		return "unknown"
	}
}
