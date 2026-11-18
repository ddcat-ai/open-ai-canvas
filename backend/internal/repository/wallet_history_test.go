package repository

import (
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestWalletHistoryGroupsOrdersBeforePagination(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			db := newBillingTerminalDB(t, driver)
			if err := db.AutoMigrate(&model.PaymentOrder{}); err != nil {
				t.Fatal(err)
			}
			repo := New(db)
			for _, user := range []string{"wallet-user", "other-user"} {
				if _, _, err := repo.GrantCreditsOnce(user, model.CreditLedgerPaymentTopup, 1_000_000, "topup:"+user, "充值"); err != nil {
					t.Fatal(err)
				}
			}
			created := time.Now()
			for _, test := range []struct {
				id       string
				user     string
				reserved int64
				actual   int64
				status   model.BillingStatus
			}{
				{"settled", "wallet-user", 11_666, 3_904, model.BillingStatusSettled},
				{"supplement", "wallet-user", 10, 25, model.BillingStatusSettled},
				{"free", "wallet-user", 0, 0, model.BillingStatusSettled},
				{"refunded", "wallet-user", 100, 0, model.BillingStatusRefunded},
				{"running", "wallet-user", 200, 0, model.BillingStatusRunning},
				{"uncertain", "wallet-user", 300, 0, model.BillingStatusUncertain},
				{"other-order", "other-user", 500, 0, model.BillingStatusRunning},
			} {
				order := model.BillingOrder{
					ID: test.id, UserID: test.user, IdempotencyKey: test.id, Model: "text-model", Capability: "text", Scene: "text",
					BillingMode: "token", AmountMicrocredits: test.reserved, ReservedAmountMicrocredits: test.reserved,
					OutputTokenPriceMicrocredits: 1_000_000, MultiplierBasisPoints: 10_000,
					Status: model.BillingStatusReserved, CreatedAt: created,
				}
				if test.id == "free" {
					order.OutputTokenPriceMicrocredits = 0
				}
				if err := repo.ReserveBillingOrder(&order); err != nil {
					t.Fatal(err)
				}
				var err error
				switch test.status {
				case model.BillingStatusSettled:
					if test.actual > 0 {
						if err := db.Create(&model.ApiCallLog{
							ID: "usage-" + test.id, BillingOrderID: order.ID, Status: model.ApiCallStatusSucceeded,
							UsageAvailable: true, OutputTokens: test.actual,
						}).Error; err != nil {
							t.Fatal(err)
						}
					}
					err = repo.SettleBillingOrder(order.ID, "")
				case model.BillingStatusRefunded:
					err = repo.RefundBillingOrder(order.ID, "任务取消")
				case model.BillingStatusRunning:
					err = repo.MarkBillingRunning(order.ID)
				case model.BillingStatusUncertain:
					err = repo.MarkBillingUncertain(order.ID, "等待上游用量")
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			before, err := repo.CreditAccount("wallet-user")
			if err != nil {
				t.Fatal(err)
			}
			entries := make(map[string]WalletHistoryEntry)
			for offset := 0; offset < 7; offset++ {
				page, total, err := repo.WalletHistory("wallet-user", "all", 1, offset)
				if err != nil || total != 7 || len(page) != 1 {
					t.Fatalf("page %d = %+v, total %d, error %v", offset, page, total, err)
				}
				entry := page[0]
				if _, duplicate := entries[entry.ID]; duplicate {
					t.Fatalf("order split across pages: %s", entry.ID)
				}
				entries[entry.ID] = entry
			}
			if got := entries["settled"]; got.Type != "billing" || got.BillingStatus != model.BillingStatusSettled || got.ReservedMicrocredits != 11_666 || got.ChargedMicrocredits != 3_904 || got.RefundedMicrocredits != 7_762 {
				t.Fatalf("settled history = %+v", got)
			}
			if got := entries["supplement"]; got.ReservedMicrocredits != 10 || got.ChargedMicrocredits != 25 || got.RefundedMicrocredits != 0 {
				t.Fatalf("supplement history = %+v", got)
			}
			if got := entries["free"]; got.BillingStatus != model.BillingStatusSettled || got.ChargedMicrocredits != 0 {
				t.Fatalf("free history = %+v", got)
			}
			if got := entries["refunded"]; got.BillingStatus != model.BillingStatusRefunded || got.RefundedMicrocredits != 100 || got.ChargedMicrocredits != 0 || got.Note != "任务取消" {
				t.Fatalf("refunded history = %+v", got)
			}
			if got := entries["running"]; got.BillingStatus != model.BillingStatusRunning || got.ReservedMicrocredits != 200 {
				t.Fatalf("running history = %+v", got)
			}
			if got := entries["uncertain"]; got.BillingStatus != model.BillingStatusUncertain || got.ReservedMicrocredits != 300 || got.Note != "等待上游用量" {
				t.Fatalf("uncertain history = %+v", got)
			}
			if _, leaked := entries["other-order"]; leaked {
				t.Fatal("history included another user's order")
			}
			for _, filter := range []struct {
				kind  string
				count int64
			}{{"income", 1}, {"expenses", 6}, {"consume", 3}, {"refund", 1}} {
				page, total, err := repo.WalletHistory("wallet-user", filter.kind, 20, 0)
				if err != nil || total != filter.count || int64(len(page)) != total {
					t.Fatalf("%s = %+v, total %d, error %v", filter.kind, page, total, err)
				}
				if filter.kind == "income" && (page[0].Type != string(model.CreditLedgerPaymentTopup) || page[0].AmountMicrocredits != 1_000_000) {
					t.Fatalf("topup changed: %+v", page[0])
				}
				if filter.kind == "refund" && page[0].ID != "refunded" {
					t.Fatalf("difference release counted as a separate refund: %+v", page)
				}
			}
			after, err := repo.CreditAccount("wallet-user")
			if err != nil || *before != *after {
				t.Fatalf("reading history changed account: before %+v, after %+v, error %v", before, after, err)
			}
			page, total, err := repo.WalletHistory("wallet-user", "all", 1, 7)
			if err != nil || total != 7 || page == nil || len(page) != 0 {
				t.Fatalf("empty page = %+v, total %d, error %v", page, total, err)
			}
		})
	}
}

