package repository

import (
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func paymentLimitTestOrder(id, productID string) *model.PaymentOrder {
	return &model.PaymentOrder{
		ID: id, UserID: "user-1", IdempotencyKey: "idem-" + id, MerchantOrderNo: "merchant-" + id,
		ProductID: productID, ProductName: "周卡", ProviderID: "wechat-native", PluginID: "plugin-1",
		ProviderConfigID: "config-1", ProviderConfigVersion: 1, AmountFen: 100, Currency: "CNY",
		CreditsMicrocredits: 100_000_000, Status: model.PaymentOrderCreated, ExpiresAt: time.Now().Add(time.Hour),
	}
}

// 周期限购必须把未关闭的待付款订单计入名额，否则先建多笔再逐笔付款可以全部入账。
func TestPeriodicPurchaseLimitCountsUnpaidOrders(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	product := model.TopupProduct{ID: "weekly", Name: "周卡", AmountFen: 100, CreditsMicrocredits: 100_000_000, Enabled: true, SaleStrategy: model.TopupSaleStrategyPeriodic, PeriodDays: 7, PeriodPurchaseLimit: 1}
	if err := db.Create(&product).Error; err != nil {
		t.Fatal(err)
	}
	first := paymentLimitTestOrder("order-1", product.ID)
	if _, created, err := repo.CreatePaymentOrderWithProductReservation(first); err != nil || !created {
		t.Fatalf("first order created=%v err=%v", created, err)
	}
	if _, _, err := repo.CreatePaymentOrderWithProductReservation(paymentLimitTestOrder("order-2", product.ID)); !errors.Is(err, ErrTopupUnavailable) {
		t.Fatalf("second unpaid order error = %v, want %v", err, ErrTopupUnavailable)
	}

	// 同一幂等键重试拿回原订单，不被限购拦下。
	retry := paymentLimitTestOrder("order-retry", product.ID)
	retry.IdempotencyKey = first.IdempotencyKey
	existing, created, err := repo.CreatePaymentOrderWithProductReservation(retry)
	if err != nil || created || existing.ID != first.ID {
		t.Fatalf("idempotent retry = %#v created=%v err=%v", existing, created, err)
	}

	// 关单后名额释放。
	if err := repo.MarkPaymentOrderClosed(first.ID, "CLOSED"); err != nil {
		t.Fatal(err)
	}
	if _, created, err := repo.CreatePaymentOrderWithProductReservation(paymentLimitTestOrder("order-3", product.ID)); err != nil || !created {
		t.Fatalf("order after close created=%v err=%v", created, err)
	}
}

// 商品更新在锁内按最新库存计算，不能把并发下单扣减的库存写回旧值。
func TestUpdateTopupProductKeepsConcurrentStockReservation(t *testing.T) {
	db := openPaymentTestDB(t)
	repo := New(db)
	product := model.TopupProduct{ID: "stock", Name: "限量", AmountFen: 100, CreditsMicrocredits: 100_000_000, Enabled: true, SaleStrategy: model.TopupSaleStrategyInventory, StockTotal: 5, StockRemaining: 5}
	if err := db.Create(&product).Error; err != nil {
		t.Fatal(err)
	}
	// 管理员先读到剩余 5，随后用户下单把库存扣成 4，管理员再保存（只改名称）。
	stale, err := repo.TopupProduct(product.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, created, err := repo.CreatePaymentOrderWithProductReservation(paymentLimitTestOrder("order-1", product.ID)); err != nil || !created {
		t.Fatalf("reserve stock created=%v err=%v", created, err)
	}
	err = repo.UpdateTopupProduct(product.ID, func(existing *model.TopupProduct) (*model.TopupProduct, error) {
		next := *stale
		next.Name = "限量（改名）"
		next.StockRemaining = existing.StockRemaining
		return &next, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	updated, err := repo.TopupProduct(product.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Name != "限量（改名）" || updated.StockRemaining != 4 {
		t.Fatalf("updated product = name %q remaining %d, want renamed with remaining 4", updated.Name, updated.StockRemaining)
	}
}
