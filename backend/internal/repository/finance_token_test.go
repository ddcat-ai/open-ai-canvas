package repository

import (
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestTokenUsageAmountSettlesArkVideoCompletionTokens(t *testing.T) {
	amount, err := tokenUsageAmount(model.BillingOrder{
		Capability:                   "video",
		OutputTokenPriceMicrocredits: 16_000_000,
		MultiplierBasisPoints:        10_000,
	}, &BillingUsage{OutputTokens: 108900})
	if err != nil {
		t.Fatalf("tokenUsageAmount() error = %v", err)
	}
	if amount != 1_742_400 {
		t.Fatalf("tokenUsageAmount() = %d", amount)
	}
}

func TestBillingUsageReadsAsyncVideoPollUsage(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:finance-token-poll?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ApiCallLog{
		ID: "poll-log-1", BillingOrderID: "order-1", RequestKind: "poll", Billable: false,
		Status: model.ApiCallStatusSucceeded, UsageAvailable: true, OutputTokens: 108900,
	}).Error; err != nil {
		t.Fatal(err)
	}
	usage, err := billingUsage(db, "order-1")
	if err != nil {
		t.Fatalf("billingUsage() error = %v", err)
	}
	if usage.OutputTokens != 108900 {
		t.Fatalf("billingUsage() = %#v", usage)
	}
}

func TestTokenUsageAmountRejectsVideoWithoutOutputUsage(t *testing.T) {
	_, err := tokenUsageAmount(model.BillingOrder{Capability: "video", OutputTokenPriceMicrocredits: 16_000_000, MultiplierBasisPoints: 10_000}, &BillingUsage{})
	if !errors.Is(err, ErrBillingUsageUnavailable) {
		t.Fatalf("tokenUsageAmount() error = %v", err)
	}
}