func TestWalletHistoryPreservesSettledSceneNotes(t *testing.T) {
	db := newBillingTerminalDB(t, "sqlite")
	if err := db.AutoMigrate(&model.PaymentOrder{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	if _, _, err := repo.GrantCreditsOnce("user", model.CreditLedgerPaymentTopup, 100, "topup", ""); err != nil {
		t.Fatal(err)
	}
	order := model.BillingOrder{ID: "ark", UserID: "user", IdempotencyKey: "ark", Scene: model.BillingSceneArkAssetGroup,
		BillingMode: "fixed_request", AmountMicrocredits: 10, Status: model.BillingStatusReserved}
	if err := repo.ReserveBillingOrder(&order); err != nil {
		t.Fatal(err)
	}
	if err := settleArkGroupOrder(db, order.ID, "角色素材组"); err != nil {
		t.Fatal(err)
	}
	entries, total, err := repo.WalletHistory("user", "consume", 20, 0)
	if err != nil || total != 1 || len(entries) != 1 {
		t.Fatalf("history = %+v, total %d, error %v", entries, total, err)
	}
	if entries[0].Note != "角色素材组" || entries[0].ChargedMicrocredits != 10 || entries[0].Scene != model.BillingSceneArkAssetGroup {
		t.Fatalf("scene details lost: %+v", entries[0])
	}
}

func TestWalletHistoryIncomeSources(t *testing.T) {
	db := openPaymentTestDB(t)
	if err := db.AutoMigrate(&model.BillingOrder{}, &model.RedeemCode{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	for _, user := range []string{"member", "other-member"} {
		order := model.PaymentOrder{
			ID: "paid-" + user, UserID: user, IdempotencyKey: "paid-" + user, MerchantOrderNo: "paid-" + user,
			ProductName: "积分套餐", ProviderID: "wechat-native", PluginID: "wechat-plugin",
			AmountFen: 100, Currency: "CNY", ChargeAmountFen: 100, ChargeCurrency: "CNY",
			CreditsMicrocredits: 1_000, Status: model.PaymentOrderPending,
		}
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
		if _, granted, err := repo.CompletePaymentOrder(order.ProviderID, order.MerchantOrderNo, PaymentEvidence{
			ProviderTradeNo: "trade-" + user, ProviderStatus: "SUCCESS", AmountFen: 100, Currency: "CNY", PaidAt: time.Now(),
		}); err != nil || !granted {
			t.Fatalf("credit payment: granted %t, error %v", granted, err)
		}
	}
	if err := db.Create(&model.PaymentOrder{ID: "pending", UserID: "member", IdempotencyKey: "pending", MerchantOrderNo: "pending", ProviderID: "unpaid-channel", Status: model.PaymentOrderPending}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.RedeemCode{ID: "redeem", CodeHash: "redeem-hash", AmountMicrocredits: 500, Status: model.RedeemCodeUnused}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := repo.RedeemCode("member", "redeem-hash", ""); err != nil {
		t.Fatal(err)
	}
	for _, amount := range []int64{100, -40} {
		if _, err := repo.AdjustCredits("member", "admin", amount, "人工调整原因"); err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.ReserveBillingOrder(&model.BillingOrder{ID: "billing", UserID: "member", IdempotencyKey: "billing", AmountMicrocredits: 100, Status: model.BillingStatusReserved}); err != nil {
		t.Fatal(err)
	}
	seen := make(map[string]bool)
	for offset := 0; offset < 4; offset++ {
		page, total, err := repo.WalletHistory("member", "income", 1, offset)
		if err != nil || total != 4 || len(page) != 1 {
			t.Fatalf("income page %d = %+v, total %d, error %v", offset, page, total, err)
		}
		entry := page[0]
		if seen[entry.Type] {
			t.Fatalf("duplicate income source: %+v", entry)
		}
		seen[entry.Type] = true
		switch model.CreditLedgerType(entry.Type) {
		case model.CreditLedgerPaymentTopup:
			if entry.PaymentProviderID != "wechat-native" || entry.AmountMicrocredits != 1_000 {
				t.Fatalf("payment source = %+v", entry)
			}
		case model.CreditLedgerRedeem:
			if entry.AmountMicrocredits != 500 || entry.PaymentProviderID != "" {
				t.Fatalf("redemption = %+v", entry)
			}
		case model.CreditLedgerAdminGrant, model.CreditLedgerAdminAdjust:
			want := int64(100)
			if entry.Type == string(model.CreditLedgerAdminAdjust) {
				want = -40
			}
			if entry.AmountMicrocredits != want || entry.Note != "人工调整原因" || entry.PaymentProviderID != "" {
				t.Fatalf("adjustment = %+v", entry)
			}
		default:
			t.Fatalf("unexpected income entry: %+v", entry)
		}
	}
	page, total, err := repo.WalletHistory("member", "expenses", 20, 0)
	if err != nil || total != 1 || len(page) != 1 || page[0].ID != "billing" {
		t.Fatalf("expenses must exclude income: %+v, total %d, error %v", page, total, err)
	}
}
