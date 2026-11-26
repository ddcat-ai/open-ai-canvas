package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestAdminCreateAndRedeemStorageBatch(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := db.AutoMigrate(
		&model.SystemSetting{}, &model.User{}, &model.CreditAccount{}, &model.CreditLedgerEntry{},
		&model.BillingOrder{}, &model.PaymentOrder{}, &model.RedeemBatch{}, &model.RedeemCode{},
		&model.AdminAuditEvent{}, &model.UserStorageGrant{}, &model.UserStorageState{}, &model.Resource{},
	); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	admin := &model.User{ID: "admin-1", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	userA := &model.User{ID: "user-a", Username: "alice", Role: model.UserRoleUser, Status: model.UserStatusActive}
	userB := &model.User{ID: "user-b", Username: "bob", Role: model.UserRoleUser, Status: model.UserStatusActive}
	for _, record := range []*model.User{admin, userA, userB} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}

	// 非法容量（非整 GB）和超限天数被拒绝。
	if _, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{
		Kind: model.RedeemBatchKindStorage, StorageBytes: 1 << 29, StorageDurationDays: 30, Count: 1,
	}); err == nil {
		t.Fatal("expected error for non-GB storageBytes")
	}
	if _, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{
		Kind: model.RedeemBatchKindStorage, StorageBytes: 10 << 30, StorageDurationDays: 3651, Count: 1,
	}); err == nil {
		t.Fatal("expected error for durationDays > 3650")
	}

	// 创建 10GB · 30天存储批次。
	storageBatch, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{
		Kind:                model.RedeemBatchKindStorage,
		StorageBytes:        10 << 30,
		StorageDurationDays: 30,
		Count:               2,
		Note:                "10G月卡测试",
	})
	if err != nil {
		t.Fatalf("AdminCreateRedeemBatch(storage 30d) error = %v", err)
	}
	if storageBatch.Batch.Kind != model.RedeemBatchKindStorage || storageBatch.Batch.StorageBytes != 10<<30 || storageBatch.Batch.StorageDurationDays != 30 {
		t.Fatalf("unexpected storage batch = %+v", storageBatch.Batch)
	}

	// 再创建一个 20GB 永久存储批次。
	permanentBatch, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{
		Kind:                model.RedeemBatchKindStorage,
		StorageBytes:        20 << 30,
		StorageDurationDays: 0,
		Count:               1,
	})
	if err != nil {
		t.Fatalf("AdminCreateRedeemBatch(storage permanent) error = %v", err)
	}

	// 兑换前先读取存储用量以填充状态缓存，确保兑换后立即刷新失效。
	beforeUsage, err := svc.AccountFileStorageUsage(userA.ID)
	if err != nil {
		t.Fatalf("before AccountFileStorageUsage() error = %v", err)
	}

	redeemed, err := svc.RedeemCredits(userA, storageBatch.Codes[0], "127.0.0.1")
	if err != nil {
		t.Fatalf("RedeemCredits(storage) error = %v", err)
	}
	if redeemed.Kind != model.RedeemBatchKindStorage || redeemed.StorageGrant == nil {
		t.Fatalf("unexpected redeem outcome = %+v", redeemed)
	}
	if redeemed.StorageGrant.Source != model.UserStorageGrantSourceRedeem || redeemed.StorageGrant.Bytes != 10<<30 || redeemed.StorageGrant.DurationDays != 30 || redeemed.StorageGrant.ExpiresAt == nil {
		t.Fatalf("unexpected storage grant = %+v", redeemed.StorageGrant)
	}
	if redeemed.Account.AvailableMicrocredits != 0 {
		t.Fatalf("storage redeem should not touch credit balance: %+v", redeemed.Account)
	}

	afterUsage, err := svc.AccountFileStorageUsage(userA.ID)
	if err != nil {
		t.Fatalf("after AccountFileStorageUsage() error = %v", err)
	}
	if afterUsage.PurchasedBytes != beforeUsage.PurchasedBytes+(10<<30) || afterUsage.TotalBytes != beforeUsage.TotalBytes+(10<<30) {
		t.Fatalf("storage quota did not increase: before=%+v after=%+v", beforeUsage, afterUsage)
	}

	// 另一账号仍可正常兑换第 2 张码。
	if _, err := svc.RedeemCredits(userB, storageBatch.Codes[1], "127.0.0.1"); err != nil {
		t.Fatalf("userB redeem second storage code error = %v", err)
	}

	// 永久存储卡密过期时间应为空。
	permOutcome, err := svc.RedeemCredits(userB, permanentBatch.Codes[0], "127.0.0.1")
	if err != nil {
		t.Fatalf("RedeemCredits(permanent) error = %v", err)
	}
	if permOutcome.StorageGrant == nil || permOutcome.StorageGrant.ExpiresAt != nil || permOutcome.StorageGrant.DurationDays != 0 {
		t.Fatalf("expected permanent storage grant without expiresAt, got %+v", permOutcome.StorageGrant)
	}

	// 关闭积分功能开关后，存储空间卡密仍可兑换，积分卡密应被拒绝。
	creditBatch, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{
		Kind: model.RedeemBatchKindCredits, AmountMicrocredits: CreditScale, Count: 1,
	})
	if err != nil {
		t.Fatalf("AdminCreateRedeemBatch(credits) error = %v", err)
	}
	extraStorageBatch, err := svc.AdminCreateRedeemBatch(admin, CreateRedeemBatchRequest{
		Kind: model.RedeemBatchKindStorage, StorageBytes: 5 << 30, StorageDurationDays: 180, Count: 1,
	})
	if err != nil {
		t.Fatalf("AdminCreateRedeemBatch(extra storage) error = %v", err)
	}
	if err := db.Create(&model.SystemSetting{Key: "feature_availability", ValueJSON: `{"creditsEnabled":false}`}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RedeemCredits(userA, creditBatch.Codes[0], "127.0.0.1"); err == nil || !strings.Contains(err.Error(), "积分") {
		t.Fatalf("expected credits redeem rejected when credits disabled, got err=%v", err)
	}
	disabledCreditsOutcome, err := svc.RedeemCredits(userA, extraStorageBatch.Codes[0], "127.0.0.1")
	if err != nil || disabledCreditsOutcome.Kind != model.RedeemBatchKindStorage {
		t.Fatalf("expected storage redeem to remain allowed when credits disabled, got outcome=%+v err=%v", disabledCreditsOutcome, err)
	}
}
