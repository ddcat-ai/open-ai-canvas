package repository

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/model"
)

func imageBillingTestRepo(t *testing.T) (*Repository, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.New(sqlite.Config{DriverName: "sqlite", DSN: "file:" + newRepositoryID() + "?mode=memory&cache=shared"}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CreditAccount{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "image-user", AvailableMicrocredits: 10_000_000}).Error; err != nil {
		t.Fatal(err)
	}
	return &Repository{db: db}, db
}

func imageTestOrder() *model.BillingOrder {
	return &model.BillingOrder{ID: "image-order", UserID: "image-user", IdempotencyKey: "image-test", Capability: "image", BillingMode: "image_usage", MultiplierBasisPoints: 10_000, AmountMicrocredits: 2_350_000, ReservedAmountMicrocredits: 2_350_000, ImageInputImages: 1, ImageMaxOutputImages: 10, Status: model.BillingStatusReserved, ImagePricing: &model.ImagePricing{InputPriceMicrocredits: 50_000, OutputTiers: []model.ImagePriceTier{{MaxPixels: 2_610_000, UnitPriceMicrocredits: 130_000}, {MaxPixels: 4_630_000, UnitPriceMicrocredits: 230_000}}}}
}

func TestImageBillingPersistsUsageRefundsDifferenceAndIsIdempotent(t *testing.T) {
	repo, db := imageBillingTestRepo(t)
	order := imageTestOrder()
	if err := repo.ReserveBillingOrder(order); err != nil {
		t.Fatal(err)
	}
	usage := &model.ImageBillingUsage{InputImages: 1, Source: "provider", Outputs: []model.ImageOutputUsage{{Index: 0, Width: 2048, Height: 2048}, {Index: 1, Width: 1024, Height: 1024}}}
	if err := repo.RecordImageBillingUsage(order.ID, usage); err != nil {
		t.Fatal(err)
	}
	if err := repo.RecordImageBillingUsage(order.ID, usage); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := repo.SettleBillingOrder(order.ID, "official-request"); err != nil {
			t.Fatal(err)
		}
	}
	var saved model.BillingOrder
	if err := db.First(&saved, "id = ?", order.ID).Error; err != nil {
		t.Fatal(err)
	}
	if saved.ActualAmountMicrocredits != 410_000 || saved.RefundedAmountMicrocredits != 1_940_000 || saved.Quantity != 2 || saved.ImageUsage == nil || saved.ImagePricing == nil {
		t.Fatalf("order=%#v", saved)
	}
	var account model.CreditAccount
	db.First(&account, "user_id = ?", order.UserID)
	if account.AvailableMicrocredits != 9_590_000 || account.ReservedMicrocredits != 0 {
		t.Fatalf("account=%#v", account)
	}
	var count int64
	db.Model(&model.CreditLedgerEntry{}).Where("billing_order_id = ? AND type = ?", order.ID, model.CreditLedgerConsume).Count(&count)
	if count != 1 {
		t.Fatalf("consume entries=%d", count)
	}
	usage.InputImages = 2
	if err := repo.RecordImageBillingUsage(order.ID, usage); err == nil {
		t.Fatal("overwrote immutable usage")
	}
}

func TestImageBillingUnknownUsageAndExceededAuthorizationDoNotCharge(t *testing.T) {
	for _, capped := range []bool{false, true} {
		repo, db := imageBillingTestRepo(t)
		order := imageTestOrder()
		if capped {
			order.ChargeLimitSet, order.ChargeLimitMicrocredits = true, order.AmountMicrocredits
		}
		if err := repo.ReserveBillingOrder(order); err != nil {
			t.Fatal(err)
		}
		if capped {
			usage := &model.ImageBillingUsage{InputImages: 2, Outputs: []model.ImageOutputUsage{{Width: 2048, Height: 2048}}, Source: "provider"}
			if err := repo.RecordImageBillingUsage(order.ID, usage); err != nil {
				t.Fatal(err)
			}
		}
		if err := repo.SettleBillingOrder(order.ID, ""); err == nil {
			t.Fatal("invalid usage settled")
		}
		var account model.CreditAccount
		db.First(&account, "user_id = ?", order.UserID)
		if account.AvailableMicrocredits != 7_650_000 || account.ReservedMicrocredits != 2_350_000 {
			t.Fatalf("account changed on failed settlement: %#v", account)
		}
	}
}
