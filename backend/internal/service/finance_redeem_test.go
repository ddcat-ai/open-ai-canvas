package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRedeemBatchCanBeReviewedAndRecordsAuditIP(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.RedeemBatch{}, &model.RedeemCode{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin-1", Username: "admin", DisplayName: "管理员", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := &model.User{ID: "user-1", Username: "alice", DisplayName: "Alice", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	created, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{AmountMicrocredits: CreditScale, Count: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(created.Codes) != 2 {
		t.Fatalf("created codes = %d", len(created.Codes))
	}
	page, err := svc.AdminRedeemCodePage(admin, created.Batch.ID, "", 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if !page.PlaintextAvailable || len(page.Codes) != 2 || page.Codes[0].Code == "" {
		t.Fatalf("initial code page = %#v", page)
	}
	if _, err := svc.RedeemCredits(user, created.Codes[0], "203.0.113.8"); err != nil {
		t.Fatal(err)
	}
	redeemed, err := svc.AdminRedeemCodePage(admin, created.Batch.ID, "redeemed", 1, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(redeemed.Codes) != 1 || redeemed.Codes[0].RedeemedBy != user.ID || redeemed.Codes[0].RedeemedUsername != user.Username || redeemed.Codes[0].RedeemedIP != "203.0.113.8" || redeemed.Codes[0].RedeemedAt == nil {
		t.Fatalf("redeemed code = %#v", redeemed.Codes)
	}
}
