package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestAgentMediaAdmissionPersistsOriginAndChargeAuthorization(t *testing.T) {
	s, _, args := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, args, "auto")
	req, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	if err != nil {
		t.Fatal(err)
	}
	req.admission = &taskAdmission{ID: "generation-task", MaxCharge: 1000, AgentRunID: run.ID, GenerationID: "generation", ApprovalID: "approval"}
	req.creationPrepare = &creationTaskPreparation{}
	task, err := s.CreateTask(run.UserID, req)
	if err != nil {
		t.Fatal(err)
	}
	order := req.creationPrepare.Order
	if task.AgentRunID != run.ID || task.GenerationID != "generation" || task.ApprovalID != "approval" || order == nil || !order.ChargeLimitSet || task.AuthorizedChargeMicrocredits != order.AmountMicrocredits || order.ChargeLimitMicrocredits != order.AmountMicrocredits {
		t.Fatalf("incomplete generation authorization: task=%+v order=%+v", task, order)
	}
}

func TestAgentMediaRetryRequiresNewGenerationAuthorization(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, task := range []model.Task{
		{ID: "agent-run-only", AgentRunID: "run"},
		{ID: "generation-only", GenerationID: "generation"},
		{ID: "operation-prefix", Operation: "cloud_agent_media"},
		{ID: "source", InputJSON: `{"metadata":{"source":"cloud_agent"}}`},
	} {
		task.UserID, task.Type, task.Status = "user", "canvas_video", model.TaskStatusFailed
		if task.Operation == "" {
			task.Operation = "image_to_video"
		}
		if task.InputJSON == "" {
			task.InputJSON = `{}`
		}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		if _, err := s.RetryTask(task.UserID, task.ID); err == nil || !strings.Contains(err.Error(), "Agent 重试") {
			t.Fatalf("media retry retained old authorization: %v", err)
		}
		stored, err := s.repo.Task(task.ID)
		if err != nil || stored.Status != model.TaskStatusFailed || stored.BillingOrderID != "" {
			t.Fatalf("retry changed old execution: %+v %v", stored, err)
		}
	}
}

func TestOrdinaryFailedAndCancelledTasksKeepRetryIdentity(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, status := range []model.TaskStatus{model.TaskStatusFailed, model.TaskStatusCancelled} {
		task := model.Task{
			ID:        "ordinary-" + string(status),
			UserID:    "user",
			Type:      "canvas_text",
			Operation: "text",
			Status:    status,
			InputJSON: `{}`,
			RouteRun:  3,
		}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}

		retried, err := s.RetryTask(task.UserID, task.ID)
		if err != nil {
			t.Fatalf("ordinary %s task should remain retryable: %v", status, err)
		}
		if retried.ID != task.ID || retried.Status != model.TaskStatusQueued || retried.RouteRun != 4 || retried.GenerationID != "" || retried.AgentRunID != "" {
			t.Fatalf("retry must reuse task execution identity without inventing an Agent generation: %+v", retried)
		}
		if _, err = s.RetryTask(task.UserID, task.ID); err == nil {
			t.Fatal("queued retry was accepted a second time")
		}
	}
}

