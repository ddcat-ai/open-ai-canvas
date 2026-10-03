package app

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/payment"
)

type recordingOrderProvider struct {
	payment.Provider
	requests []payment.CreateRequest
}

func (p *recordingOrderProvider) Descriptor() payment.Descriptor {
	return payment.Descriptor{ID: PaymentProviderAlipay, PluginID: PaymentPluginAlipayPage, CheckoutMode: "redirect"}
}

func (p *recordingOrderProvider) CreateOrder(_ context.Context, _ payment.Config, request payment.CreateRequest) (payment.Checkout, error) {
	p.requests = append(p.requests, request)
	return payment.Checkout{Mode: "redirect", Value: "https://checkout.example.test/order", ExpiresAt: request.ExpiresAt}, nil
}

func paymentOrderServiceFixture(t *testing.T) (*Service, *gorm.DB, *recordingOrderProvider) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	provider := &recordingOrderProvider{}
	var err error
	s.paymentRegistry, err = payment.NewRegistry(provider)
	if err != nil {
		t.Fatal(err)
	}
	cipher, err := s.encryptSettingSecret(`{"publicBaseUrl":"https://app.example.test"}`)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.PluginPlatformState{PluginID: PaymentPluginAlipayPage, Available: true},
		&model.PaymentProviderConfig{ID: "test-config", ProviderID: PaymentProviderAlipay, PluginID: PaymentPluginAlipayPage, Version: 1, Enabled: true, CloseAfterMinutes: 30, ConfigCipher: cipher},
		&model.TopupProduct{ID: "product", Name: "旧商品", AmountFen: 100, CreditsMicrocredits: 1000, Enabled: true},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, db, provider
}

func TestPaymentOrderServiceUsesReservedSnapshot(t *testing.T) {
	s, db, provider := paymentOrderServiceFixture(t)
	changed := false
	const callback = "test:change-product-after-read"
	if err := db.Callback().Query().After("gorm:query").Register(callback, func(tx *gorm.DB) {
		if changed || tx.Statement.Schema == nil || tx.Statement.Schema.Name != "TopupProduct" {
			return
		}
		changed = true
		// 在入口读完旧快照、预留事务取得商品之前模拟另一请求的已提交改价。
		tx.AddError(tx.Session(&gorm.Session{NewDB: true}).Exec("UPDATE topup_products SET name = ?, amount_fen = ?, credits_microcredits = ? WHERE id = ?", "新商品", 260, 2600, "product").Error)
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Callback().Query().Remove(callback) })
	order, err := s.CreatePaymentOrder(t.Context(), &model.User{ID: "user"}, CreatePaymentOrderRequest{ProductID: "product", ProviderID: PaymentProviderAlipay, IdempotencyKey: "snapshot"})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || order.ProductName != "新商品" || order.AmountFen != 260 || order.CreditsMicrocredits != 2600 {
		t.Fatalf("wrong reserved snapshot: changed=%v order=%#v", changed, order)
	}
	if len(provider.requests) != 1 || provider.requests[0].Description != order.ProductName || provider.requests[0].AmountFen != order.AmountFen {
		t.Fatalf("checkout does not match saved order: %#v", provider.requests)
	}
	retry, err := s.CreatePaymentOrder(t.Context(), &model.User{ID: "user"}, CreatePaymentOrderRequest{ProductID: "product", ProviderID: PaymentProviderAlipay, IdempotencyKey: "snapshot"})
	if err != nil || retry.ID != order.ID || len(provider.requests) != 1 {
		t.Fatalf("retry created another checkout: retry=%#v err=%v requests=%d", retry, err, len(provider.requests))
	}
}

func TestPaymentOrderServiceRejectsRacingIdentity(t *testing.T) {
	for _, branch := range []string{"existing", "unique-conflict"} {
		for _, identity := range []string{"product", "provider"} {
			t.Run(branch+"/"+identity, func(t *testing.T) {
				s, db, provider := paymentOrderServiceFixture(t)
				inserted := false
				inject := func(tx *gorm.DB) {
					if inserted {
						return
					}
					inserted = true
					productID, providerID := "product", PaymentProviderAlipay
					if identity == "product" {
						productID = "another-product"
					} else {
						providerID = "another-provider"
					}
					tx.AddError(tx.Session(&gorm.Session{NewDB: true}).Exec("INSERT INTO payment_orders (id, user_id, idempotency_key, merchant_order_no, product_id, provider_id, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", "competing-order", "user", "same-key", "competing-merchant", productID, providerID, model.PaymentOrderCreated, time.Now().Add(time.Hour)).Error)
				}
				const callback = "test:inject-competing-order"
				if branch == "existing" {
					if err := db.Callback().Query().After("gorm:query").Register(callback, func(tx *gorm.DB) {
						if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "TopupProduct" {
							inject(tx)
						}
					}); err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() { _ = db.Callback().Query().Remove(callback) })
				} else {
					if err := db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
						if tx.Statement.Schema != nil && tx.Statement.Schema.Name == "PaymentOrder" {
							inject(tx)
						}
					}); err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() { _ = db.Callback().Create().Remove(callback) })
				}
				order, err := s.CreatePaymentOrder(t.Context(), &model.User{ID: "user"}, CreatePaymentOrderRequest{ProductID: "product", ProviderID: PaymentProviderAlipay, IdempotencyKey: "same-key"})
				var appErr *AppError
				if !inserted || order != nil || !errors.As(err, &appErr) || appErr.Status != http.StatusConflict || len(provider.requests) != 0 {
					t.Fatalf("racing identity accepted: inserted=%v order=%#v err=%v requests=%d", inserted, order, err, len(provider.requests))
				}
			})
		}
	}
}
