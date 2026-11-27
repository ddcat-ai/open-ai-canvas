package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestAdminCreateRedeemBatchAllowedCapability(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.User{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}, &model.PaymentOrder{}, &model.RedeemBatch{}, &model.RedeemCode{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	admin := &model.User{ID: "admin-1", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := &model.User{ID: "user-1", Username: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{
		AmountMicrocredits: 10_000_000, Count: 1, AllowedCapability: "audio",
	}); err == nil {
		t.Fatal("expected error for unsupported allowedCapability")
	}

	created, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{
		AmountMicrocredits: 300_000_000,
		Count:              2,
		Note:               "图片体验券",
		OnePerUser:         true,
		AllowedCapability:  model.RedeemCapabilityImage,
	})
	if err != nil {
		t.Fatalf("AdminCreateRedeemBatch() error = %v", err)
	}
	if created.Batch.AllowedCapability != model.RedeemCapabilityImage {
		t.Fatalf("created AllowedCapability = %q, want image", created.Batch.AllowedCapability)
	}

	page, err := svc.AdminRedeemBatchPage(admin, AdminListQuery{Page: 1, Limit: 10})
	if err != nil || len(page.Batches) != 1 || page.Batches[0].AllowedCapability != model.RedeemCapabilityImage {
		t.Fatalf("AdminRedeemBatchPage() got batches=%+v err=%v", page, err)
	}

	account, err := svc.RedeemCredits(user, created.Codes[0], "127.0.0.1")
	if err != nil {
		t.Fatalf("RedeemCredits() error = %v", err)
	}
	if account.ImageAvailableMicrocredits != 300_000_000 || account.AvailableMicrocredits != 0 {
		t.Fatalf("redeemed image account = %+v, want image=300000000 general=0", account)
	}

	wallet, err := svc.Wallet(user, "income", 1, 10)
	if err != nil || len(wallet.Entries) == 0 {
		t.Fatalf("Wallet() entries=%+v err=%v", wallet, err)
	}
	note := wallet.Entries[0].Note
	if !strings.Contains(note, "仅限图片") {
		t.Fatalf("wallet income note = %q, want substring 仅限图片", note)
	}
}
