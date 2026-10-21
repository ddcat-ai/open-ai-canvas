package app

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/invite"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestInviteWithdrawalAccountsAndListsRemainScopedToOwner(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.SystemSetting{}, &model.AdminAuditEvent{},
		&model.RewardAccount{}, &model.WithdrawRequest{}, &model.WithdrawAccount{},
		&model.InviteRecord{}, &model.InviteRewardRecord{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	if err := os.WriteFile(filepath.Join(svc.dataDir, ".settings-key"), make([]byte, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	owner := &model.User{ID: "owner", Username: "owner", Role: model.UserRoleUser, Status: model.UserStatusActive}
	other := &model.User{ID: "other", Username: "other", Role: model.UserRoleUser, Status: model.UserStatusActive}
	for _, user := range []*model.User{admin, owner, other} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	policy := invite.DefaultInvitePolicy()
	policy.WithdrawEnabled = true
	policy.WithdrawMethods = []string{model.WithdrawMethodWechat}
	if _, err := svc.UpdateInviteSetting(admin, policy); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RewardAccount{UserID: owner.ID, TotalMicroYuan: 5_000_000, AvailableMicroYuan: 5_000_000}).Error; err != nil {
		t.Fatal(err)
	}
	info := WithdrawAccountInfo{Account: "account-test", RealName: "Test Name"}
	request, err := svc.CreateWithdrawal(owner, WithdrawalCreateRequest{AmountFen: 100, Method: model.WithdrawMethodWechat, Account: info, SaveAccount: true})
	if err != nil {
		t.Fatal(err)
	}
	if saved, err := svc.GetWithdrawAccount(owner); err != nil || saved == nil || saved.Info.Account != info.Account {
		t.Fatalf("owner saved account=%+v err=%v", saved, err)
	}
	if saved, err := svc.GetWithdrawAccount(other); err != nil || saved != nil {
		t.Fatalf("other saw owner account=%+v err=%v", saved, err)
	}
	list, err := svc.UserWithdrawals(other, 1, 20)
	if err != nil || list.Total != 0 {
		t.Fatalf("other saw owner withdrawal=%+v err=%v", list, err)
	}
	if _, err := svc.AdminWithdrawalDetail(other, request.ID); err == nil {
		t.Fatal("non-admin could decrypt withdrawal account")
	}
	if _, err := svc.ApproveWithdrawal(other, request.ID); err == nil {
		t.Fatal("non-admin could approve withdrawal")
	}
	if _, err := svc.RejectWithdrawal(other, request.ID, "Rejected"); err == nil {
		t.Fatal("non-admin could refund withdrawal")
	}
	for _, err := range []error{
		func() error { _, err := svc.AdminInviteSetting(other); return err }(),
		func() error { _, err := svc.UpdateInviteSetting(other, policy); return err }(),
		func() error { _, err := svc.AdminInviteRecordsPage(other, AdminInviteListQuery{}); return err }(),
		func() error { _, err := svc.AdminInviteRecordDetail(other, owner.ID); return err }(),
		func() error { _, err := svc.ApproveInviteRecord(other, owner.ID); return err }(),
		func() error { _, err := svc.FreezeInviteRecord(other, owner.ID); return err }(),
		func() error {
			_, err := svc.UpdateInviteInviters(other, owner.ID, InviteInvitersUpdateRequest{})
			return err
		}(),
		svc.DeleteInviteRecord(other, owner.ID),
		func() error { _, err := svc.AdminWithdrawalsPage(other, AdminWithdrawListQuery{}); return err }(),
	} {
		if err == nil {
			t.Fatal("invite administration lacked a service-level admin check")
		}
	}
	list, err = svc.UserWithdrawals(owner, 1, 20)
	if err != nil || list.Total != 1 {
		t.Fatalf("owner withdrawals=%+v err=%v", list, err)
	}
	encoded, _ := json.Marshal(list)
	if strings.Contains(string(encoded), "cipher") || strings.Contains(string(encoded), info.Account) {
		t.Fatalf("withdrawal list leaked payment account: %s", encoded)
	}
	var stored model.WithdrawRequest
	if err := db.Where("id = ?", request.ID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.AccountCipher == "" || strings.Contains(stored.AccountCipher, info.Account) {
		t.Fatal("withdrawal payment account was not encrypted at rest")
	}
	detail, err := svc.AdminWithdrawalDetail(admin, request.ID)
	if err != nil || detail.Account.Account != info.Account {
		t.Fatalf("admin withdrawal detail=%+v err=%v", detail, err)
	}
	if _, err := svc.RejectWithdrawal(admin, request.ID, "Details incomplete"); err != nil {
		t.Fatal(err)
	}
	account, err := svc.repo.RewardAccount(owner.ID)
	if err != nil || account.AvailableMicroYuan != 5_000_000 || account.FrozenMicroYuan != 0 {
		t.Fatalf("rejected withdrawal balance=%+v err=%v", account, err)
	}
	var audit model.AdminAuditEvent
	if err := db.Where("action = ?", "withdraw.reject").First(&audit).Error; err != nil || audit.ActorUserID != admin.ID || audit.CreatedAt.After(time.Now()) {
		t.Fatalf("withdrawal audit=%+v err=%v", audit, err)
	}
	if _, err := svc.ApproveWithdrawal(admin, request.ID); err == nil {
		t.Fatal("reviewed withdrawal could be approved a second time")
	}
}
