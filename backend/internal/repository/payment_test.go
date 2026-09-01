package repository

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestConfirmRechargePaidCreditsExactlyOnce(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:recharge-credit-once?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.CreditRechargeOrder{}, &model.PaymentNotificationEvent{}); err != nil {
		t.Fatal(err)
	}
	order := model.CreditRechargeOrder{
		ID: "recharge-1", UserID: "user-1", IdempotencyKey: "idempotency-1", PackageID: "package-1", PackageName: "10 元套餐",
		Currency: "CNY", AmountFen: 1000, BaseMicrocredits: 10_000_000, BonusMicrocredits: 2_000_000, TotalMicrocredits: 12_000_000,
		ChannelID: "channel-1", Provider: "wechatpay", Method: "native", ConfigVersionID: "config-1", Status: model.CreditRechargeOrderAwaitingPayment,
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	first, err := repo.ConfirmRechargePaid(order.ID, "wechat-transaction-1", 1000, "CNY", time.Now().UTC(), "")
	if err != nil {
		t.Fatal(err)
	}
	if !first.NewlyCredited || first.Account.AvailableMicrocredits != 12_000_000 || first.Order.Status != model.CreditRechargeOrderCredited {
		t.Fatalf("first credit result = %#v", first)
	}
	second, err := repo.ConfirmRechargePaid(order.ID, "wechat-transaction-1", 1000, "CNY", time.Now().UTC(), "")
	if err != nil {
		t.Fatal(err)
	}
	if second.NewlyCredited || second.Account.AvailableMicrocredits != 12_000_000 {
		t.Fatalf("duplicate credit result = %#v", second)
	}
	var ledgerCount int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("recharge_order_id = ?", order.ID).Count(&ledgerCount).Error; err != nil {
		t.Fatal(err)
	}
	if ledgerCount != 1 {
		t.Fatalf("recharge ledger count = %d, want 1", ledgerCount)
	}
}

func TestConfirmRechargePaidRejectsAmountMismatch(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:recharge-amount-mismatch?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.CreditRechargeOrder{}); err != nil {
		t.Fatal(err)
	}
	order := model.CreditRechargeOrder{ID: "recharge-2", UserID: "user-2", IdempotencyKey: "idempotency-2", Currency: "CNY", AmountFen: 1000, TotalMicrocredits: 10_000_000, Provider: "wechatpay", Status: model.CreditRechargeOrderAwaitingPayment}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := New(db).ConfirmRechargePaid(order.ID, "wechat-transaction-2", 999, "CNY", time.Now().UTC(), ""); err != ErrRechargePaymentMismatch {
		t.Fatalf("ConfirmRechargePaid() error = %v", err)
	}
	var accountCount int64
	if err := db.Model(&model.CreditAccount{}).Count(&accountCount).Error; err != nil {
		t.Fatal(err)
	}
	if accountCount != 0 {
		t.Fatalf("credit account count = %d, want 0", accountCount)
	}
}
