package repository

import (
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"
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
	createPaymentTestUsers(t, db, "user-1")
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
	createPaymentTestUsers(t, db, "user-1")
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

func TestCreatePaymentOrderUsesLockedProductSnapshot(t *testing.T) {
	db := openPaymentTestDB(t)
	createPaymentTestUsers(t, db, "user-1")
	repo := New(db)
	product := model.TopupProduct{ID: "snapshot", Name: "新版商品", AmountFen: 260, CreditsMicrocredits: 260_000_000, Enabled: true}
	if err := db.Create(&product).Error; err != nil {
		t.Fatal(err)
	}
	order := paymentLimitTestOrder("snapshot-order", product.ID)
	order.ProductName, order.AmountFen, order.CreditsMicrocredits = "旧版商品", 100, 100_000_000
	created, fresh, err := repo.CreatePaymentOrderWithProductReservation(order)
	if err != nil || !fresh {
		t.Fatalf("create order = %#v fresh=%v err=%v", created, fresh, err)
	}
	if created.ProductName != product.Name || created.AmountFen != product.AmountFen || created.CreditsMicrocredits != product.CreditsMicrocredits {
		t.Fatalf("order snapshot = %#v; want locked product %#v", created, product)
	}
}

func TestCreatePaymentOrderRejectsConflictingIdempotencyKey(t *testing.T) {
	for _, conflictAt := range []string{"existing", "unique-conflict"} {
		t.Run(conflictAt, func(t *testing.T) {
			db := openPaymentTestDB(t)
			createPaymentTestUsers(t, db, "user-1")
			repo := New(db)
			product := model.TopupProduct{ID: "inventory", Name: "库存商品", AmountFen: 100, CreditsMicrocredits: 100_000_000, Enabled: true, SaleStrategy: model.TopupSaleStrategyInventory, StockTotal: 2, StockRemaining: 2}
			if err := db.Create(&product).Error; err != nil {
				t.Fatal(err)
			}
			request := paymentLimitTestOrder("new-order", product.ID)
			request.IdempotencyKey = "same-idempotency"
			previous := paymentLimitTestOrder("previous-order", product.ID)
			previous.IdempotencyKey = request.IdempotencyKey
			previous.ProviderID = "another-provider"
			if conflictAt == "existing" {
				if err := db.Create(previous).Error; err != nil {
					t.Fatal(err)
				}
			} else {
				if err := db.Callback().Create().Before("gorm:create").Register("inject_competing_payment_order", func(tx *gorm.DB) {
					if tx.Statement.Schema == nil || tx.Statement.Schema.Name != "PaymentOrder" {
						return
					}
					tx.Exec("INSERT INTO payment_orders (id, user_id, idempotency_key, merchant_order_no, product_id, product_name, provider_id, amount_fen, currency, credits_microcredits, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", previous.ID, previous.UserID, previous.IdempotencyKey, previous.MerchantOrderNo, previous.ProductID, previous.ProductName, previous.ProviderID, previous.AmountFen, previous.Currency, previous.CreditsMicrocredits, previous.Status, previous.ExpiresAt)
				}); err != nil {
					t.Fatal(err)
				}
			}
			_, created, err := repo.CreatePaymentOrderWithProductReservation(request)
			if !errors.Is(err, ErrPaymentIdempotencyConflict) || created {
				t.Fatalf("conflict created=%v err=%v", created, err)
			}
			var current model.TopupProduct
			if err := db.First(&current, "id = ?", product.ID).Error; err != nil || current.StockRemaining != 2 {
				t.Fatalf("stock remaining=%d err=%v", current.StockRemaining, err)
			}
		})
	}
}
