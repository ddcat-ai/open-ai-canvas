package repository

import (
	"errors"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestMembershipSettlementAtomicity(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			db := newBillingTerminalDB(t, driver)
			if driver == "sqlite" {
				// 本夹具使用 deferred transactions，单连接下按 SQLite 的单写者语义执行。
				conn, err := db.DB()
				if err != nil {
					t.Fatal(err)
				}
				conn.SetMaxOpenConns(1)
			}
			if err := db.AutoMigrate(&model.PaymentOrder{}, &model.User{}); err != nil {
				t.Fatal(err)
			}
			r := New(db)
			if err := db.Create(&model.User{ID: "member", Username: "member", UserGroup: "partner"}).Error; err != nil {
				t.Fatal(err)
			}
			makeOrder := func(id string) {
				order := model.PaymentOrder{ID: id, ProductKind: model.TopupProductKindMembership, UserID: "member", IdempotencyKey: id, MerchantOrderNo: id, ProviderID: "gateway", AmountFen: 100, ChargeAmountFen: 100, ChargeCurrency: "CNY", CreditsMicrocredits: 50, Status: model.PaymentOrderPending, MembershipTerms: model.MembershipTerms{MembershipGroup: "vip", MembershipDays: 7}}
				if err := db.Create(&order).Error; err != nil {
					t.Fatal(err)
				}
			}
			for _, id := range []string{"one", "two", "overflow"} {
				makeOrder(id)
			}
			confirm := func(id string) error {
				_, _, err := r.CompletePaymentOrder("gateway", id, PaymentEvidence{ProviderTradeNo: id, AmountFen: 100, Currency: "CNY"})
				return err
			}
			start := make(chan struct{})
			results := make(chan error, 4)
			var wg sync.WaitGroup
			for _, id := range []string{"one", "two", "two", "one"} {
				wg.Go(func() { <-start; results <- confirm(id) })
			}
			close(start)
			wg.Wait()
			close(results)
			for err := range results {
				if err != nil {
					t.Fatal(err)
				}
			}
			rows, err := r.MembershipPeriods("member", time.Now())
			if err != nil || len(rows) != 2 || !rows[0].MembershipEndsAt.Equal(rows[1].MembershipStartsAt) {
				t.Fatalf("overlap or duplicate: %+v %v", rows, err)
			}
			var wallet model.CreditAccount
			if err := db.First(&wallet, "user_id = ?", "member").Error; err != nil || wallet.AvailableMicrocredits != 100 {
				t.Fatalf("wallet: %+v %v", wallet, err)
			}
			if err := db.Model(&wallet).Update("available_microcredits", maxPaymentCreditBalance).Error; err != nil {
				t.Fatal(err)
			}
			if err := confirm("overflow"); !errors.Is(err, ErrPaymentCreditOverflow) {
				t.Fatalf("overflow: %v", err)
			}
			user, err := r.User("member")
			if err != nil || user.UserGroup != "partner" || user.MembershipUntil == nil || !user.MembershipUntil.Equal(rows[1].MembershipEndsAt) {
				t.Fatalf("rollback: %+v %v", user, err)
			}
			order, err := r.PaymentOrder("overflow")
			if err != nil || order.Status != model.PaymentOrderPending || order.MembershipStartsAt != nil || order.MembershipEndsAt != nil {
				t.Fatalf("partial fulfillment: %+v %v", order, err)
			}
			var count int64
			if err := db.Model(&model.CreditLedgerEntry{}).Where("payment_order_id = ?", "overflow").Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("partial bonus: %d %v", count, err)
			}
		})
	}
}
