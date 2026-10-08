package repository

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func TestAudioBillingAmountRoundsUp(t *testing.T) {
	amount, err := audioBillingAmount(100, 3, 10_000)
	if err != nil || amount != 300 {
		t.Fatalf("audioBillingAmount() = %d, %v; want 300", amount, err)
	}
}

func TestSettleAudioPerSecondOrderUsesMeasuredDuration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:finance-audio-settle?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "user-audio", AvailableMicrocredits: 1_000, ReservedMicrocredits: 100}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.BillingOrder{
		ID: "audio-order", UserID: "user-audio", IdempotencyKey: "audio-task", Capability: "audio", BillingMode: "per_second",
		UnitPriceMicrocredits: 100, MultiplierBasisPoints: 10_000, Quantity: 1, AmountMicrocredits: 100,
		BillingCostSnapshot:        model.BillingCostSnapshot{CostBillingMode: "per_second", CostQuantity: 1},
		ReservedAmountMicrocredits: 100, Status: model.BillingStatusRunning,
	}).Error; err != nil {
		t.Fatal(err)
	}

	repo := &Repository{db: db}
	if err := repo.SettleBillingOrderWithAudioDuration("audio-order", "", 2_100); err != nil {
		t.Fatalf("SettleBillingOrderWithAudioDuration() error = %v", err)
	}
	var order model.BillingOrder
	if err := db.First(&order, "id = ?", "audio-order").Error; err != nil {
		t.Fatal(err)
	}
	if order.Status != model.BillingStatusSettled || order.Quantity != 3 || order.ActualAmountMicrocredits != 300 || order.RefundedAmountMicrocredits != 0 || order.CostQuantity != 3 {
		t.Fatalf("settled audio order = %#v", order)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-audio").Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 800 || account.ReservedMicrocredits != 0 {
		t.Fatalf("settled audio account = %#v; want available=800 reserved=0", account)
	}
}

func TestSettleAudioPerSecondOrderRequiresMeasuredDuration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:finance-audio-duration-required?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "user-audio", ReservedMicrocredits: 100}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.BillingOrder{
		ID: "audio-order", UserID: "user-audio", IdempotencyKey: "audio-task", Capability: "audio", BillingMode: "per_second",
		UnitPriceMicrocredits: 100, MultiplierBasisPoints: 10_000, Quantity: 1, AmountMicrocredits: 100,
		ReservedAmountMicrocredits: 100, Status: model.BillingStatusRunning,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := (&Repository{db: db}).SettleBillingOrderWithAudioDuration("audio-order", "", 0); err == nil {
		t.Fatal("expected missing duration to fail")
	}
}