func TestSettleArkVideoTokenOrderFromPollUsage(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:finance-token-settle?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.ApiCallLog{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	const reserved = int64(1_916_640)
	if err := db.Create(&model.CreditAccount{UserID: "user-1", ReservedMicrocredits: reserved}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.BillingOrder{
		ID: "order-1", UserID: "user-1", IdempotencyKey: "task:task-1", Capability: "video", BillingMode: "token",
		AmountMicrocredits: reserved, ReservedAmountMicrocredits: reserved, OutputTokenPriceMicrocredits: 16_000_000,
		MultiplierBasisPoints: 10_000, Status: model.BillingStatusRunning,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ApiCallLog{
		ID: "poll-log-1", BillingOrderID: "order-1", RequestKind: "poll", Billable: false,
		Status: model.ApiCallStatusSucceeded, UsageAvailable: true, OutputTokens: 108900,
	}).Error; err != nil {
		t.Fatal(err)
	}

	repo := &Repository{db: db}
	if err := repo.SettleBillingOrder("order-1", "ark-task-1"); err != nil {
		t.Fatalf("SettleBillingOrder() error = %v", err)
	}
	var order model.BillingOrder
	if err := db.First(&order, "id = ?", "order-1").Error; err != nil {
		t.Fatal(err)
	}
	if order.Status != model.BillingStatusSettled || order.ActualAmountMicrocredits != 1_742_400 || order.RefundedAmountMicrocredits != 174_240 {
		t.Fatalf("settled order = %#v", order)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-1").Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 174_240 || account.ReservedMicrocredits != 0 {
		t.Fatalf("settled account = %#v", account)
	}
}

func TestSettleArkVideoTokenOrderSupplementsUnderreservation(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:finance-token-supplement?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.ApiCallLog{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	const (
		reserved   = int64(3_049_738)
		actual     = int64(3_115_222)
		supplement = actual - reserved
	)
	if err := db.Create(&model.CreditAccount{UserID: "user-1", AvailableMicrocredits: 1_000_000, ReservedMicrocredits: reserved}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.BillingOrder{
		ID: "order-1", UserID: "user-1", IdempotencyKey: "task:task-1", Capability: "video", BillingMode: "token",
		AmountMicrocredits: reserved, ReservedAmountMicrocredits: reserved, OutputTokenPriceMicrocredits: 18_200_000,
		MultiplierBasisPoints: 10_000, Status: model.BillingStatusRunning,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ApiCallLog{
		ID: "poll-log-1", BillingOrderID: "order-1", RequestKind: "poll", Billable: false,
		Status: model.ApiCallStatusSucceeded, UsageAvailable: true, OutputTokens: 171_166,
	}).Error; err != nil {
		t.Fatal(err)
	}

	repo := &Repository{db: db}
	if err := repo.SettleBillingOrder("order-1", "ark-task-1"); err != nil {
		t.Fatalf("SettleBillingOrder() error = %v", err)
	}
	var order model.BillingOrder
	if err := db.First(&order, "id = ?", "order-1").Error; err != nil {
		t.Fatal(err)
	}
	if order.Status != model.BillingStatusSettled || order.ActualAmountMicrocredits != actual || order.OutputTokens != 171_166 || !order.UsageAvailable {
		t.Fatalf("settled order = %#v", order)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-1").Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 1_000_000-supplement || account.ReservedMicrocredits != 0 {
		t.Fatalf("settled account = %#v", account)
	}
	var entry model.CreditLedgerEntry
	if err := db.First(&entry, "billing_order_id = ? AND type = ?", "order-1", model.CreditLedgerConsume).Error; err != nil {
		t.Fatal(err)
	}
	if entry.AmountMicrocredits != -actual || entry.AvailableDeltaMicrocredits != -supplement || entry.ReservedDeltaMicrocredits != -reserved {
		t.Fatalf("consume entry = %#v", entry)
	}
}

func TestSettleArkVideoTokenOrderAllowsNegativeBalance(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:finance-token-negative-balance?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.ApiCallLog{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	const reserved = int64(3_049_738)
	if err := db.Create(&model.CreditAccount{UserID: "user-1", AvailableMicrocredits: 10_000, ReservedMicrocredits: reserved}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.BillingOrder{
		ID: "order-1", UserID: "user-1", IdempotencyKey: "task:task-1", Capability: "video", BillingMode: "token",
		AmountMicrocredits: reserved, ReservedAmountMicrocredits: reserved, OutputTokenPriceMicrocredits: 18_200_000,
		MultiplierBasisPoints: 10_000, Status: model.BillingStatusRunning,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ApiCallLog{
		ID: "poll-log-1", BillingOrderID: "order-1", RequestKind: "poll", Billable: false,
		Status: model.ApiCallStatusSucceeded, UsageAvailable: true, OutputTokens: 171_166,
	}).Error; err != nil {
		t.Fatal(err)
	}

	repo := &Repository{db: db}
	err = repo.SettleBillingOrder("order-1", "ark-task-1")
	if err != nil {
		t.Fatalf("SettleBillingOrder() error = %v", err)
	}
	var order model.BillingOrder
	if err := db.First(&order, "id = ?", "order-1").Error; err != nil {
		t.Fatal(err)
	}
	if order.Status != model.BillingStatusSettled || order.ActualAmountMicrocredits != 3_115_222 || order.OutputTokens != 171_166 || !order.UsageAvailable {
		t.Fatalf("settled order = %#v", order)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-1").Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != -55_484 || account.ReservedMicrocredits != 0 {
		t.Fatalf("settled account = %#v", account)
	}
	var entry model.CreditLedgerEntry
	if err := db.First(&entry, "billing_order_id = ? AND type = ?", "order-1", model.CreditLedgerConsume).Error; err != nil {
		t.Fatal(err)
	}
	if entry.AvailableAfterMicrocredits != -55_484 || entry.AvailableDeltaMicrocredits != -65_484 {
		t.Fatalf("consume entry = %#v", entry)
	}
}

func TestNegativeBalanceBlocksNewReservationsAndAcceptsRepayment(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:finance-negative-balance-repayment?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "user-1", AvailableMicrocredits: -1_000_000}).Error; err != nil {
		t.Fatal(err)
	}

	repo := &Repository{db: db}
	order := model.BillingOrder{
		ID: "order-1", UserID: "user-1", IdempotencyKey: "task:task-1",
		AmountMicrocredits: 1, ReservedAmountMicrocredits: 1, Status: model.BillingStatusReserved,
	}
	if err := repo.ReserveBillingOrder(&order); !errors.Is(err, ErrInsufficientCredits) {
		t.Fatalf("ReserveBillingOrder() error = %v", err)
	}

	account, err := repo.AdjustCredits("user-1", "admin-1", 100_000_000, "充值入账")
	if err != nil {
		t.Fatalf("AdjustCredits() error = %v", err)
	}
	if account.AvailableMicrocredits != 99_000_000 {
		t.Fatalf("available balance = %d", account.AvailableMicrocredits)
	}
}
