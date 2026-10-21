package app

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"yingce/backend/internal/invite"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/payment"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type inviteReconciliationProvider struct {
	payment.Provider
	result payment.Result
	err    error
}

func (p *inviteReconciliationProvider) QueryOrder(_ context.Context, _ payment.Config, _ payment.QueryRequest) (payment.Result, error) {
	return p.result, p.err
}

func invitePaymentFixture(t *testing.T, enabled, audit bool) (*Service, *gorm.DB, *model.PaymentOrder) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.User{}, &model.PaymentOrder{},
		&model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.InviteRecord{},
		&model.InviteRewardRecord{}, &model.RewardAccount{}); err != nil {
		t.Fatal(err)
	}
	policy := invite.DefaultInvitePolicy()
	policy.Enabled, policy.Level, policy.AuditEnabled = enabled, 2, audit
	encoded, _ := json.Marshal(policy)
	if err := db.Create(&model.SystemSetting{Key: invite.SettingKey, ValueJSON: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	for _, user := range []model.User{
		{ID: "invitee", Username: "invitee", InviteCode: "AAAA2345", Status: model.UserStatusActive},
		{ID: "l1", Username: "l1", InviteCode: "BBBB2345", Status: model.UserStatusActive},
		{ID: "l2", Username: "l2", InviteCode: "CCCC2345", Status: model.UserStatusActive},
	} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	status := model.InviteRecordApproved
	if audit {
		status = model.InviteRecordPending
	}
	if err := db.Create(&model.InviteRecord{UserID: "invitee", L1InviterID: "l1", L2InviterID: "l2", Status: status}).Error; err != nil {
		t.Fatal(err)
	}
	order := &model.PaymentOrder{
		ID: "order-1", UserID: "invitee", IdempotencyKey: "idem-1",
		MerchantOrderNo: "merchant-1", ProviderID: "provider-1", ProviderConfigID: "config-1", ProviderConfigVersion: 1,
		ProductID: "product-1", ProductName: "Topup", AmountFen: 10_000,
		Currency: "CNY", CreditsMicrocredits: 100_000_000,
		Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(order).Error; err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db, order
}

func TestInvitePaymentReconciliationCreatesRewardsExactlyOnce(t *testing.T) {
	for _, audit := range []bool{false, true} {
		t.Run(map[bool]string{false: "approved", true: "pending"}[audit], func(t *testing.T) {
			svc, db, order := invitePaymentFixture(t, true, audit)
			billDate := time.Date(2026, 10, 12, 0, 0, 0, 0, paymentBillLocation)
			paidAt := billDate.Add(9 * time.Hour)
			record := payment.BillRecord{MerchantOrderNo: order.MerchantOrderNo, ProviderTradeNo: "trade-1",
				AmountFen: order.AmountFen, Currency: order.Currency, PaidAt: paidAt}
			result := payment.Result{MerchantOrderNo: " " + order.MerchantOrderNo + " ", ProviderTradeNo: "trade-1",
				AmountFen: order.AmountFen, Currency: order.Currency, Paid: true, ProviderStatus: "SUCCESS"}
			provider := &inviteReconciliationProvider{result: result}
			run := &model.PaymentReconciliationRun{ID: "run-1", ProviderID: order.ProviderID}
			items, _, recovered, failed, err := svc.comparePaymentReconciliation(
				context.Background(), provider, nil, run, billDate, []payment.BillRecord{record}, nil)
			if err != nil || recovered != 1 || failed != 0 || len(items) != 1 || !items[0].Resolved {
				t.Fatalf("reconciliation items=%+v recovered=%d failed=%d err=%v", items, recovered, failed, err)
			}
			result.MerchantOrderNo, result.PaidAt = order.MerchantOrderNo, paidAt
			if _, err := svc.applyPaymentResult(order.ProviderID, result); err != nil {
				t.Fatal(err)
			}
			var rewards []model.InviteRewardRecord
			if err := db.Order("level").Find(&rewards).Error; err != nil || len(rewards) != 2 {
				t.Fatalf("rewards=%+v err=%v", rewards, err)
			}
			for index, expected := range []int64{5_000_000, 3_000_000} {
				reward := rewards[index]
				account, err := svc.repo.RewardAccount(reward.InviterID)
				if err != nil || reward.AmountMicroYuan != expected || account.TotalMicroYuan != expected {
					t.Fatalf("reward=%+v account=%+v err=%v", reward, account, err)
				}
				if audit && (account.FrozenMicroYuan != expected || reward.Status != model.InviteRewardPending) {
					t.Fatalf("pending reward was not frozen: %+v %+v", reward, account)
				}
				if !audit && (account.AvailableMicroYuan != expected || reward.Status != model.InviteRewardCredited) {
					t.Fatalf("approved reward was not available: %+v %+v", reward, account)
				}
			}
			account, err := svc.repo.CreditAccount(order.UserID)
			if err != nil || account.AvailableMicrocredits != order.CreditsMicrocredits {
				t.Fatalf("duplicate payment changed credits: %+v err=%v", account, err)
			}
		})
	}
}

func TestInviteReconciliationRejectsUnverifiedPayment(t *testing.T) {
	for _, name := range []string{"query_failed", "not_paid", "wrong_amount"} {
		t.Run(name, func(t *testing.T) {
			svc, db, order := invitePaymentFixture(t, true, false)
			result := payment.Result{MerchantOrderNo: order.MerchantOrderNo, ProviderTradeNo: "trade-1",
				AmountFen: order.AmountFen, Currency: order.Currency, Paid: true}
			provider := &inviteReconciliationProvider{result: result}
			switch name {
			case "query_failed":
				provider.err = errors.New("invalid signature")
			case "not_paid":
				provider.result.Paid = false
			case "wrong_amount":
				provider.result.AmountFen++
			}
			record := payment.BillRecord{MerchantOrderNo: order.MerchantOrderNo, ProviderTradeNo: "trade-1",
				AmountFen: order.AmountFen, Currency: order.Currency}
			_, _, recovered, failed, err := svc.comparePaymentReconciliation(context.Background(), provider, nil,
				&model.PaymentReconciliationRun{ID: "run-1", ProviderID: order.ProviderID},
				time.Now(), []payment.BillRecord{record}, nil)
			if err != nil || recovered != 0 || failed != 1 {
				t.Fatalf("recovered=%d failed=%d err=%v", recovered, failed, err)
			}
			for _, entity := range []any{&model.InviteRewardRecord{}, &model.RewardAccount{}, &model.CreditLedgerEntry{}} {
				var count int64
				if err := db.Model(entity).Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("unverified payment changed %T: count=%d err=%v", entity, count, err)
				}
			}
		})
	}
}

func TestInviteDisabledDoesNotGrantRewardsOrAllowWithdrawalsAndTransfers(t *testing.T) {
	svc, db, order := invitePaymentFixture(t, false, false)
	if _, err := svc.applyPaymentResult(order.ProviderID, payment.Result{
		MerchantOrderNo: order.MerchantOrderNo, ProviderTradeNo: "trade-1", AmountFen: order.AmountFen,
		Currency: order.Currency, Paid: true, PaidAt: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.InviteRewardRecord{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("disabled invite granted rewards: count=%d err=%v", count, err)
	}
	user := &model.User{ID: "invitee"}
	if _, err := svc.CreateWithdrawal(user, WithdrawalCreateRequest{AmountFen: 100}); err == nil {
		t.Fatal("default policy allowed withdrawals")
	}
	if _, _, err := svc.CreateTransfer(user, TransferCreateRequest{AmountFen: 100}); err == nil {
		t.Fatal("default policy allowed transfers")
	}
}
