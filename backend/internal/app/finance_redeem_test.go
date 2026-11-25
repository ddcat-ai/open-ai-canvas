package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestRedeemBatchCanBeReviewedAndRecordsAuditIP(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.User{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.RedeemBatch{}, &model.RedeemCode{}, &model.AdminAuditEvent{}); err != nil {
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

func TestRedeemBatchOnePerUserLimit(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.User{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.RedeemBatch{}, &model.RedeemCode{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin-1", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	userA := &model.User{ID: "user-a", Username: "alice", Role: model.UserRoleUser, Status: model.UserStatusActive}
	userB := &model.User{ID: "user-b", Username: "bob", Role: model.UserRoleUser, Status: model.UserStatusActive}
	for _, record := range []*model.User{admin, userA, userB} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}

	limited, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{AmountMicrocredits: CreditScale, Count: 2, OnePerUser: true})
	if err != nil {
		t.Fatal(err)
	}
	if !limited.Batch.OnePerUser {
		t.Fatalf("expected OnePerUser=true on created batch")
	}
	if _, err := svc.RedeemCredits(userA, limited.Codes[0], "127.0.0.1"); err != nil {
		t.Fatalf("first redeem failed: %v", err)
	}
	if _, err := svc.RedeemCredits(userA, limited.Codes[1], "127.0.0.1"); err == nil {
		t.Fatalf("expected second redeem in same limited batch to be rejected")
	}
	// 第二张码未被作废，另一个账号仍可正常兑换。
	if _, err := svc.RedeemCredits(userB, limited.Codes[1], "127.0.0.1"); err != nil {
		t.Fatalf("other user should still redeem unused code: %v", err)
	}

	unlimited, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{AmountMicrocredits: CreditScale, Count: 2, OnePerUser: false})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RedeemCredits(userA, unlimited.Codes[0], "127.0.0.1"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RedeemCredits(userA, unlimited.Codes[1], "127.0.0.1"); err != nil {
		t.Fatalf("unlimited batch should allow multiple redemptions per user: %v", err)
	}
}
