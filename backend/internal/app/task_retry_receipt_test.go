package app

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

type failedVideoProvider struct {
	*Service
	calls int
}

func (p *failedVideoProvider) processTask(_ context.Context, task model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	p.calls++
	if p.calls != 1 {
		return nil, nil, errors.New("unexpected second submission")
	}
	receipt := "synthetic-round-one"
	call := model.ApiCallLog{
		UserID: task.UserID, TaskID: task.ID, BillingOrderID: task.BillingOrderID,
		Capability: "video", ChannelID: "channel", RequestKind: "create", Billable: true,
		Status: model.ApiCallStatusSucceeded, ProviderRequestID: receipt, StatusCode: 200,
	}
	if err := p.LogAPICall(call); err != nil {
		return nil, nil, err
	}
	call.RequestKind, call.Status, call.ErrorCode = "poll", model.ApiCallStatusFailed, "task_failed"
	call.ProviderStatus = "failed"
	if err := p.LogAPICall(call); err != nil {
		return nil, nil, err
	}
	return nil, nil, providerTaskTerminalError{TaskID: receipt, Status: protocol.StatusFailed, Message: "synthetic provider terminal failure"}
}

func queuedVideoRetry(t *testing.T) (*Service, *gorm.DB, string, *model.Task) {
	t.Helper()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("unexpected provider call: %s %s", r.Method, r.URL.Path)
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(upstream.Close)
	s, db, _, _ := creationTestServiceOnDatabase(t, agentPermissionsDB(t))
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": "test-key"}).Error; err != nil {
		t.Fatal(err)
	}
	video := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkVideo), "seedance-test")
	for _, row := range []any{
		&model.ChannelModel{
			ID: "video-cm", ChannelID: "channel", ModelKey: "seedance-test", Capability: "video",
			Protocol: model.ChannelInterfaceVolcengineArkVideo, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, video),
			BillingMode: "per_second", PriceConfigured: true, Enabled: true,
		},
		&model.ChannelModelPriceTier{
			ID: "video-tier", ChannelModelID: "video-cm", SelectorKey: "{}", SelectorJSON: "{}",
			BillingMode: "per_second", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true,
		},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	features := defaultFeatureAvailability()
	features.FrontendModelsEnabled = true
	saveAdmissionFeatures(t, s, features)
	s.activeCancels = map[string]context.CancelFunc{}
	p := &failedVideoProvider{Service: s}
	s.taskRouteExecutor = &taskRouteExecutor{port: p}
	spec, err := CapabilitySpecFromModelCapabilityConfig(video, "video")
	if err != nil {
		t.Fatal(err)
	}
	logical := model.LogicalModel{ID: "fixture-logical", Code: "fixture-video", Name: "fixture video", Capability: "video", Enabled: true, ActiveRevisionID: "fixture-revision", PricePolicy: "channel", BillingMode: "per_second"}
	for _, row := range []any{&logical,
		&model.LogicalModelRevision{ID: logical.ActiveRevisionID, LogicalModelID: logical.ID, Version: 1, CapabilitySpecJSON: mustJSON(spec), DefaultOptionsJSON: "{}"},
		&model.LogicalModelRoute{ID: "fixture-route", LogicalModelRevisionID: logical.ActiveRevisionID, ChannelModelID: "video-cm", Enabled: true, Weight: 1},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := CreateTaskRequest{Type: "canvas_video", LogicalModelID: logical.ID, Prompt: "fixture", Input: map[string]any{"mode": "video", "prompt": "fixture", "config": map[string]any{"videoSeconds": "6", "size": "16:9", "vquality": "720p"}}}
	task, err := s.CreateTask("user", req)
	if err != nil || task.BillingOrderID == "" {
		t.Fatalf("create: %+v %v", task, err)
	}
	if err := s.ProcessNextTask(); err == nil || !strings.Contains(err.Error(), "synthetic provider terminal failure") {
		t.Fatalf("round one worker: %v", err)
	}
	first, err := s.repo.BillingOrder(task.BillingOrderID)
	if err != nil || first.Status != model.BillingStatusRefunded || first.ProviderRequestID != "synthetic-round-one" {
		t.Fatalf("original order: %+v %v", first, err)
	}
	retry, err := s.RetryTask("user", task.ID)
	if err != nil || retry.ID != task.ID || retry.RouteRun <= task.RouteRun || retry.BillingOrderID == "" || retry.BillingOrderID == first.ID || retry.ProviderRequestID != "" {
		t.Fatalf("retry: %+v %v", retry, err)
	}

	t.Cleanup(func() {
		if p.calls != 1 {
			t.Errorf("provider submissions=%d; want one", p.calls)
		}
	})
	return s, db, first.ID, retry
}

