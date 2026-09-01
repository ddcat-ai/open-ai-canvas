package repository

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newRefundedBillingRecoveryRepository(t *testing.T) (*Repository, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newRepositoryID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.ApiCallLog{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	return &Repository{db: db}, db
}

func TestRestoreRefundedBillingOrderChargesFixedOrderOnce(t *testing.T) {
	repo, db := newRefundedBillingRecoveryRepository(t)
	now := time.Now()
	if err := db.Create(&model.CreditAccount{UserID: "user-1", AvailableMicrocredits: 9_000_000}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.BillingOrder{
		ID: "order-1", UserID: "user-1", IdempotencyKey: "task:task-1", TaskID: "task-1",
		Model: "Wan 3.0", Capability: "video", BillingMode: "fixed", AmountMicrocredits: 3_000_000,
		ReservedAmountMicrocredits: 3_000_000, RefundedAmountMicrocredits: 3_000_000,
		Status: model.BillingStatusRefunded, RefundedAt: &now,
	}).Error; err != nil {
		t.Fatal(err)
	}

	for range 2 {
		if err := repo.RestoreRefundedBillingOrder("order-1", "provider-task-1"); err != nil {
			t.Fatalf("RestoreRefundedBillingOrder() error = %v", err)
		}
	}

	var order model.BillingOrder
	if err := db.First(&order, "id = ?", "order-1").Error; err != nil {
		t.Fatal(err)
	}
	if order.Status != model.BillingStatusSettled || order.ActualAmountMicrocredits != 3_000_000 || order.RefundedAmountMicrocredits != 0 || order.RefundedAt != nil || order.ProviderRequestID != "provider-task-1" {
		t.Fatalf("restored order = %#v", order)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-1").Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 6_000_000 || account.ReservedMicrocredits != 0 {
		t.Fatalf("restored account = %#v", account)
	}
	var consumeCount int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ? AND type = ?", "order-1", model.CreditLedgerConsume).Count(&consumeCount).Error; err != nil {
		t.Fatal(err)
	}
	if consumeCount != 1 {
		t.Fatalf("consume ledger count = %d, want 1", consumeCount)
	}
}

func TestRestoreRefundedBillingOrderUsesObservedTokenAmount(t *testing.T) {
	repo, db := newRefundedBillingRecoveryRepository(t)
	now := time.Now()
	if err := db.Create(&model.CreditAccount{UserID: "user-1", AvailableMicrocredits: 100_000}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.BillingOrder{
		ID: "order-1", UserID: "user-1", IdempotencyKey: "task:task-1", TaskID: "task-1",
		Capability: "video", BillingMode: "token", AmountMicrocredits: 1_916_640,
		ReservedAmountMicrocredits: 1_916_640, RefundedAmountMicrocredits: 1_916_640,
		OutputTokenPriceMicrocredits: 16_000_000, MultiplierBasisPoints: 10_000,
		Status: model.BillingStatusRefunded, RefundedAt: &now,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ApiCallLog{
		ID: "poll-log-1", BillingOrderID: "order-1", RequestKind: "poll", Billable: false,
		Status: model.ApiCallStatusSucceeded, UsageAvailable: true, OutputTokens: 108900,
	}).Error; err != nil {
		t.Fatal(err)
	}

	if err := repo.RestoreRefundedBillingOrder("order-1", "provider-task-1"); err != nil {
		t.Fatalf("RestoreRefundedBillingOrder() error = %v", err)
	}

	var order model.BillingOrder
	if err := db.First(&order, "id = ?", "order-1").Error; err != nil {
		t.Fatal(err)
	}
	if order.ActualAmountMicrocredits != 1_742_400 || order.RefundedAmountMicrocredits != 174_240 || order.OutputTokens != 108900 || !order.UsageAvailable {
		t.Fatalf("restored token order = %#v", order)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-1").Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != -1_642_400 {
		t.Fatalf("available balance = %d, want -1642400", account.AvailableMicrocredits)
	}
}
