package repository

import (
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCompletePaymentOrderCreditsExactlyOnce(t *testing.T) {
	repo := newPaymentTestRepository(t, "payment-complete-once")
	order := paymentTestOrder("order-1", "WP-1", "user-1")
	if err := repo.Create(order); err != nil {
		t.Fatal(err)
	}

	completed, credited, err := repo.CompletePaymentOrder(order.ID, "wx-transaction-1", "wechatpay:merchant-1:wx-transaction-1", time.Now(), "SUCCESS", "支付成功")
	if err != nil {
		t.Fatal(err)
	}
	if !credited || completed.Status != model.PaymentOrderSucceeded {
		t.Fatalf("first completion = credited %v, status %s", credited, completed.Status)
	}

	completed, credited, err = repo.CompletePaymentOrder(order.ID, "wx-transaction-1", "wechatpay:merchant-1:wx-transaction-1", time.Now(), "SUCCESS", "支付成功")
	if err != nil {
		t.Fatal(err)
	}
	if credited {
		t.Fatal("duplicate completion credited the account again")
	}

	var account model.CreditAccount
	if err := repo.db.First(&account, "user_id = ?", order.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != order.CreditsMicrocredits {
		t.Fatalf("available credits = %d, want %d", account.AvailableMicrocredits, order.CreditsMicrocredits)
	}
	var ledgerCount int64
	if err := repo.db.Model(&model.CreditLedgerEntry{}).Where("payment_order_id = ?", order.ID).Count(&ledgerCount).Error; err != nil {
		t.Fatal(err)
	}
	if ledgerCount != 1 {
		t.Fatalf("ledger count = %d, want 1", ledgerCount)
	}
}

func TestCompletePaymentOrderRejectsTransactionReuse(t *testing.T) {
	repo := newPaymentTestRepository(t, "payment-transaction-reuse")
	first := paymentTestOrder("order-1", "WP-1", "user-1")
	second := paymentTestOrder("order-2", "WP-2", "user-2")
	if err := repo.Create(first); err != nil {
		t.Fatal(err)
	}
	if err := repo.Create(second); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.CompletePaymentOrder(first.ID, "wx-transaction-1", "wechatpay:merchant-1:wx-transaction-1", time.Now(), "SUCCESS", "支付成功"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.CompletePaymentOrder(second.ID, "wx-transaction-1", "wechatpay:merchant-1:wx-transaction-1", time.Now(), "SUCCESS", "支付成功"); !errors.Is(err, ErrPaymentTransactionConflict) {
		t.Fatalf("second completion error = %v, want transaction conflict", err)
	}
	var secondAccountCount int64
	if err := repo.db.Model(&model.CreditAccount{}).Where("user_id = ?", second.UserID).Count(&secondAccountCount).Error; err != nil {
		t.Fatal(err)
	}
	if secondAccountCount != 0 {
		t.Fatalf("second user account count = %d, want 0 after rollback", secondAccountCount)
	}
}

func TestCreateOrGetPaymentOrderUsesUserIdempotencyKey(t *testing.T) {
	repo := newPaymentTestRepository(t, "payment-idempotency")
	first := paymentTestOrder("order-1", "WP-1", "user-1")
	first.IdempotencyKey = "same-request"
	createdOrder, created, err := repo.CreateOrGetPaymentOrder(first)
	if err != nil || !created {
		t.Fatalf("first create = order %#v, created %v, err %v", createdOrder, created, err)
	}
	duplicate := paymentTestOrder("order-2", "WP-2", "user-1")
	duplicate.IdempotencyKey = first.IdempotencyKey
	existing, created, err := repo.CreateOrGetPaymentOrder(duplicate)
	if err != nil {
		t.Fatal(err)
	}
	if created || existing.ID != first.ID {
		t.Fatalf("duplicate = id %s, created %v; want id %s, false", existing.ID, created, first.ID)
	}
}

func newPaymentTestRepository(t *testing.T, name string) *Repository {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.PaymentOrder{}); err != nil {
		t.Fatal(err)
	}
	return New(db)
}

func paymentTestOrder(id string, outTradeNo string, userID string) *model.PaymentOrder {
	now := time.Now()
	return &model.PaymentOrder{
		ID: id, OutTradeNo: outTradeNo, UserID: userID, IdempotencyKey: id,
		ChannelID: "channel-1", ChannelVersionID: "version-1", ProductID: "product-1",
		ProductNameSnapshot: "100 积分", AmountFen: 100, CreditsMicrocredits: 100_000_000,
		Currency: "CNY", ExpireMinutesSnapshot: 15, ExpiresAt: now.Add(15 * time.Minute),
		Status: model.PaymentOrderPending, CreatedAt: now, UpdatedAt: now,
	}
}