func TestCancelQueuedVideoRetry(t *testing.T) {
	s, db, firstID, retry := queuedVideoRetry(t)
	detail, err := s.Task("user", retry.ID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.ProviderRequestID != "" {
		t.Errorf("queued retry detail receipt = %q", detail.ProviderRequestID)
	}
	items, err := s.TasksWithOptions("user", TaskListOptions{ActiveOnly: true})
	if err != nil || len(items) != 1 {
		t.Fatalf("active task list: %+v, %v", items, err)
	}
	if items[0].ID != retry.ID || items[0].ProviderRequestID != "" || items[0].Billing == nil || items[0].Billing.Status != model.BillingStatusReserved {
		t.Errorf("queued retry summary: %+v, bill %+v", items[0], items[0].Billing)
	}
	reserved, err := s.repo.CreditAccount("user")
	if err != nil || reserved.ReservedMicrocredits != 6 || reserved.AvailableMicrocredits != 9994 {
		t.Fatalf("retry reservation: %+v, %v", reserved, err)
	}
	for i := 0; i < 2; i++ {
		cancelled, err := s.CancelTask(context.Background(), "user", retry.ID)
		if err != nil || cancelled.Status != model.TaskStatusCancelled || cancelled.ProviderRequestID != "" || cancelled.CancellationSource != model.TaskCancellationUserRequest || cancelled.ProviderCancelStatus != "" {
			t.Fatalf("cancel queued retry: %+v, %v", cancelled, err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.StopWorker(ctx); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{firstID, retry.BillingOrderID} {
		bill, err := s.repo.BillingOrder(id)
		if err != nil || bill.Status != model.BillingStatusRefunded || bill.ActualAmountMicrocredits != 0 || bill.RefundedAmountMicrocredits != 6 {
			t.Fatalf("refunded bill: %+v, %v", bill, err)
		}
		var entries []model.CreditLedgerEntry
		if err := db.Where("billing_order_id = ?", id).Order("created_at").Find(&entries).Error; err != nil || len(entries) != 2 || entries[0].Type != model.CreditLedgerReserve || entries[1].Type != model.CreditLedgerRefund {
			t.Fatalf("order ledger: %+v, %v", entries, err)
		}
	}
	balance, err := s.repo.CreditAccount("user")
	if err != nil || balance.AvailableMicrocredits != 10000 || balance.ReservedMicrocredits != 0 {
		t.Fatalf("balance after cancellation: %+v, %v", balance, err)
	}
	var cancelCalls int64
	if err := db.Model(&model.ApiCallLog{}).Where("task_id = ? AND request_kind IN ?", retry.ID, []string{"cancel", "cancel-query"}).Count(&cancelCalls).Error; err != nil || cancelCalls != 0 {
		t.Fatalf("provider cancellation calls=%d, err=%v", cancelCalls, err)
	}
}

func TestQueuedVideoRetryWithCurrentReceipt(t *testing.T) {
	s, db, _, retry := queuedVideoRetry(t)
	// Simulate a successful create for which neither task nor billing receipt was saved.
	log := model.ApiCallLog{ID: newID(), UserID: retry.UserID, TaskID: retry.ID, BillingOrderID: retry.BillingOrderID, RequestKind: "create", Status: model.ApiCallStatusSucceeded, ProviderRequestID: "current-create"}
	other := log
	other.ID, other.UserID = newID(), "other"
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	checkActiveTaskReceipt(t, s, retry, "", retry.Stage)
	unknown := log
	unknown.ID, unknown.ProviderRequestID = newID(), ""
	if err := db.Create(&unknown).Error; err != nil {
		t.Fatal(err)
	}
	checkActiveTaskReceipt(t, s, retry, "", "submission_unknown")
	if err := db.Create(&log).Error; err != nil {
		t.Fatal(err)
	}
	checkActiveTaskReceipt(t, s, retry, log.ProviderRequestID, retry.Stage)
	if err := s.repo.UpdateBillingProviderRequestID(retry.BillingOrderID, "current-order"); err != nil {
		t.Fatal(err)
	}
	checkActiveTaskReceipt(t, s, retry, "current-order", retry.Stage)
	bill, err := s.repo.BillingOrder(retry.BillingOrderID)
	if err != nil || bill.Status != model.BillingStatusReserved || bill.RefundedAmountMicrocredits != 0 {
		t.Fatalf("protected retry order: %+v, %v", bill, err)
	}
}

// The owner sees the same evidence in both views and cannot cancel accepted or uncertain work.
func checkActiveTaskReceipt(t *testing.T, s *Service, task *model.Task, wantID, wantStage string) {
	t.Helper()
	detail, err := s.Task(task.UserID, task.ID)
	if err != nil || detail.ProviderRequestID != wantID || detail.Stage != wantStage {
		t.Fatalf("task detail: %+v, %v; want receipt=%q stage=%q", detail, err, wantID, wantStage)
	}
	items, err := s.TasksWithOptions(task.UserID, TaskListOptions{ActiveOnly: true})
	if err != nil || len(items) != 1 || items[0].ID != task.ID || items[0].ProviderRequestID != wantID || items[0].Stage != wantStage {
		t.Fatalf("active list: %+v, %v; want receipt=%q stage=%q", items, err, wantID, wantStage)
	}
	if wantID != "" || wantStage == "submission_unknown" {
		if _, err := s.CancelTask(context.Background(), task.UserID, task.ID); err == nil || !strings.Contains(err.Error(), "第三方请求已提交") {
			t.Fatalf("expected submitted cancellation guard, got %v", err)
		}
	}
}

func TestOrderlessTaskReceiptAcrossRetry(t *testing.T) {
	s, db, _, _ := creationTestServiceOnDatabase(t, agentPermissionsDB(t))
	features := defaultFeatureAvailability()
	features.CreditsEnabled = false
	saveAdmissionFeatures(t, s, features)
	request := creationTextRequest()
	legacy := model.Task{ID: "old-direct", UserID: "user", Type: request.Type, Status: model.TaskStatusFailed, InputJSON: mustJSON(request.Input)}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	// Rows predating route_run may have NULL in this nullable column.
	if err := db.Model(&legacy).UpdateColumn("route_run", nil).Error; err != nil {
		t.Fatal(err)
	}
	log := model.ApiCallLog{ID: newID(), TaskID: legacy.ID, UserID: legacy.UserID, RequestKind: "create", Status: model.ApiCallStatusSucceeded, ProviderRequestID: "original"}
	if err := db.Create(&log).Error; err != nil {
		t.Fatal(err)
	}
	detail, err := s.Task(legacy.UserID, legacy.ID)
	if err != nil || detail.ProviderRequestID != "original" {
		t.Fatalf("original direct receipt: %+v, %v", detail, err)
	}
	items, err := s.Tasks(legacy.UserID, 10)
	if err != nil || len(items) != 1 || items[0].ProviderRequestID != "original" || items[0].Billing != nil {
		t.Fatalf("original direct summary: %+v, %v", items, err)
	}
	retry, err := s.RetryTask(legacy.UserID, legacy.ID)
	if err != nil || retry.RouteRun != 1 || retry.BillingOrderID != "" {
		t.Fatalf("free direct retry: %+v, %v", retry, err)
	}
	checkActiveTaskReceipt(t, s, retry, "", retry.Stage)
	claimed, err := s.repo.ClaimNextTask("worker", time.Minute)
	if err != nil || claimed == nil || claimed.ID != retry.ID {
		t.Fatalf("claim: %+v, %v", claimed, err)
	}
	checkActiveTaskReceipt(t, s, claimed, "", claimed.Stage)
	// A late unscoped log cannot identify this retry, even when written after its claim.
	log.ID, log.ProviderRequestID, log.CreatedAt = newID(), "ambiguous", time.Now()
	if err := db.Create(&log).Error; err != nil {
		t.Fatal(err)
	}
	checkActiveTaskReceipt(t, s, claimed, "", "submission_unknown")
	attempt := model.RouteAttempt{ID: newID(), TaskID: claimed.ID, RouteRun: claimed.RouteRun, AttemptNumber: 1, DispatchState: "submission_unknown"}
	if err := db.Create(&attempt).Error; err != nil {
		t.Fatal(err)
	}
	checkActiveTaskReceipt(t, s, claimed, "", "submission_unknown")
	attempt.DispatchState, attempt.ProviderRequestID = "accepted", "current-attempt"
	if err := s.repo.SaveRouteAttempt(&attempt); err != nil {
		t.Fatal(err)
	}
	checkActiveTaskReceipt(t, s, claimed, "current-attempt", claimed.Stage)
}

func TestCancelChecksRetryGenerationAtWrite(t *testing.T) {
	s, db, firstID, retry := queuedVideoRetry(t)
	stale := *retry
	stale.BillingOrderID = firstID
	stale.RouteRun--
	intent := model.TaskCancellationIntent{Source: model.TaskCancellationUserRequest, ActorID: retry.UserID}
	if changed, err := s.repo.CancelTaskIfStatus(&stale, time.Now(), intent); err != nil || changed {
		t.Fatalf("stale cancellation: changed=%v err=%v", changed, err)
	}
	attempt := model.RouteAttempt{ID: newID(), TaskID: retry.ID, RouteRun: retry.RouteRun, AttemptNumber: 1, DispatchState: "submission_unknown"}
	if err := db.Create(&attempt).Error; err != nil {
		t.Fatal(err)
	}
	checkActiveTaskReceipt(t, s, retry, "", "submission_unknown")
	if changed, err := s.repo.CancelTaskIfStatus(retry, time.Now(), intent); err != nil || changed {
		t.Fatalf("dispatch advanced before cancellation: changed=%v err=%v", changed, err)
	}
}

func TestTaskReceiptListWithMissingOrder(t *testing.T) {
	s, db, _, retry := queuedVideoRetry(t)
	missing := model.Task{ID: "dangling-order", UserID: retry.UserID, Status: model.TaskStatusQueued, Stage: retry.Stage, BillingOrderID: "missing"}
	if err := db.Create(&missing).Error; err != nil {
		t.Fatal(err)
	}
	items, err := s.Tasks(missing.UserID, 10)
	if err != nil || len(items) != 2 {
		t.Fatalf("task list: %+v, %v", items, err)
	}
	for _, item := range items {
		switch item.ID {
		case missing.ID:
			if item.Billing != nil || item.ProviderRequestID != "" || item.Stage != "submission_unknown" {
				t.Fatalf("dangling order summary: %+v", item)
			}
		case retry.ID:
			if item.Billing == nil || item.Billing.Status != model.BillingStatusReserved || item.Stage != retry.Stage {
				t.Fatalf("valid retry summary: %+v", item)
			}
		default:
			t.Fatalf("unexpected task: %s", item.ID)
		}
	}
	if _, err := s.CancelTask(context.Background(), missing.UserID, missing.ID); err == nil {
		t.Fatal("cancelled task with unverified order")
	}
}
