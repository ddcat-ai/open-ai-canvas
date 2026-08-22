package service

import (
	"errors"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

type taskBillingRepositoryStub struct {
	runningCalls      []string
	settleCalls       []string
	refundCalls       []string
	uncertainCalls    []string
	order             *model.BillingOrder
	orderErr          error
	hasSuccessfulCall bool
	callErr           error
}

func (r *taskBillingRepositoryStub) MarkBillingRunning(orderID string) error {
	r.runningCalls = append(r.runningCalls, orderID)
	return nil
}

func (r *taskBillingRepositoryStub) SettleBillingOrder(orderID string, providerRequestID string) error {
	r.settleCalls = append(r.settleCalls, orderID+":"+providerRequestID)
	return nil
}

func (r *taskBillingRepositoryStub) RefundBillingOrder(orderID string, errorText string) error {
	r.refundCalls = append(r.refundCalls, orderID+":"+errorText)
	return nil
}

func (r *taskBillingRepositoryStub) MarkBillingUncertain(orderID string, errorText string) error {
	r.uncertainCalls = append(r.uncertainCalls, orderID+":"+errorText)
	return nil
}

func (r *taskBillingRepositoryStub) BillingOrder(string) (*model.BillingOrder, error) {
	return r.order, r.orderErr
}

func (r *taskBillingRepositoryStub) TaskHasSuccessfulBillableCall(string) (bool, error) {
	return r.hasSuccessfulCall, r.callErr
}

func TestTaskBillingCoordinatorEmptyOrderIsNoOp(t *testing.T) {
	repo := &taskBillingRepositoryStub{}
	billing := newTaskBillingCoordinator(repo)

	if err := billing.MarkBillingRunning(""); err != nil {
		t.Fatalf("MarkBillingRunning() error = %v", err)
	}
	if err := billing.SettleBilling("", "provider-1"); err != nil {
		t.Fatalf("SettleBilling() error = %v", err)
	}
	if err := billing.RefundBilling("", "refund"); err != nil {
		t.Fatalf("RefundBilling() error = %v", err)
	}
	if err := billing.MarkBillingUncertain("", "uncertain"); err != nil {
		t.Fatalf("MarkBillingUncertain() error = %v", err)
	}
	if billing.BillingFailureRequiresReview("", "task-1", errors.New("timeout")) {
		t.Fatal("BillingFailureRequiresReview() = true for empty order")
	}
	if len(repo.runningCalls)+len(repo.settleCalls)+len(repo.refundCalls)+len(repo.uncertainCalls) != 0 {
		t.Fatalf("empty order should not reach repository: %#v", repo)
	}
}

func TestTaskBillingCoordinatorRetryEligibility(t *testing.T) {
	tests := []struct {
		name       string
		orderID    string
		order      *model.BillingOrder
		orderErr   error
		wantErr    bool
		wantReview bool
	}{
		{name: "empty order", wantErr: false},
		{name: "running order", orderID: "order-1", order: &model.BillingOrder{Status: model.BillingStatusRunning}, wantErr: false},
		{name: "settled order", orderID: "order-1", order: &model.BillingOrder{Status: model.BillingStatusSettled}, wantErr: false},
		{name: "refunded order", orderID: "order-1", order: &model.BillingOrder{Status: model.BillingStatusRefunded}, wantErr: false},
		{name: "uncertain order", orderID: "order-1", order: &model.BillingOrder{Status: model.BillingStatusUncertain}, wantErr: true, wantReview: true},
		{name: "missing order", orderID: "order-1", wantErr: true, wantReview: false},
		{name: "lookup failure", orderID: "order-1", orderErr: errors.New("database unavailable"), wantErr: true, wantReview: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			billing := newTaskBillingCoordinator(&taskBillingRepositoryStub{order: tt.order, orderErr: tt.orderErr})
			err := billing.CheckRetryEligibility(tt.orderID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("CheckRetryEligibility() error = %v, wantErr %v", err, tt.wantErr)
			}
			if errors.Is(err, errTaskBillingReview) != tt.wantReview {
				t.Fatalf("CheckRetryEligibility() review = %v, wantReview %v, err = %v", errors.Is(err, errTaskBillingReview), tt.wantReview, err)
			}
		})
	}
}

func TestTaskBillingCoordinatorTruncatesFailureText(t *testing.T) {
	repo := &taskBillingRepositoryStub{}
	billing := newTaskBillingCoordinator(repo)
	reason := strings.Repeat("中", 1001)

	if err := billing.RefundBilling("order-1", reason); err != nil {
		t.Fatalf("RefundBilling() error = %v", err)
	}
	if err := billing.MarkBillingUncertain("order-1", reason); err != nil {
		t.Fatalf("MarkBillingUncertain() error = %v", err)
	}
	if got := repo.refundCalls[0]; !strings.HasSuffix(got, strings.Repeat("中", 1000)+"...") {
		t.Fatalf("refund reason was not truncated with compatibility suffix: %q", got)
	}
	if got := repo.uncertainCalls[0]; !strings.HasSuffix(got, strings.Repeat("中", 1000)+"...") {
		t.Fatalf("uncertain reason was not truncated with compatibility suffix: %q", got)
	}
}

func TestTaskBillingCoordinatorFailureReviewPolicy(t *testing.T) {
	tests := []struct {
		name string
		stub taskBillingRepositoryStub
		err  error
		want bool
	}{
		{name: "uncertain transport error", stub: taskBillingRepositoryStub{order: &model.BillingOrder{Status: model.BillingStatusSettled}}, err: errors.New("upstream timeout"), want: true},
		{name: "order lookup error", stub: taskBillingRepositoryStub{orderErr: errors.New("database unavailable")}, err: errors.New("provider unavailable"), want: true},
		{name: "uncertain order", stub: taskBillingRepositoryStub{order: &model.BillingOrder{Status: model.BillingStatusUncertain}}, err: errors.New("provider rejected"), want: true},
		{name: "successful billable call", stub: taskBillingRepositoryStub{order: &model.BillingOrder{Status: model.BillingStatusRunning}, hasSuccessfulCall: true}, err: errors.New("provider rejected"), want: true},
		{name: "normal failed call", stub: taskBillingRepositoryStub{order: &model.BillingOrder{Status: model.BillingStatusRunning}}, err: errors.New("provider rejected"), want: false},
		{name: "billable call lookup error", stub: taskBillingRepositoryStub{order: &model.BillingOrder{Status: model.BillingStatusRunning}, callErr: errors.New("database unavailable")}, err: errors.New("provider rejected"), want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			billing := newTaskBillingCoordinator(&tt.stub)
			if got := billing.BillingFailureRequiresReview("order-1", "task-1", tt.err); got != tt.want {
				t.Fatalf("BillingFailureRequiresReview() = %v, want %v", got, tt.want)
			}
		})
	}
}