func TestTaskCancellationPersistsFirstSourceAndDiagnostic(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	task := model.Task{ID: "cancel-child", UserID: "user", AgentRunID: "parent", Status: model.TaskStatusQueued}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.taskLifecycle().cancelTaskWithIntent(context.Background(), "user", task.ID, model.TaskCancellationIntent{Source: model.TaskCancellationParentFailed}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CancelTask(context.Background(), "user", task.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	diagnostic := taskExecutionDiagnostic(stored)
	if stored.CancellationSource != model.TaskCancellationParentFailed || stored.CancellationRequestedAt == nil || diagnostic == nil || diagnostic.Phase != "cancellation" || diagnostic.SubmissionOutcome != "not_submitted" || diagnostic.TaskSubmitted {
		t.Fatalf("cancellation lost facts: %+v %+v", stored, diagnostic)
	}
}

func TestRetryTaskReleasesLeftoverReservationBeforeNewSuccess(t *testing.T) {
	for _, mode := range []string{"not_submitted", "provider_failed", "provider_cancelled", "prior_order_success", "free_retry"} {
		t.Run(mode, func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			task, err := s.CreateTask("user", creationTextRequest())
			if err != nil || task.BillingOrderID == "" {
				t.Fatalf("create: task=%+v err=%v", task, err)
			}
			oldOrderID := task.BillingOrderID
			if err := s.repo.MarkBillingRunning(oldOrderID); err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("status", model.TaskStatusRunning).Error; err != nil {
				t.Fatal(err)
			}
			task, _ = s.repo.Task(task.ID)
			// 真实终态已提交，但退款写失败：旧单仍 running，任务已 failed。
			if err := db.Exec("CREATE TRIGGER reject_refund BEFORE UPDATE OF status ON billing_orders WHEN NEW.status = 'refunded' BEGIN SELECT RAISE(ABORT, 'refund unavailable'); END").Error; err != nil {
				t.Fatal(err)
			}
			failure := errors.New("invalid input")
			notSubmitted := mode == "not_submitted" || mode == "free_retry" || mode == "prior_order_success"
			if mode == "prior_order_success" {
				if err := db.Create(&model.ApiCallLog{ID: "prior-success", TaskID: task.ID, BillingOrderID: "prior-settled-order", Billable: true, Status: model.ApiCallStatusSucceeded, RequestKind: "create"}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if !notSubmitted {
				code, status := "task_failed", protocol.StatusFailed
				if mode == "provider_cancelled" {
					code, status = "task_cancelled", protocol.StatusCancelled
				}
				task.ProviderRequestID = "old-provider-request"
				if err := db.Model(task).Update("provider_request_id", task.ProviderRequestID).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Create(&model.ApiCallLog{ID: "old-failed-call", TaskID: task.ID, BillingOrderID: oldOrderID, UserID: task.UserID, Billable: true, Status: model.ApiCallStatusFailed, ErrorCode: code, RequestKind: "create"}).Error; err != nil {
					t.Fatal(err)
				}
				failure = providerTaskTerminalError{TaskID: task.ProviderRequestID, Status: status, Message: "upstream timeout"}
			}
			if err := s.terminalCoordinator().handleExecutionFailure(task, failure, false, notSubmitted); err == nil || !strings.Contains(err.Error(), "refund unavailable") {
				t.Fatalf("terminal error=%v", err)
			}
			stored, err := s.repo.Task(task.ID)
			oldOrder, orderErr := s.repo.BillingOrder(oldOrderID)
			if err != nil || orderErr != nil || stored.Status != model.TaskStatusFailed || oldOrder.Status != model.BillingStatusRunning {
				t.Fatalf("leftover task=%+v order=%+v errors=%v %v", stored, oldOrder, err, orderErr)
			}
			if err := db.Exec("DROP TRIGGER reject_refund").Error; err != nil {
				t.Fatal(err)
			}
			if mode == "free_retry" {
				if _, err := s.UpdateFeatureAvailability(&model.User{ID: "admin", Role: model.UserRoleAdmin}, FeatureAvailability{TaskCenterEnabled: true, CustomChannelsEnabled: true}); err != nil {
					t.Fatal(err)
				}
			}
			retried, err := s.RetryTask(task.UserID, task.ID)
			if err != nil || retried.Status != model.TaskStatusQueued || retried.BillingOrderID == oldOrderID {
				t.Fatalf("retry=%+v err=%v", retried, err)
			}
			if (retried.BillingOrderID == "") != (mode == "free_retry") {
				t.Fatalf("unexpected new order=%q", retried.BillingOrderID)
			}
			if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"done"}`}).Error; err != nil {
				t.Fatal(err)
			}
			if err := s.taskBilling().SettleBilling(retried.BillingOrderID, "new-provider-request"); err != nil {
				t.Fatal(err)
			}
			oldOrder, err = s.repo.BillingOrder(oldOrderID)
			if err != nil || oldOrder.Status != model.BillingStatusRefunded {
				t.Fatalf("old order after success=%+v err=%v", oldOrder, err)
			}
			account, err := s.repo.CreditAccount(task.UserID)
			wantAvailable := int64(9900)
			if mode == "free_retry" {
				wantAvailable = 10000
			}
			if err != nil || account.AvailableMicrocredits != wantAvailable || account.ReservedMicrocredits != 0 {
				t.Fatalf("account=%+v err=%v", account, err)
			}
			var refunds int64
			if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ? AND type = ?", oldOrderID, model.CreditLedgerRefund).Count(&refunds).Error; err != nil || refunds != 1 {
				t.Fatalf("refunds=%d err=%v", refunds, err)
			}
		})
	}
}

func TestRetryTaskPreservesUnresolvedBillingEvidence(t *testing.T) {
	for _, mode := range []string{"uncertain", "unknown", "missing_diagnostic", "result_persistence", "recovery", "successful_call", "other_order_failure", "refund_failure", "new_reservation_failure", "settled", "refunded"} {
		t.Run(mode, func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			task, err := s.CreateTask("user", creationTextRequest())
			if err != nil {
				t.Fatal(err)
			}
			// CreateTask 返回脱敏输入；修改终态必须重新读取持久化任务。
			task, err = s.repo.Task(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			oldOrderID := task.BillingOrderID
			task.Status = model.TaskStatusFailed
			recordTaskDiagnostic(task, "execution", "provider_execution_failed", "not_submitted", "correct_input", nil)
			status := model.BillingStatusRunning
			switch mode {
			case "uncertain":
				status = model.BillingStatusUncertain
			case "unknown", "other_order_failure":
				recordTaskDiagnostic(task, "execution", "provider_execution_failed", "unknown", "reconcile_submission", nil)
			case "missing_diagnostic":
				task.ExecutionDiagnosticJSON = ""
			case "result_persistence":
				recordTaskDiagnostic(task, "result_persistence", "result_persistence_failed", "accepted", "recover_result", nil)
			case "recovery":
				task.MediaRecoveryJSON = "encrypted-checkpoint"
			case "settled":
				if err := s.repo.SettleBillingOrder(oldOrderID, "provider"); err != nil {
					t.Fatal(err)
				}
				status = model.BillingStatusSettled
			case "refunded":
				if err := s.repo.RefundBillingOrder(oldOrderID, "already released"); err != nil {
					t.Fatal(err)
				}
				status = model.BillingStatusRefunded
			}
			if err := db.Save(task).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.BillingOrder{}).Where("id = ?", oldOrderID).Update("status", status).Error; err != nil {
				t.Fatal(err)
			}
			if mode == "successful_call" || mode == "other_order_failure" {
				call := model.ApiCallLog{ID: "evidence", TaskID: task.ID, BillingOrderID: oldOrderID, Billable: true, Status: model.ApiCallStatusSucceeded}
				if mode == "other_order_failure" {
					call.BillingOrderID, call.Status, call.ErrorCode = "different-order", model.ApiCallStatusFailed, "task_failed"
				}
				if err := db.Create(&call).Error; err != nil {
					t.Fatal(err)
				}
			}
			if mode == "refund_failure" {
				if err := db.Exec("CREATE TRIGGER reject_refund BEFORE UPDATE OF status ON billing_orders WHEN NEW.status = 'refunded' BEGIN SELECT RAISE(ABORT, 'refund unavailable'); END").Error; err != nil {
					t.Fatal(err)
				}
			}
			if mode == "new_reservation_failure" {
				if err := db.Exec("CREATE TRIGGER reject_reserve BEFORE INSERT ON billing_orders BEGIN SELECT RAISE(ABORT, 'reserve unavailable'); END").Error; err != nil {
					t.Fatal(err)
				}
			}
			before, err := s.repo.CreditAccount(task.UserID)
			if err != nil {
				t.Fatal(err)
			}
			retried, retryErr := s.RetryTask(task.UserID, task.ID)
			if mode == "settled" || mode == "refunded" {
				if retryErr != nil || retried.Status != model.TaskStatusQueued {
					t.Fatalf("resolved order blocked retry: %v", retryErr)
				}
				return
			}
			if retryErr == nil {
				t.Fatal("unsafe or failed release allowed retry")
			}
			stored, err := s.repo.Task(task.ID)
			if err != nil || stored.Status != task.Status || stored.BillingOrderID != oldOrderID || stored.ExecutionDiagnosticJSON != task.ExecutionDiagnosticJSON || stored.MediaRecoveryJSON != task.MediaRecoveryJSON {
				t.Fatalf("old evidence changed: %+v %v", stored, err)
			}
			order, err := s.repo.BillingOrder(oldOrderID)
			if err != nil || order.Status != status {
				t.Fatalf("order=%+v err=%v", order, err)
			}
			after, err := s.repo.CreditAccount(task.UserID)
			if err != nil || after.AvailableMicrocredits != before.AvailableMicrocredits || after.ReservedMicrocredits != before.ReservedMicrocredits {
				t.Fatalf("account changed: before=%+v after=%+v err=%v", before, after, err)
			}
			var count int64
			if err := db.Model(&model.BillingOrder{}).Where("task_id = ?", task.ID).Count(&count).Error; err != nil || count != 1 {
				t.Fatalf("orders=%d err=%v", count, err)
			}
			if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ? AND type = ?", oldOrderID, model.CreditLedgerRefund).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("refund entries=%d err=%v", count, err)
			}
		})
	}
}
