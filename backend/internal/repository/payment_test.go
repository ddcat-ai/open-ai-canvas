package repository

import (
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCompletePaymentOrderGrantsCreditsExactlyOnce(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	order := model.PaymentOrder{
		ID: "payment-order-1", UserID: "user-1", IdempotencyKey: "idem-1", MerchantOrderNo: "merchant-order-1",
		ProductID: "product-1", ProductName: "100 积分", ProviderID: "wechat-native", PluginID: "plugin-1",
		ProviderConfigID: "config-1", ProviderConfigVersion: 1, AmountFen: 100, Currency: "CNY",
		CreditsMicrocredits: 100_000_000, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	evidence := PaymentEvidence{ProviderTradeNo: "wechat-trade-1", ProviderStatus: "SUCCESS", AmountFen: 100, Currency: "CNY", PaidAt: time.Now()}
	completed, granted, err := repo.CompletePaymentOrder("wechat-native", "merchant-order-1", evidence)
	if err != nil {
		t.Fatal(err)
	}
	if !granted || completed.Status != model.PaymentOrderCredited {
		t.Fatalf("first completion = %#v, granted=%v", completed, granted)
	}
	completed, granted, err = repo.CompletePaymentOrder("wechat-native", "merchant-order-1", evidence)
	if err != nil {
		t.Fatal(err)
	}
	if granted || completed.Status != model.PaymentOrderCredited {
		t.Fatalf("duplicate completion = %#v, granted=%v", completed, granted)
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user-1").Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 100_000_000 {
		t.Fatalf("available credits = %d", account.AvailableMicrocredits)
	}
	var ledgerCount int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("payment_order_id = ? AND type = ?", order.ID, model.CreditLedgerPaymentTopup).Count(&ledgerCount).Error; err != nil {
		t.Fatal(err)
	}
	if ledgerCount != 1 {
		t.Fatalf("payment ledger entries = %d", ledgerCount)
	}
	conflictingEvidence := evidence
	conflictingEvidence.ProviderTradeNo = "wechat-trade-other"
	if _, _, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, conflictingEvidence); !errors.Is(err, ErrPaymentEvidenceMismatch) {
		t.Fatalf("conflicting trade number error = %v, want %v", err, ErrPaymentEvidenceMismatch)
	}
}

func TestActivePaymentOrderCountForPluginScopesVersionAndState(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	orders := []model.PaymentOrder{
		{ID: "plugin-v1-pending", UserID: "u1", IdempotencyKey: "i1", MerchantOrderNo: "m1", ProviderID: "p1", PluginID: "plugin", PluginVersion: "1.0.0", Status: model.PaymentOrderPending},
		{ID: "plugin-legacy-pending", UserID: "u5", IdempotencyKey: "i5", MerchantOrderNo: "m5", ProviderID: "p1", PluginID: "plugin", Status: model.PaymentOrderPending},
		{ID: "plugin-v1-credited", UserID: "u2", IdempotencyKey: "i2", MerchantOrderNo: "m2", ProviderID: "p1", PluginID: "plugin", PluginVersion: "1.0.0", Status: model.PaymentOrderCredited},
		{ID: "plugin-v2-pending", UserID: "u3", IdempotencyKey: "i3", MerchantOrderNo: "m3", ProviderID: "p1", PluginID: "plugin", PluginVersion: "2.0.0", Status: model.PaymentOrderPending},
		{ID: "other-pending", UserID: "u4", IdempotencyKey: "i4", MerchantOrderNo: "m4", ProviderID: "p2", PluginID: "other", PluginVersion: "1.0.0", Status: model.PaymentOrderPending},
	}
	if err := db.Create(&orders).Error; err != nil {
		t.Fatal(err)
	}
	count, err := repo.ActivePaymentOrderCountForPlugin("plugin", "1.0.0")
	if err != nil || count != 2 {
		t.Fatalf("version-scoped active count = %d, error = %v", count, err)
	}
	count, err = repo.ActivePaymentOrderCountForPlugin("plugin", "")
	if err != nil || count != 3 {
		t.Fatalf("all-version active count = %d, error = %v", count, err)
	}
}

func TestCompletePaymentOrderRejectsAmountMismatchWithoutGrant(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	order := model.PaymentOrder{
		ID: "payment-order-2", UserID: "user-2", IdempotencyKey: "idem-2", MerchantOrderNo: "merchant-order-2",
		ProductID: "product-2", ProductName: "200 积分", ProviderID: "alipay-page-pay", PluginID: "plugin-2",
		ProviderConfigID: "config-2", ProviderConfigVersion: 1, AmountFen: 200, Currency: "CNY",
		CreditsMicrocredits: 200_000_000, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	_, _, err := repo.CompletePaymentOrder("alipay-page-pay", "merchant-order-2", PaymentEvidence{
		ProviderTradeNo: "alipay-trade-2", ProviderStatus: "TRADE_SUCCESS", AmountFen: 199, Currency: "CNY",
	})
	if !errors.Is(err, ErrPaymentEvidenceMismatch) {
		t.Fatalf("error = %v", err)
	}
	var ledgerCount int64
	if err := db.Model(&model.CreditLedgerEntry{}).Count(&ledgerCount).Error; err != nil {
		t.Fatal(err)
	}
	if ledgerCount != 0 {
		t.Fatalf("ledger entries = %d", ledgerCount)
	}
}

func TestCompletePaymentOrderScopesTradeNumberUniquenessByProvider(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	orders := []model.PaymentOrder{
		{
			ID: "wechat-order-a", UserID: "wechat-user-a", IdempotencyKey: "wechat-idem-a", MerchantOrderNo: "wechat-merchant-order-a",
			ProductID: "product", ProductName: "积分", ProviderID: "wechat-native", PluginID: "wechat-plugin",
			ProviderConfigID: "wechat-config", ProviderConfigVersion: 1, AmountFen: 100, Currency: "CNY",
			CreditsMicrocredits: 100, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
		},
		{
			ID: "wechat-order-b", UserID: "wechat-user-b", IdempotencyKey: "wechat-idem-b", MerchantOrderNo: "wechat-merchant-order-b",
			ProductID: "product", ProductName: "积分", ProviderID: "wechat-native", PluginID: "wechat-plugin",
			ProviderConfigID: "wechat-config", ProviderConfigVersion: 1, AmountFen: 100, Currency: "CNY",
			CreditsMicrocredits: 100, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
		},
		{
			ID: "alipay-order", UserID: "alipay-user", IdempotencyKey: "alipay-idem", MerchantOrderNo: "alipay-merchant-order",
			ProductID: "product", ProductName: "积分", ProviderID: "alipay-page-pay", PluginID: "alipay-plugin",
			ProviderConfigID: "alipay-config", ProviderConfigVersion: 1, AmountFen: 100, Currency: "CNY",
			CreditsMicrocredits: 100, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
		},
	}
	if err := db.Create(&orders).Error; err != nil {
		t.Fatal(err)
	}
	sharedTradeNo := "shared-provider-trade-number"
	for _, order := range []model.PaymentOrder{orders[0], orders[2]} {
		if _, granted, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, PaymentEvidence{
			ProviderTradeNo: sharedTradeNo, ProviderStatus: "SUCCESS", AmountFen: order.AmountFen, Currency: order.Currency,
		}); err != nil || !granted {
			t.Fatalf("complete %s = granted %v, error %v", order.ProviderID, granted, err)
		}
	}
	if _, _, err := repo.CompletePaymentOrder(orders[1].ProviderID, orders[1].MerchantOrderNo, PaymentEvidence{
		ProviderTradeNo: sharedTradeNo, ProviderStatus: "SUCCESS", AmountFen: orders[1].AmountFen, Currency: orders[1].Currency,
	}); !errors.Is(err, ErrPaymentTradeNoConflict) {
		t.Fatalf("same-provider duplicate error = %v, want %v", err, ErrPaymentTradeNoConflict)
	}
}

func TestCompletePaymentOrderRejectsInconsistentExistingLedger(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	order := model.PaymentOrder{
		ID: "payment-order-inconsistent", UserID: "user-inconsistent", IdempotencyKey: "idem-inconsistent", MerchantOrderNo: "merchant-order-inconsistent",
		ProductID: "product", ProductName: "100 积分", ProviderID: "wechat-native", PluginID: "plugin",
		ProviderConfigID: "config", ProviderConfigVersion: 1, AmountFen: 100, Currency: "CNY",
		CreditsMicrocredits: 100_000_000, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	referenceKey := "payment:" + order.ProviderID + ":" + order.MerchantOrderNo
	if err := db.Create(&model.CreditLedgerEntry{
		ID: "ledger-inconsistent", UserID: order.UserID, Type: model.CreditLedgerPaymentTopup,
		AmountMicrocredits: order.CreditsMicrocredits, PaymentOrderID: order.ID, ReferenceKey: &referenceKey,
	}).Error; err != nil {
		t.Fatal(err)
	}

	_, granted, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, PaymentEvidence{
		ProviderTradeNo: "wechat-trade-inconsistent", ProviderStatus: "SUCCESS", AmountFen: order.AmountFen, Currency: order.Currency,
	})
	if !errors.Is(err, ErrPaymentOrderStateConflict) {
		t.Fatalf("error = %v, want %v", err, ErrPaymentOrderStateConflict)
	}
	if granted {
		t.Fatal("inconsistent ledger must not report a granted credit")
	}
	var accountCount int64
	if err := db.Model(&model.CreditAccount{}).Where("user_id = ?", order.UserID).Count(&accountCount).Error; err != nil {
		t.Fatal(err)
	}
	if accountCount != 0 {
		t.Fatalf("credit accounts = %d", accountCount)
	}
}

func TestCompletePaymentOrderRejectsCreditBalanceOverflow(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	order := model.PaymentOrder{
		ID: "payment-order-overflow", UserID: "user-overflow", IdempotencyKey: "idem-overflow", MerchantOrderNo: "merchant-order-overflow",
		ProductID: "product", ProductName: "积分", ProviderID: "wechat-native", PluginID: "plugin",
		ProviderConfigID: "config", ProviderConfigVersion: 1, AmountFen: 100, Currency: "CNY",
		CreditsMicrocredits: 100, Status: model.PaymentOrderPending, ExpiresAt: time.Now().Add(time.Hour),
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	account := model.CreditAccount{UserID: order.UserID, AvailableMicrocredits: maxPaymentCreditBalance - 50}
	if err := db.Create(&account).Error; err != nil {
		t.Fatal(err)
	}

	_, granted, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, PaymentEvidence{
		ProviderTradeNo: "wechat-trade-overflow", ProviderStatus: "SUCCESS", AmountFen: order.AmountFen, Currency: order.Currency,
	})
	if !errors.Is(err, ErrPaymentCreditOverflow) {
		t.Fatalf("error = %v, want %v", err, ErrPaymentCreditOverflow)
	}
	if granted {
		t.Fatal("overflowing credit must not report a grant")
	}
	if err := db.First(&account, "user_id = ?", order.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != maxPaymentCreditBalance-50 {
		t.Fatalf("available credits = %d", account.AvailableMicrocredits)
	}
	var ledgerCount int64
	if err := db.Model(&model.CreditLedgerEntry{}).Where("payment_order_id = ?", order.ID).Count(&ledgerCount).Error; err != nil {
		t.Fatal(err)
	}
	if ledgerCount != 0 {
		t.Fatalf("payment ledger entries = %d", ledgerCount)
	}
}

func TestCreatePaymentProviderConfigVersionsAreMonotonic(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	first := &model.PaymentProviderConfig{ID: "config-1", ProviderID: "wechat-native", PluginID: "plugin", CloseAfterMinutes: 30}
	second := &model.PaymentProviderConfig{ID: "config-2", ProviderID: "wechat-native", PluginID: "plugin", CloseAfterMinutes: 60}
	if err := repo.CreatePaymentProviderConfig(first); err != nil {
		t.Fatal(err)
	}
	if err := repo.CreatePaymentProviderConfig(second); err != nil {
		t.Fatal(err)
	}
	if first.Version != 1 || second.Version != 2 {
		t.Fatalf("versions = %d, %d", first.Version, second.Version)
	}
}

func TestClaimExpiredPaymentOrdersIncludesAmbiguousAndStaleClosingStates(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	now := time.Now()
	statuses := []model.PaymentOrderStatus{
		model.PaymentOrderCreated,
		model.PaymentOrderPending,
		model.PaymentOrderCreateFailed,
		model.PaymentOrderClosing,
	}
	for index, status := range statuses {
		order := model.PaymentOrder{
			ID: "expired-order-" + string(rune('a'+index)), UserID: "expired-user", IdempotencyKey: "expired-idem-" + string(rune('a'+index)),
			MerchantOrderNo: "expired-merchant-order-0000000" + string(rune('a'+index)), ProductID: "product", ProductName: "积分",
			ProviderID: "wechat-native", PluginID: "plugin", ProviderConfigID: "config", ProviderConfigVersion: 1,
			AmountFen: 100, Currency: "CNY", CreditsMicrocredits: 1_000_000, Status: status,
			ExpiresAt: now.Add(-time.Minute), UpdatedAt: now.Add(-3 * time.Minute),
		}
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
	}
	freshClosing := model.PaymentOrder{
		ID: "fresh-closing", UserID: "expired-user", IdempotencyKey: "fresh-closing", MerchantOrderNo: "fresh-closing-merchant-000000000",
		ProductID: "product", ProductName: "积分", ProviderID: "wechat-native", PluginID: "plugin", ProviderConfigID: "config", ProviderConfigVersion: 1,
		AmountFen: 100, Currency: "CNY", CreditsMicrocredits: 1_000_000, Status: model.PaymentOrderClosing,
		ExpiresAt: now.Add(-time.Minute), UpdatedAt: now,
	}
	if err := db.Create(&freshClosing).Error; err != nil {
		t.Fatal(err)
	}

	claimed, err := repo.ClaimExpiredPaymentOrders(10)
	if err != nil {
		t.Fatal(err)
	}
	if len(claimed) != len(statuses) {
		t.Fatalf("claimed %d orders, want %d", len(claimed), len(statuses))
	}
	for _, order := range claimed {
		if order.Status != model.PaymentOrderClosing {
			t.Fatalf("claimed status = %s", order.Status)
		}
	}
}

func TestPaymentOrdersNeedingQueryIncludesAmbiguousCreationStates(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	statuses := []model.PaymentOrderStatus{
		model.PaymentOrderCreated,
		model.PaymentOrderPending,
		model.PaymentOrderCreateFailed,
		model.PaymentOrderClosing,
		model.PaymentOrderCredited,
		model.PaymentOrderClosed,
	}
	for index, status := range statuses {
		suffix := string(rune('a' + index))
		order := model.PaymentOrder{
			ID: "query-order-" + suffix, UserID: "query-user", IdempotencyKey: "query-idem-" + suffix,
			MerchantOrderNo: "query-merchant-order-000000000" + suffix, ProductID: "product", ProductName: "积分",
			ProviderID: "wechat-native", PluginID: "plugin", ProviderConfigID: "config", ProviderConfigVersion: 1,
			AmountFen: 100, Currency: "CNY", CreditsMicrocredits: 1_000_000, Status: status,
			ExpiresAt: time.Now().Add(time.Hour),
		}
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
	}

	orders, err := repo.PaymentOrdersNeedingQuery(time.Now(), 20)
	if err != nil {
		t.Fatal(err)
	}
	wanted := map[model.PaymentOrderStatus]bool{
		model.PaymentOrderCreated: true, model.PaymentOrderPending: true, model.PaymentOrderCreateFailed: true,
	}
	if len(orders) != len(wanted) {
		t.Fatalf("query candidates = %d, want %d", len(orders), len(wanted))
	}
	for _, order := range orders {
		if !wanted[order.Status] {
			t.Fatalf("unexpected query candidate status %s", order.Status)
		}
	}
}

func TestUnresolvedPaymentOrderCandidateCountOverlapping(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	start := time.Date(2026, 9, 1, 0, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	closedOrder := model.PaymentOrder{
		ID: "candidate-order", UserID: "candidate-user", IdempotencyKey: "candidate-idem", MerchantOrderNo: "candidate-merchant-order-0000000",
		ProductID: "product", ProductName: "积分", ProviderID: "alipay-page-pay", PluginID: "plugin", ProviderConfigID: "config", ProviderConfigVersion: 1,
		AmountFen: 100, Currency: "CNY", CreditsMicrocredits: 1_000_000, Status: model.PaymentOrderClosed,
		ExpiresAt: start.Add(time.Hour), CreatedAt: start.Add(-time.Hour),
	}
	pendingOrder := closedOrder
	pendingOrder.ID = "pending-candidate-order"
	pendingOrder.IdempotencyKey = "pending-candidate-idem"
	pendingOrder.MerchantOrderNo = "pending-candidate-merchant-00000"
	pendingOrder.Status = model.PaymentOrderPending
	if err := db.Create(&closedOrder).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&pendingOrder).Error; err != nil {
		t.Fatal(err)
	}
	count, err := repo.UnresolvedPaymentOrderCandidateCountOverlapping("alipay-page-pay", start, start.AddDate(0, 0, 1))
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("unresolved candidate count = %d", count)
	}
}

func openPaymentTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared&_busy_timeout=5000"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.TopupProduct{},
		&model.PaymentProviderConfig{}, &model.PaymentOrder{}, &model.PaymentNotification{},
	); err != nil {
		t.Fatal(err)
	}
	return db
}
