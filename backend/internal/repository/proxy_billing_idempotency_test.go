package repository

import (
	"errors"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/model"
)

func TestProxyBillingClaimsKeyBeforeReservingCredits(t *testing.T) {
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: "file:proxy-billing-key?mode=memory&cache=shared"}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	repo := &Repository{db: db}
	if err := db.Create(&model.CreditAccount{UserID: "one", AvailableMicrocredits: 10}).Error; err != nil {
		t.Fatal(err)
	}
	makeOrder := func(id, user, key string, amount int64) *model.BillingOrder {
		return &model.BillingOrder{ID: id, UserID: user, IdempotencyKey: key, AmountMicrocredits: amount, Status: model.BillingStatusReserved}
	}
	if err := repo.ReserveProxyBillingOrder(makeOrder("a", "one", "key", 10)); err != nil {
		t.Fatal(err)
	}
	if err := repo.ReserveProxyBillingOrder(makeOrder("b", "one", "key", 10)); !errors.Is(err, ErrBillingDuplicate) {
		t.Fatalf("duplicate = %v", err)
	}
	if err := repo.ReserveProxyBillingOrder(makeOrder("c", "one", "new", 1)); !errors.Is(err, ErrInsufficientCredits) {
		t.Fatalf("insufficient = %v", err)
	}
	var count int64
	if err := db.Model(&model.BillingOrder{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("orders = %d, error = %v", count, err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "two", AvailableMicrocredits: 10}).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.ReserveProxyBillingOrder(makeOrder("d", "two", "key", 10)); err != nil {
		t.Fatalf("other user: %v", err)
	}
}
