package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCreditPolicyDefaultsDoNotGrantRewards(t *testing.T) {
	db := newBulkUserTestDB(t)
	svc := &Service{repo: repository.New(db)}
	policy, err := svc.creditPolicy()
	if err != nil {
		t.Fatal(err)
	}
	if policy.SignupBonusMicrocredits != 0 || policy.CheckinBonusMicrocredits != 0 || policy.DefaultMultiplierBPS != 10_000 {
		t.Fatalf("default policy = %+v", policy)
	}
	user := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if err := svc.ensureSignupBonus(user.ID); err != nil {
		t.Fatal(err)
	}
	if _, granted, err := svc.CheckinCredits(user); err == nil || granted {
		t.Fatalf("default checkin: granted=%t err=%v", granted, err)
	}
	var count int64
	if err := db.Model(&model.CreditLedgerEntry{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("default reward entries = %d, want 0", count)
	}
}

func TestCreditPolicyExplicitRewardsRemainIdempotent(t *testing.T) {
	db := newBulkUserTestDB(t)
	svc := &Service{repo: repository.New(db)}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	policy := defaultCreditPolicy()
	policy.SignupBonusMicrocredits = 2 * CreditScale
	policy.CheckinBonusMicrocredits = CreditScale / 2
	if _, err := svc.UpdateCreditPolicy(admin, policy); err != nil {
		t.Fatal(err)
	}
	user := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	for i := 0; i < 2; i++ {
		if err := svc.ensureSignupBonus(user.ID); err != nil {
			t.Fatal(err)
		}
		if _, granted, err := svc.CheckinCredits(user); err != nil || granted != (i == 0) {
			t.Fatalf("checkin %d: granted=%t err=%v", i, granted, err)
		}
	}
	account, err := svc.repo.CreditAccount(user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 5*CreditScale/2 {
		t.Fatalf("balance = %d, want %d", account.AvailableMicrocredits, 5*CreditScale/2)
	}
	var count int64
	if err := db.Model(&model.CreditLedgerEntry{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("reward entries = %d, want 2", count)
	}
}

func TestCreditPolicyStopRewardsReachesOtherInstancesWithoutChangingBalances(t *testing.T) {
	db := newBulkUserTestDB(t)
	writer := &Service{repo: repository.New(db)}
	reader := &Service{repo: repository.New(db)}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	policy := defaultCreditPolicy()
	policy.SignupBonusMicrocredits = 100 * CreditScale
	policy.CheckinBonusMicrocredits = 10 * CreditScale
	policy.DefaultMultiplierBPS = 12_000
	policy.ModelMultiplierBPS["model"] = 15_000
	if _, err := writer.UpdateCreditPolicy(admin, policy); err != nil {
		t.Fatal(err)
	}
	historical := &model.User{ID: "historical", Role: model.UserRoleUser}
	if _, _, err := reader.repo.GrantCreditsOnce(historical.ID, model.CreditLedgerPaymentTopup, 25*CreditScale, "payment:historical", "paid credits"); err != nil {
		t.Fatal(err)
	}
	if err := reader.ensureSignupBonus(historical.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := reader.CheckinCredits(historical); err != nil {
		t.Fatal(err)
	}
	before, err := reader.repo.CreditAccount(historical.ID)
	if err != nil {
		t.Fatal(err)
	}
	policy.SignupBonusMicrocredits = 0
	policy.CheckinBonusMicrocredits = 0
	if _, err := writer.UpdateCreditPolicy(admin, policy); err != nil {
		t.Fatal(err)
	}
	unclaimed := &model.User{ID: "unclaimed", Role: model.UserRoleUser}
	if err := reader.ensureSignupBonus(unclaimed.ID); err != nil {
		t.Fatal(err)
	}
	if _, granted, err := reader.CheckinCredits(unclaimed); err == nil || granted {
		t.Fatalf("stopped checkin: granted=%t err=%v", granted, err)
	}
	public, err := reader.publicCreditPolicy(unclaimed.ID)
	if err != nil || public.SignupBonusMicrocredits != 0 || public.CheckinBonusMicrocredits != 0 {
		t.Fatalf("public policy = %+v, err=%v", public, err)
	}
	current, err := reader.AdminCreditPolicy(admin)
	if err != nil || current.DefaultMultiplierBPS != 12_000 || current.ModelMultiplierBPS["model"] != 15_000 {
		t.Fatalf("multipliers changed: %+v, err=%v", current, err)
	}
	after, err := reader.repo.CreditAccount(historical.ID)
	if err != nil {
		t.Fatal(err)
	}
	if *before != *after || after.AvailableMicrocredits != 135*CreditScale {
		t.Fatalf("historical account changed: before=%+v after=%+v", before, after)
	}
	var count int64
	if err := db.Model(&model.CreditLedgerEntry{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("ledger entries = %d, want unchanged 3", count)
	}
}

func TestCreditPolicyDeletedSettingDoesNotRestoreOldRewards(t *testing.T) {
	db := newBulkUserTestDB(t)
	svc := &Service{repo: repository.New(db)}
	policy := defaultCreditPolicy()
	policy.SignupBonusMicrocredits = 100 * CreditScale
	encoded, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: creditPolicySettingKey, ValueJSON: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.creditPolicy(); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.DeleteSystemSetting(creditPolicySettingKey); err != nil {
		t.Fatal(err)
	}
	if err := svc.ensureSignupBonus("user"); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.CreditLedgerEntry{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("reward entries after deleting policy = %d, want 0", count)
	}
}

func TestCreditPolicyInvalidConfigurationDoesNotGrantRewards(t *testing.T) {
	for _, value := range []string{`{`, `{"signupBonusMicrocredits":100000000,"defaultMultiplierBasisPoints":0}`} {
		t.Run(value, func(t *testing.T) {
			db := newBulkUserTestDB(t)
			svc := &Service{repo: repository.New(db)}
			if err := db.Create(&model.SystemSetting{Key: creditPolicySettingKey, ValueJSON: value}).Error; err != nil {
				t.Fatal(err)
			}
			if err := svc.ensureSignupBonus("user"); err == nil {
				t.Fatal("invalid reward policy did not fail")
			}
			var count int64
			if err := db.Model(&model.CreditLedgerEntry{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf("invalid policy created %d entries", count)
			}
		})
	}
}
