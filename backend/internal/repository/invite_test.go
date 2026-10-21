package repository

import (
	"encoding/json"
	"errors"
	"math"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/invite"
	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func openInviteTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared&_busy_timeout=5000"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.User{}, &model.InviteRecord{}, &model.RewardAccount{}, &model.InviteRewardRecord{},
		&model.WithdrawRequest{}, &model.WithdrawAccount{}, &model.TransferRecord{},
		&model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.PaymentOrder{}, &model.SystemSetting{},
	); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.Exec("CREATE UNIQUE INDEX idx_users_invite_code ON users(invite_code) WHERE invite_code <> ''").Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func createInviteUser(t *testing.T, db *gorm.DB, id, username, code string) {
	t.Helper()
	user := model.User{ID: id, Username: username, DisplayName: username, Role: model.UserRoleUser, Status: model.UserStatusActive, InviteCode: code, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
}

func enabledInvitePolicy() invite.InvitePolicy {
	policy := invite.DefaultInvitePolicy()
	policy.Enabled = true
	return policy
}

func rewardAccountOf(t *testing.T, db *gorm.DB, userID string) model.RewardAccount {
	t.Helper()
	var account model.RewardAccount
	if err := db.Where("user_id = ?", userID).First(&account).Error; err != nil {
		t.Fatal(err)
	}
	if account.TotalMicroYuan != account.AvailableMicroYuan+account.FrozenMicroYuan+account.UsedMicroYuan {
		t.Fatalf("账户守恒破坏: %+v", account)
	}
	return account
}

func TestAttachInviteRecordBuildsChainAndLimits(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	createInviteUser(t, db, "a", "alice", "AAAA2345")
	createInviteUser(t, db, "b", "bob", "BBBB2345")
	createInviteUser(t, db, "c", "carl", "CCCC2345")
	createInviteUser(t, db, "d", "dave", "DDDD2345")

	policy := enabledInvitePolicy()
	policy.Level = 2
	policy.AuditEnabled = true

	// A 邀请 B：audit 开 → pending。
	record, attached, err := repo.AttachInviteRecord("b", "aaaa2345", policy)
	if err != nil || !attached {
		t.Fatalf("attached=%v err=%v", attached, err)
	}
	if record.Status != model.InviteRecordPending || record.L1InviterID != "a" || record.L2InviterID != "" {
		t.Fatalf("record = %+v", record)
	}

	// C 用 B 的码：C 的 L1 = B，L2 = A（B 由 A 邀请）。
	record, attached, err = repo.AttachInviteRecord("c", "BBBB2345", policy)
	if err != nil || !attached {
		t.Fatalf("attached=%v err=%v", attached, err)
	}
	if record.L1InviterID != "b" || record.L2InviterID != "a" {
		t.Fatalf("二级链路错误: %+v", record)
	}

	// 无效码静默忽略。
	if _, attached, err := repo.AttachInviteRecord("d", "ZZZZ9999", policy); err != nil || attached {
		t.Fatalf("无效码应忽略: attached=%v err=%v", attached, err)
	}

	// 邀请人数上限：A 的下游已达 2，设上限 2 后 E 用新码挂不上。
	policy.InviteeCountLimit = 2
	createInviteUser(t, db, "e", "erin", "EEEE2345")
	createInviteUser(t, db, "f", "frank", "FFFF2345")
	if _, attached, err := repo.AttachInviteRecord("f", "AAAA2345", policy); err != nil || attached {
		t.Fatalf("超限应忽略: attached=%v err=%v", attached, err)
	}
	// B 的下游为 0，仍可邀请。
	if _, attached, err := repo.AttachInviteRecord("e", "BBBB2345", policy); err != nil || !attached {
		t.Fatalf("B 应仍可邀请: attached=%v err=%v", attached, err)
	}

	// 自己的邀请码无效。
	if _, attached, err := repo.AttachInviteRecord("a", "AAAA2345", policy); err != nil || attached {
		t.Fatalf("自邀应忽略: attached=%v err=%v", attached, err)
	}
}

func TestCompletePaymentOrderGrantsInviteRewards(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	createInviteUser(t, db, "a", "alice", "AAAA2345")
	createInviteUser(t, db, "b", "bob", "BBBB2345")
	policy := enabledInvitePolicy()
	policy.Level = 2
	policy.AuditEnabled = true
	if _, attached, err := repo.AttachInviteRecord("b", "AAAA2345", policy); err != nil || !attached {
		t.Fatalf("attach: %v", err)
	}

	order := model.PaymentOrder{
		ID: "po-1", UserID: "b", IdempotencyKey: "idem-1", MerchantOrderNo: "mo-1",
		ProductID: "product-1", ProductName: "100 积分", ProviderID: "wechat-native",
		ProviderConfigID: "config-1", ProviderConfigVersion: 1, AmountFen: 10000, Currency: "CNY",
		CreditsMicrocredits: 100_000_000, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	evidence := PaymentEvidence{ProviderTradeNo: "trade-1", ProviderStatus: "SUCCESS", AmountFen: 10000, Currency: "CNY", PaidAt: time.Now()}
	// 审核中（pending）：冻结入账。
	_, granted, err := repo.CompletePaymentOrder("wechat-native", "mo-1", evidence, &invite.InviteRewardInstruction{
		InviteeID: "b", Source: model.InviteRewardSourceProduct,
		Levels: []invite.RewardLevel{{Level: 1, RateBP: 500}},
	})
	if err != nil || !granted {
		t.Fatalf("granted=%v err=%v", granted, err)
	}
	account := rewardAccountOf(t, db, "a")
	if account.FrozenMicroYuan != 5_000_000 || account.AvailableMicroYuan != 0 || account.TotalMicroYuan != 5_000_000 {
		t.Fatalf("pending 奖励应计入冻结与总获得: %+v", account)
	}
	var reward model.InviteRewardRecord
	if err := db.Where("inviter_id = ? AND payment_order_id = ?", "a", "po-1").First(&reward).Error; err != nil {
		t.Fatal(err)
	}
	if reward.Status != model.InviteRewardPending || reward.AmountMicroYuan != 5_000_000 || reward.Level != 1 {
		t.Fatalf("reward = %+v", reward)
	}

	// 重复回调不重复发奖。
	if _, granted, err := repo.CompletePaymentOrder("wechat-native", "mo-1", evidence, &invite.InviteRewardInstruction{
		InviteeID: "b", Source: model.InviteRewardSourceProduct,
		Levels: []invite.RewardLevel{{Level: 1, RateBP: 500}},
	}); err != nil || granted {
		t.Fatalf("重复回调应幂等: granted=%v err=%v", granted, err)
	}
	if count := dbCount(t, db, &model.InviteRewardRecord{}, "inviter_id = ?", "a"); count != 1 {
		t.Fatalf("奖励记录数 = %d, want 1", count)
	}

	// 审核通过后新订单直接入可用余额。
	if _, err := repo.ApproveInviteRecord("b"); err != nil {
		t.Fatal(err)
	}
	order2 := order
	order2.ID = "po-2"
	order2.IdempotencyKey = "idem-2"
	order2.MerchantOrderNo = "mo-2"
	if err := db.Create(&order2).Error; err != nil {
		t.Fatal(err)
	}
	evidence2 := evidence
	evidence2.ProviderTradeNo = "trade-2"
	if _, granted, err := repo.CompletePaymentOrder("wechat-native", "mo-2", evidence2, &invite.InviteRewardInstruction{
		InviteeID: "b", Source: model.InviteRewardSourceProduct,
		Levels: []invite.RewardLevel{{Level: 1, RateBP: 500}},
	}); err != nil || !granted {
		t.Fatalf("granted=%v err=%v", granted, err)
	}
	account = rewardAccountOf(t, db, "a")
	if account.AvailableMicroYuan != 10_000_000 || account.FrozenMicroYuan != 0 || account.TotalMicroYuan != 10_000_000 {
		t.Fatalf("通过后奖励应直接入可用: %+v", account)
	}
}

func TestRewardCountLimitCapsRewardsPerInvitee(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	createInviteUser(t, db, "a", "alice", "AAAA2345")
	createInviteUser(t, db, "b", "bob", "BBBB2345")
	policy := enabledInvitePolicy()
	policy.AuditEnabled = true
	if _, attached, err := repo.AttachInviteRecord("b", "AAAA2345", policy); err != nil || !attached {
		t.Fatalf("attach: %v", err)
	}
	instruction := &invite.InviteRewardInstruction{
		InviteeID: "b", Source: model.InviteRewardSourceProduct, RewardCountLimit: 1,
		Levels: []invite.RewardLevel{{Level: 1, RateBP: 500}},
	}
	grant := func(orderID string) {
		t.Helper()
		order := model.PaymentOrder{
			ID: orderID, UserID: "b", IdempotencyKey: orderID, MerchantOrderNo: orderID,
			ProductID: "product-1", ProviderID: "wechat-native", ProviderConfigID: "config-1",
			ProviderConfigVersion: 1, AmountFen: 10000, Currency: "CNY",
			CreditsMicrocredits: 100_000_000, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
		}
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
		if _, _, err := repo.CompletePaymentOrder("wechat-native", orderID, PaymentEvidence{
			ProviderTradeNo: orderID, ProviderStatus: "SUCCESS", AmountFen: 10000, Currency: "CNY", PaidAt: time.Now(),
		}, instruction); err != nil {
			t.Fatal(err)
		}
	}
	grant("po-1")
	grant("po-2")
	if count := dbCount(t, db, &model.InviteRewardRecord{}, "inviter_id = ?", "a"); count != 1 {
		t.Fatalf("奖励次数限制未生效: %d", count)
	}
	if account := rewardAccountOf(t, db, "a"); account.FrozenMicroYuan != 5_000_000 {
		t.Fatalf("只应有一笔冻结奖励: %+v", account)
	}
}

func TestApproveFreezeAndDeleteInviteRecordMoveFunds(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	createInviteUser(t, db, "a", "alice", "AAAA2345")
	createInviteUser(t, db, "b", "bob", "BBBB2345")
	createInviteUser(t, db, "c", "carl", "CCCC2345")
	policy := enabledInvitePolicy()
	policy.AuditEnabled = true
	if _, attached, err := repo.AttachInviteRecord("b", "AAAA2345", policy); err != nil || !attached {
		t.Fatalf("attach b: %v", err)
	}
	if _, attached, err := repo.AttachInviteRecord("c", "BBBB2345", policy); err != nil || !attached {
		t.Fatalf("attach c: %v", err)
	}
	// 给 B 产生一笔 pending 奖励。
	if err := db.Create(&model.InviteRewardRecord{
		ID: "r-1", InviterID: "a", InviteeID: "b", Level: 1, Source: model.InviteRewardSourceProduct,
		PaymentOrderID: "po-1", OrderAmountFen: 10000, RateBP: 500, AmountMicroYuan: 500_000,
		Status: model.InviteRewardPending, ReferenceKey: "invite_reward:po-1:1",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := moveFrozenForTest(db, "a", 500_000); err != nil {
		t.Fatal(err)
	}

	// 冻结 C 的记录：C 未产生奖励，A 的待审核奖励不受影响。
	if _, err := repo.FreezeInviteRecord("c"); err != nil {
		t.Fatal(err)
	}
	if account := rewardAccountOf(t, db, "a"); account.FrozenMicroYuan != 500_000 {
		t.Fatalf("冻结 C 记录不应影响 A 的待审核奖励: %+v", account)
	}

	// 冻结态记录可恢复通过，不改变历史奖励。
	if _, err := repo.ApproveInviteRecord("c"); err != nil {
		t.Fatalf("冻结态恢复应成功: %v", err)
	}

	// 通过 B 的记录：pending 转可用。
	if _, err := repo.ApproveInviteRecord("b"); err != nil {
		t.Fatal(err)
	}
	account := rewardAccountOf(t, db, "a")
	if account.AvailableMicroYuan != 500_000 || account.TotalMicroYuan != 500_000 || account.FrozenMicroYuan != 0 {
		t.Fatalf("通过后应转入可用: %+v", account)
	}
	var reward model.InviteRewardRecord
	if err := db.Where("id = ?", "r-1").First(&reward).Error; err != nil {
		t.Fatal(err)
	}
	if reward.Status != model.InviteRewardCredited || reward.CreditedAt == nil {
		t.Fatalf("奖励应置 credited: %+v", reward)
	}

	// 编辑邀请人只影响 pending；删除记录保留已入账奖励。
	if _, err := repo.UpdateInviteInviters("c", "a", ""); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteInviteRecord("c"); err != nil {
		t.Fatal(err)
	}
	if count := dbCount(t, db, &model.InviteRecord{}, "user_id = ?", "c"); count != 0 {
		t.Fatal("删除后记录应不存在")
	}
	if account := rewardAccountOf(t, db, "a"); account.AvailableMicroYuan != 500_000 {
		t.Fatalf("删除不应影响已入账奖励: %+v", account)
	}
}

func TestUpdateInviteInvitersReattributesPendingRewards(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	createInviteUser(t, db, "a", "alice", "AAAA2345")
	createInviteUser(t, db, "b", "bob", "BBBB2345")
	createInviteUser(t, db, "c", "carl", "CCCC2345")
	if _, attached, err := repo.AttachInviteRecord("c", "AAAA2345", enabledInvitePolicy()); err != nil || !attached {
		t.Fatalf("attach: %v", err)
	}
	if err := db.Create(&model.InviteRewardRecord{
		ID: "r-1", InviterID: "a", InviteeID: "c", Level: 1, Source: model.InviteRewardSourceProduct,
		PaymentOrderID: "po-1", OrderAmountFen: 10000, RateBP: 500, AmountMicroYuan: 500_000,
		Status: model.InviteRewardPending, ReferenceKey: "invite_reward:po-1:1",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := moveFrozenForTest(db, "a", 500_000); err != nil {
		t.Fatal(err)
	}

	// 改挂到 B：A 冻结释放，B 冻结增加。
	if _, err := repo.UpdateInviteInviters("c", "b", ""); err != nil {
		t.Fatal(err)
	}
	accountA := rewardAccountOf(t, db, "a")
	if accountA.FrozenMicroYuan != 0 {
		t.Fatalf("旧邀请人冻结应释放: %+v", accountA)
	}
	accountB := rewardAccountOf(t, db, "b")
	if accountB.FrozenMicroYuan != 500_000 {
		t.Fatalf("新邀请人应承接冻结: %+v", accountB)
	}
	var reward model.InviteRewardRecord
	if err := db.Where("id = ?", "r-1").First(&reward).Error; err != nil {
		t.Fatal(err)
	}
	if reward.InviterID != "b" {
		t.Fatalf("奖励应改挂到新邀请人: %+v", reward)
	}

	// 清除邀请人：pending 作废。
	if _, err := repo.UpdateInviteInviters("c", "", ""); err != nil {
		t.Fatal(err)
	}
	if account := rewardAccountOf(t, db, "b"); account.FrozenMicroYuan != 0 {
		t.Fatalf("清除后冻结应释放: %+v", account)
	}
	var voided model.InviteRewardRecord
	if err := db.Where("id = ?", "r-1").First(&voided).Error; err != nil {
		t.Fatal(err)
	}
	if voided.Status != model.InviteRewardVoided {
		t.Fatalf("清除后奖励应作废: %+v", voided)
	}
}

func TestWithdrawLifecycleMovesRewardFunds(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	createInviteUser(t, db, "u", "user", "AAAA2345")
	if err := moveRewardForTest(db, "u", 1_000_000); err != nil {
		t.Fatal(err)
	}

	request := &model.WithdrawRequest{
		ID: "w-1", UserID: "u", AmountMicroYuan: 400_000, FeeMicroYuan: 40_000,
		ActualMicroYuan: 360_000, Method: model.WithdrawMethodWechat, Status: model.WithdrawStatusPending,
		AccountCipher: "cipher", CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := repo.CreateWithdrawRequest(request, 3, nil); err != nil {
		t.Fatal(err)
	}
	account := rewardAccountOf(t, db, "u")
	if account.AvailableMicroYuan != 600_000 || account.FrozenMicroYuan != 400_000 {
		t.Fatalf("提现申请应冻结金额: %+v", account)
	}

	// 驳回：冻结退回可用。
	if _, err := repo.ReviewWithdrawRequest("w-1", false, "admin", "信息有误"); err != nil {
		t.Fatal(err)
	}
	account = rewardAccountOf(t, db, "u")
	if account.AvailableMicroYuan != 1_000_000 || account.FrozenMicroYuan != 0 {
		t.Fatalf("驳回后应退回可用: %+v", account)
	}
	if count := dbCount(t, db, &model.WithdrawRequest{}, "user_id = ? AND created_at >= ?", "u", time.Now().Add(-time.Hour)); count != 1 {
		t.Fatalf("当日计数 = %d", count)
	}

	// 二次申请并成功：冻结转已使用。
	request2 := &model.WithdrawRequest{
		ID: "w-2", UserID: "u", AmountMicroYuan: 300_000, ActualMicroYuan: 300_000, Method: model.WithdrawMethodBank,
		Status: model.WithdrawStatusPending, AccountCipher: "cipher", CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := repo.CreateWithdrawRequest(request2, 3, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ReviewWithdrawRequest("w-2", true, "admin", ""); err != nil {
		t.Fatal(err)
	}
	account = rewardAccountOf(t, db, "u")
	if account.AvailableMicroYuan != 700_000 || account.UsedMicroYuan != 300_000 {
		t.Fatalf("成功后应转已使用: %+v", account)
	}

	// 终态不可再审。
	if _, err := repo.ReviewWithdrawRequest("w-2", true, "admin", ""); !errors.Is(err, ErrWithdrawStateConflict) {
		t.Fatalf("终态审核应冲突: %v", err)
	}
	// 驳回必填原因。
	if _, err := repo.ReviewWithdrawRequest("w-1", false, "admin", " "); err == nil {
		t.Fatal("驳回应必填原因")
	}
}

func TestCreateTransferMovesRewardAndCredits(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	createInviteUser(t, db, "u", "user", "AAAA2345")
	if err := moveRewardForTest(db, "u", 2_000_000); err != nil {
		t.Fatal(err)
	}

	record, account, err := repo.CreateTransfer("u", 1_000_000, 1000, 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if record.AmountMicroYuan != 1_000_000 || record.RateMilli != 1000 {
		t.Fatalf("record = %+v", record)
	}
	if account.AvailableMicrocredits != 1_000_000 {
		t.Fatalf("积分应到账: %+v", account)
	}
	reward := rewardAccountOf(t, db, "u")
	if reward.AvailableMicroYuan != 1_000_000 || reward.UsedMicroYuan != 1_000_000 {
		t.Fatalf("划转后奖励账户错误: %+v", reward)
	}

	// 余额不足拒绝。
	if _, _, err := repo.CreateTransfer("u", 99_000_000, 1000, 99_000_000); !errors.Is(err, ErrRewardInsufficientBalance) {
		t.Fatalf("余额不足应拒绝: %v", err)
	}
	// 幂等流水类型写入积分账本。
	if count := dbCount(t, db, &model.CreditLedgerEntry{}, "type = ?", model.CreditLedgerInviteTransfer); count != 1 {
		t.Fatalf("划转流水数 = %d", count)
	}
	entries, incomeTotal, err := repo.CreditLedger("u", "income", 20, 0)
	if err != nil || incomeTotal != 1 || len(entries) != 1 || entries[0].Type != model.CreditLedgerInviteTransfer {
		t.Fatalf("奖励划转未出现在收入记录: entries=%+v total=%d err=%v", entries, incomeTotal, err)
	}
	// 划转记录可分页。
	_, total, err := repo.TransfersByUser("u", 10, 0)
	if err != nil || total != 1 {
		t.Fatalf("transfers total=%d err=%v", total, err)
	}
}

func TestEnsureUserInviteCodeFillsOnce(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	createInviteUser(t, db, "u", "user", "")
	code, err := repo.EnsureUserInviteCode("u")
	if err != nil || len(code) != 8 {
		t.Fatalf("code=%q err=%v", code, err)
	}
	again, err := repo.EnsureUserInviteCode("u")
	if err != nil || again != code {
		t.Fatalf("重复读取应稳定: %q vs %q", again, code)
	}
}

func TestConcurrentInviteCodeAndWithdrawalsPreserveBalances(t *testing.T) {
	db := openInviteTestDB(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	repo := New(db)
	createInviteUser(t, db, "u", "user", "")
	const attempts = 8
	codes := make(chan string, attempts)
	failures := make(chan error, attempts)
	var group sync.WaitGroup
	for i := 0; i < attempts; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			code, err := repo.EnsureUserInviteCode("u")
			codes <- code
			failures <- err
		}()
	}
	group.Wait()
	close(codes)
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	var first string
	for code := range codes {
		if invite.ValidateInviteCode(code) != nil || code == "" {
			t.Fatalf("invalid generated code=%q", code)
		}
		if first == "" {
			first = code
		} else if first != code {
			t.Fatalf("concurrent code changed: %q/%q", first, code)
		}
	}
	if err := moveRewardForTest(db, "u", 1_000_000); err != nil {
		t.Fatal(err)
	}
	results := make(chan error, attempts)
	for i := 0; i < attempts; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			results <- repo.CreateWithdrawRequest(&model.WithdrawRequest{
				ID: newRepositoryID(), UserID: "u", AmountMicroYuan: 100_000,
				ActualMicroYuan: 100_000, Method: model.WithdrawMethodWechat,
				Status: model.WithdrawStatusPending, CreatedAt: time.Now(),
			}, 1, nil)
		}()
	}
	group.Wait()
	close(results)
	created, limited := 0, 0
	for err := range results {
		switch {
		case err == nil:
			created++
		case errors.Is(err, ErrWithdrawDailyLimit):
			limited++
		default:
			t.Fatal(err)
		}
	}
	if created != 1 || limited != attempts-1 {
		t.Fatalf("concurrent withdrawals created=%d limited=%d", created, limited)
	}
	if account := rewardAccountOf(t, db, "u"); account.AvailableMicroYuan != 900_000 || account.FrozenMicroYuan != 100_000 {
		t.Fatalf("concurrent withdrawal balance=%+v", account)
	}
}

func TestInviteTransferCreditOverflowRollsBackRewardDebit(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	createInviteUser(t, db, "u", "user", "AAAA2345")
	if err := moveRewardForTest(db, "u", 2_000_000); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "u", AvailableMicrocredits: math.MaxInt64}).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.CreateTransfer("u", 1_000_000, 1000, 1_000_000); !errors.Is(err, ErrRewardAmountOverflow) {
		t.Fatalf("overflow transfer error=%v", err)
	}
	if account := rewardAccountOf(t, db, "u"); account.AvailableMicroYuan != 2_000_000 || account.UsedMicroYuan != 0 {
		t.Fatalf("overflow transfer debited rewards=%+v", account)
	}
	if count := dbCount(t, db, &model.TransferRecord{}, "user_id = ?", "u"); count != 0 {
		t.Fatalf("overflow transfer wrote records=%d", count)
	}
	if count := dbCount(t, db, &model.CreditLedgerEntry{}, "user_id = ?", "u"); count != 0 {
		t.Fatalf("overflow transfer wrote ledger=%d", count)
	}
}

func TestPaymentUsesLockedInviteOwnerAndRejectsOverflow(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	for _, user := range []struct{ id, name, code string }{{"a", "alice", "AAAA2345"}, {"b", "bob", "BBBB2345"}, {"c", "carl", "CCCC2345"}} {
		createInviteUser(t, db, user.id, user.name, user.code)
	}
	if _, attached, err := repo.AttachInviteRecord("b", "AAAA2345", enabledInvitePolicy()); err != nil || !attached {
		t.Fatalf("attach: %v", err)
	}
	if _, err := repo.UpdateInviteInviters("b", "c", ""); err != nil {
		t.Fatal(err)
	}
	instruction := &invite.InviteRewardInstruction{InviteeID: "b", Source: model.InviteRewardSourceProduct,
		Levels: []invite.RewardLevel{{Level: 1, RateBP: 500}}}
	createOrder := func(id string, amount int64) {
		t.Helper()
		if err := db.Create(&model.PaymentOrder{
			ID: id, UserID: "b", IdempotencyKey: "idem-" + id, MerchantOrderNo: "mo-" + id,
			ProductID: "product-1", ProductName: "积分", ProviderID: "wechat-native", ProviderConfigID: "config-1",
			ProviderConfigVersion: 1, AmountFen: amount, Currency: "CNY", CreditsMicrocredits: 1_000_000,
			Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	createOrder("owner", 10_000)
	if _, granted, err := repo.CompletePaymentOrder("wechat-native", "mo-owner", PaymentEvidence{
		ProviderTradeNo: "trade-owner", ProviderStatus: "SUCCESS", AmountFen: 10_000, Currency: "CNY", PaidAt: time.Now(),
	}, instruction); err != nil || !granted {
		t.Fatalf("complete: granted=%v err=%v", granted, err)
	}
	if account := rewardAccountOf(t, db, "c"); account.AvailableMicroYuan != 5_000_000 {
		t.Fatalf("奖励应归属事务内的邀请人 C: %+v", account)
	}
	if count := dbCount(t, db, &model.RewardAccount{}, "user_id = ?", "a"); count != 0 {
		t.Fatalf("旧邀请人不应入账: %d", count)
	}
	createOrder("overflow", math.MaxInt64/500+1)
	if _, _, err := repo.CompletePaymentOrder("wechat-native", "mo-overflow", PaymentEvidence{
		ProviderTradeNo: "trade-overflow", ProviderStatus: "SUCCESS", AmountFen: math.MaxInt64/500 + 1,
		Currency: "CNY", PaidAt: time.Now(),
	}, instruction); !errors.Is(err, ErrRewardAmountOverflow) {
		t.Fatalf("过大订单应拒绝且回滚: %v", err)
	}
	var order model.PaymentOrder
	if err := db.Where("id = ?", "overflow").First(&order).Error; err != nil || order.Status != model.PaymentOrderPending {
		t.Fatalf("订单入账应回滚: %+v err=%v", order, err)
	}
	if account := rewardAccountOf(t, db, "c"); account.AvailableMicroYuan != 5_000_000 {
		t.Fatalf("溢出不得改变余额: %+v", account)
	}
}

func TestInviteAuditPolicyTransitionsAndExactDetail(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	for _, user := range []struct{ id, name, code string }{{"a", "alice", "AAAA2345"}, {"b", "bob", "BBBB2345"}, {"c", "carl", "CCCC2345"}} {
		createInviteUser(t, db, user.id, user.name, user.code)
	}
	policy := enabledInvitePolicy()
	if _, attached, err := repo.AttachInviteRecord("b", "AAAA2345", policy); err != nil || !attached {
		t.Fatalf("attach B: %v", err)
	}
	if _, attached, err := repo.AttachInviteRecord("c", "BBBB2345", policy); err != nil || !attached {
		t.Fatalf("attach C: %v", err)
	}
	if detail, err := repo.AdminInviteRecordByUserID("b"); err != nil || detail == nil || detail.UserID != "b" {
		t.Fatalf("详情必须精确返回 B: %+v err=%v", detail, err)
	}
	policy.AuditEnabled = true
	encoded, _ := json.Marshal(policy)
	if err := repo.UpdateInvitePolicy(&model.SystemSetting{Key: invite.SettingKey, ValueJSON: string(encoded)}, policy); err != nil {
		t.Fatal(err)
	}
	if record, err := repo.InviteRecord("b"); err != nil || record.Status != model.InviteRecordPending {
		t.Fatalf("审核开启后存量记录应待审: %+v err=%v", record, err)
	}
	if err := db.Create(&model.InviteRewardRecord{ID: "r-audit", InviterID: "a", InviteeID: "b", Level: 1,
		Source: model.InviteRewardSourceProduct, AmountMicroYuan: 500_000, Status: model.InviteRewardPending,
		ReferenceKey: "invite_reward:audit:1", CreatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := moveRewardForTestPending(db, "a", 500_000); err != nil {
		t.Fatal(err)
	}
	policy.AuditEnabled = false
	encoded, _ = json.Marshal(policy)
	if err := repo.UpdateInvitePolicy(&model.SystemSetting{Key: invite.SettingKey, ValueJSON: string(encoded)}, policy); err != nil {
		t.Fatal(err)
	}
	if record, err := repo.InviteRecord("b"); err != nil || record.Status != model.InviteRecordApproved {
		t.Fatalf("审核关闭后记录应通过: %+v err=%v", record, err)
	}
	if account := rewardAccountOf(t, db, "a"); account.AvailableMicroYuan != 500_000 || account.FrozenMicroYuan != 0 {
		t.Fatalf("待审核余额应释放: %+v", account)
	}
	if _, err := repo.FreezeInviteRecord("b"); err != nil {
		t.Fatal(err)
	}
	if record, err := repo.ApproveInviteRecord("b"); err != nil || record.Status != model.InviteRecordApproved {
		t.Fatalf("冻结记录应能恢复: %+v err=%v", record, err)
	}
}

func moveRewardForTestPending(db *gorm.DB, userID string, amount int64) error {
	return db.Transaction(func(tx *gorm.DB) error { return moveRewardTx(tx, userID, amount, 0, amount, 0) })
}

func TestWithdrawLimitAndSavedAccountAreAtomic(t *testing.T) {
	db := openInviteTestDB(t)
	repo := New(db)
	createInviteUser(t, db, "u", "user", "AAAA2345")
	if err := moveRewardForTest(db, "u", 1_000_000); err != nil {
		t.Fatal(err)
	}
	request := func(id string) *model.WithdrawRequest {
		return &model.WithdrawRequest{ID: id, UserID: "u", AmountMicroYuan: 400_000,
			ActualMicroYuan: 400_000, Method: model.WithdrawMethodWechat, AccountCipher: "cipher",
			Status: model.WithdrawStatusPending, CreatedAt: time.Now()}
	}
	saved := &model.WithdrawAccount{UserID: "u", Method: model.WithdrawMethodWechat, AccountCipher: "saved"}
	if err := repo.CreateWithdrawRequest(request("w-1"), 1, saved); err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateWithdrawRequest(request("w-2"), 1, nil); !errors.Is(err, ErrWithdrawDailyLimit) {
		t.Fatalf("第二次提现应受限: %v", err)
	}
	if account := rewardAccountOf(t, db, "u"); account.AvailableMicroYuan != 600_000 || account.FrozenMicroYuan != 400_000 {
		t.Fatalf("超限申请不得再冻结: %+v", account)
	}
	if stored, err := repo.WithdrawAccount("u"); err != nil || stored == nil || stored.AccountCipher != "saved" {
		t.Fatalf("收款信息应保存: %+v err=%v", stored, err)
	}
	if err := db.Exec("CREATE TRIGGER reject_account_update BEFORE UPDATE ON withdraw_accounts BEGIN SELECT RAISE(ABORT, 'rejected'); END").Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.CreateWithdrawRequest(request("w-3"), 0, &model.WithdrawAccount{UserID: "u", AccountCipher: "new"}); err == nil {
		t.Fatal("收款信息保存失败时提现应回滚")
	}
	if count := dbCount(t, db, &model.WithdrawRequest{}, "id = ?", "w-3"); count != 0 {
		t.Fatalf("失败申请不得落单: %d", count)
	}
	if account := rewardAccountOf(t, db, "u"); account.AvailableMicroYuan != 600_000 || account.FrozenMicroYuan != 400_000 {
		t.Fatalf("失败申请不得冻结: %+v", account)
	}
}

func dbCount(t *testing.T, db *gorm.DB, dest any, query string, args ...any) int64 {
	t.Helper()
	var count int64
	if err := db.Model(dest).Where(query, args...).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	return count
}

// moveRewardForTest 直接给测试账户注入可用余额（模拟历史奖励）。
func moveRewardForTest(db *gorm.DB, userID string, amount int64) error {
	return db.Transaction(func(tx *gorm.DB) error {
		return moveRewardTx(tx, userID, amount, amount, 0, 0)
	})
}

// moveFrozenForTest 注入待审核奖励（同时计入 total 与 frozen，与真实发放路径一致）。
func moveFrozenForTest(db *gorm.DB, userID string, amount int64) error {
	return db.Transaction(func(tx *gorm.DB) error {
		return moveRewardTx(tx, userID, amount, 0, amount, 0)
	})
}
