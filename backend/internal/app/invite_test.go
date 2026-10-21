package app

import (
	"encoding/json"
	"math"
	"testing"
	"time"

	"yingce/backend/internal/invite"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestInviteAmountBoundsAndPolicyReadFailure(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	policy := invite.DefaultInvitePolicy()
	policy.Enabled = true
	policy.TransferEnabled = true
	policy.WithdrawEnabled = true
	policy.WithdrawMethods = []string{model.WithdrawMethodWechat}
	encoded, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: invite.SettingKey, ValueJSON: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	user := &model.User{ID: "user-1"}
	tooLarge := int64(math.MaxInt64/10_000 + 1)
	if _, err := svc.CreateWithdrawal(user, WithdrawalCreateRequest{
		AmountFen: tooLarge, Method: model.WithdrawMethodWechat,
		Account: WithdrawAccountInfo{Account: "13800000000", RealName: "Test"},
	}); err == nil {
		t.Fatal("过大提现金额必须拒绝")
	}
	if _, _, err := svc.CreateTransfer(user, TransferCreateRequest{AmountFen: tooLarge}); err == nil {
		t.Fatal("过大划转金额必须拒绝")
	}
	policy.TransferRateMilli = math.MaxInt64
	encoded, _ = json.Marshal(policy)
	if err := db.Model(&model.SystemSetting{}).Where("key = ?", invite.SettingKey).Update("value_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.CreateTransfer(user, TransferCreateRequest{AmountFen: 100}); err == nil {
		t.Fatal("兑换积分溢出必须拒绝")
	}
	if err := db.Model(&model.SystemSetting{}).Where("key = ?", invite.SettingKey).Update("value_json", "{").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.inviteRewardInstructionForOrder(&model.PaymentOrder{UserID: user.ID, AmountFen: 100}); err == nil {
		t.Fatal("邀请策略读取失败时不能跳过奖励继续支付")
	}
}

func TestInviteOverviewReflectsSuccessfulPayment(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.User{}, &model.InviteRecord{},
		&model.RewardAccount{}, &model.InviteRewardRecord{}, &model.PaymentOrder{},
		&model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
		t.Fatal(err)
	}
	inviter := &model.User{ID: "inviter", Username: "inviter", InviteCode: "AAAA2345", Status: model.UserStatusActive}
	invitee := &model.User{ID: "invitee", Username: "invitee", InviteCode: "BBBB2345", Status: model.UserStatusActive}
	for _, user := range []*model.User{inviter, invitee} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := &Service{repo: repository.New(db)}
	policy := invite.DefaultInvitePolicy()
	policy.Enabled = true
	encoded, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: invite.SettingKey, ValueJSON: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	if _, attached, err := svc.repo.AttachInviteRecord(invitee.ID, inviter.InviteCode, policy); err != nil || !attached {
		t.Fatalf("attach: %v", err)
	}
	order := &model.PaymentOrder{
		ID: "order-1", UserID: invitee.ID, IdempotencyKey: "idem-1", MerchantOrderNo: "merchant-1",
		ProductID: "product-1", ProductName: "充值", ProviderID: "wechat-native", ProviderConfigID: "config-1",
		ProviderConfigVersion: 1, AmountFen: 10_000, Currency: "CNY", CreditsMicrocredits: 100_000_000,
		Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(order).Error; err != nil {
		t.Fatal(err)
	}
	instruction, err := svc.inviteRewardInstructionForOrder(order)
	if err != nil || instruction == nil {
		t.Fatalf("instruction: %+v err=%v", instruction, err)
	}
	evidence := repository.PaymentEvidence{ProviderTradeNo: "trade-1", ProviderStatus: "SUCCESS",
		AmountFen: order.AmountFen, Currency: "CNY", PaidAt: time.Now()}
	if _, granted, err := svc.repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, evidence, instruction); err != nil || !granted {
		t.Fatalf("complete payment: granted=%v err=%v", granted, err)
	}
	view, err := svc.InviteOverview(inviter)
	if err != nil {
		t.Fatal(err)
	}
	if view.Account.TotalMicroYuan != 5_000_000 || view.Account.AvailableMicroYuan != 5_000_000 ||
		view.Account.FrozenMicroYuan != 0 || view.Account.TodayRewardMicroYuan != 5_000_000 {
		t.Fatalf("支付奖励未到用户概览: %+v", view.Account)
	}
	if _, granted, err := svc.repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, evidence, instruction); err != nil || granted {
		t.Fatalf("重复支付通知不得重复奖励: granted=%v err=%v", granted, err)
	}
}
