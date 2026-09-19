package repository

import (
	"errors"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestVideoTokenSettlementChoosesProviderOrFormulaSnapshot(t *testing.T) {
	for _, restore := range []bool{false, true} {
		mode := "settle"
		if restore {
			mode = "restore"
		}
		for _, test := range []struct {
			name       string
			log        *model.ApiCallLog
			formula    int64
			cap        int64
			wantTokens int64
			wantAmount int64
			wantSource string
			wantError  bool
		}{
			{name: "missing usage", formula: 108000, wantTokens: 108000, wantAmount: 1728000, wantSource: "video_formula"},
			{name: "zero usage", formula: 108000, log: &model.ApiCallLog{UsageAvailable: true}, wantTokens: 108000, wantAmount: 1728000, wantSource: "video_formula"},
			{name: "negative usage", formula: 108000, log: &model.ApiCallLog{UsageAvailable: true, OutputTokens: -1}, wantTokens: 108000, wantAmount: 1728000, wantSource: "video_formula"},
			{name: "unavailable usage", formula: 108000, log: &model.ApiCallLog{OutputTokens: 200000}, wantTokens: 108000, wantAmount: 1728000, wantSource: "video_formula"},
			{name: "provider refund", formula: 108000, log: &model.ApiCallLog{UsageAvailable: true, OutputTokens: 100000, InputTokens: 20, CachedTokens: 10}, wantTokens: 100000, wantAmount: 1600000, wantSource: "provider"},
			{name: "provider supplement", formula: 108000, log: &model.ApiCallLog{UsageAvailable: true, OutputTokens: 200000}, wantTokens: 200000, wantAmount: 3200000, wantSource: "provider"},
			{name: "provider cap", formula: 108000, cap: 1000000, log: &model.ApiCallLog{UsageAvailable: true, OutputTokens: 200000}, wantTokens: 200000, wantAmount: 1000000, wantSource: "provider"},
			{name: "formula cap", formula: 108000, cap: 1000000, wantTokens: 108000, wantAmount: 1000000, wantSource: "video_formula"},
			{name: "legacy no usage", wantError: true},
			{name: "invalid snapshot", formula: -1, wantError: true},
		} {
			t.Run(mode+"/"+test.name, func(t *testing.T) {
				repo, db := newRefundedBillingRecoveryRepository(t)
				const available = int64(10000000)
				const reserved = int64(1900800)
				order := model.BillingOrder{
					ID: "order", UserID: "user", IdempotencyKey: "task", Capability: "video", BillingMode: "token",
					Quantity: 118800, VideoFormulaTokens: test.formula, AmountMicrocredits: reserved,
					ReservedAmountMicrocredits: reserved, OutputTokenPriceMicrocredits: 16000000,
					MultiplierBasisPoints: 10000, ChargeLimitMicrocredits: test.cap, Status: model.BillingStatusRunning,
				}
				account := model.CreditAccount{UserID: "user", AvailableMicrocredits: available, ReservedMicrocredits: reserved}
				settle := repo.SettleBillingOrder
				if restore {
					settle = repo.RestoreRefundedBillingOrder
					order.Status = model.BillingStatusRefunded
					order.RefundedAmountMicrocredits = reserved
					account.ReservedMicrocredits = 0
					account.AvailableMicrocredits += reserved
				}
				if err := db.Create(&account).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Create(&order).Error; err != nil {
					t.Fatal(err)
				}
				if test.log != nil {
					log := *test.log
					log.ID, log.BillingOrderID, log.Status = "log", "order", model.ApiCallStatusSucceeded
					if err := db.Create(&log).Error; err != nil {
						t.Fatal(err)
					}
				}
				if err := settle("order", "provider-id"); test.wantError {
					if !errors.Is(err, ErrBillingUsageUnavailable) {
						t.Fatalf("expected unavailable usage, got %v", err)
					}
					var after model.CreditAccount
					if err := db.First(&after, "user_id = ?", "user").Error; err != nil {
						t.Fatal(err)
					}
					if after.AvailableMicrocredits != account.AvailableMicrocredits || after.ReservedMicrocredits != account.ReservedMicrocredits {
						t.Fatalf("rejected settlement changed balance: %+v", after)
					}
					return
				} else if err != nil {
					t.Fatal(err)
				}
				if err := settle("order", "provider-id"); err != nil {
					t.Fatalf("repeat settlement: %v", err)
				}
				if err := db.First(&order, "id = ?", "order").Error; err != nil {
					t.Fatal(err)
				}
				if order.Status != model.BillingStatusSettled || order.ActualAmountMicrocredits != test.wantAmount || order.OutputTokens != test.wantTokens || order.UsageSource != test.wantSource || order.UsageAvailable != (test.wantSource == "provider") || order.InputTokens != 0 || order.CachedTokens != 0 {
					t.Fatalf("unexpected settled order: %+v", order)
				}
				if order.VideoFormulaTokens != test.formula || order.Quantity != 118800 || order.RefundedAmountMicrocredits != max(reserved-test.wantAmount, 0) {
					t.Fatalf("snapshot or refund changed: %+v", order)
				}
				if err := db.First(&account, "user_id = ?", "user").Error; err != nil {
					t.Fatal(err)
				}
				if account.AvailableMicrocredits != available+reserved-test.wantAmount || account.ReservedMicrocredits != 0 {
					t.Fatalf("unexpected account after settlement: %+v", account)
				}
				var entries []model.CreditLedgerEntry
				if err := db.Where("billing_order_id = ? AND type = ?", "order", model.CreditLedgerConsume).Find(&entries).Error; err != nil {
					t.Fatal(err)
				}
				if len(entries) != 1 || entries[0].AmountMicrocredits != -test.wantAmount {
					t.Fatalf("settlement not idempotent: %+v", entries)
				}
				if test.wantSource == "video_formula" && !strings.Contains(entries[0].Note, "公式") {
					t.Fatalf("formula source not recorded: %+v", entries[0])
				}
				if test.cap > 0 && !strings.Contains(entries[0].Note, "硬上限") {
					t.Fatalf("charge cap not recorded: %+v", entries[0])
				}
			})
		}
	}
}

func TestVideoTokenSettlementDoesNotHideDatabaseErrors(t *testing.T) {
	for _, restore := range []bool{false, true} {
		repo, db := newRefundedBillingRecoveryRepository(t)
		if err := db.Migrator().DropTable(&model.ApiCallLog{}); err != nil {
			t.Fatal(err)
		}
		order := model.BillingOrder{ID: "order", UserID: "user", IdempotencyKey: "task", Capability: "video", BillingMode: "token", VideoFormulaTokens: 108000, AmountMicrocredits: 1900800, ReservedAmountMicrocredits: 1900800, OutputTokenPriceMicrocredits: 16000000, MultiplierBasisPoints: 10000, Status: model.BillingStatusRunning}
		settle := repo.SettleBillingOrder
		if restore {
			order.Status = model.BillingStatusRefunded
			settle = repo.RestoreRefundedBillingOrder
		}
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
		if err := settle("order", ""); err == nil || errors.Is(err, ErrBillingUsageUnavailable) {
			t.Fatalf("database failure was hidden: %v", err)
		}
		if err := db.First(&order, "id = ?", "order").Error; err != nil {
			t.Fatal(err)
		}
		if order.Status == model.BillingStatusSettled || order.UsageSource != "" || order.ActualAmountMicrocredits != 0 {
			t.Fatalf("database failure changed settlement: %+v", order)
		}
	}
}

func TestFreeVideoTokenSettlementDoesNotRequireUsage(t *testing.T) {
	for _, restore := range []bool{false, true} {
		repo, db := newRefundedBillingRecoveryRepository(t)
		if err := db.Migrator().DropTable(&model.ApiCallLog{}); err != nil {
			t.Fatal(err)
		}
		order := model.BillingOrder{ID: "order", UserID: "user", IdempotencyKey: "task", Capability: "video", BillingMode: "token", VideoFormulaTokens: 108000, Status: model.BillingStatusRunning}
		settle := repo.SettleBillingOrder
		if restore {
			order.Status = model.BillingStatusRefunded
			settle = repo.RestoreRefundedBillingOrder
		}
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.CreditAccount{UserID: "user", AvailableMicrocredits: 123}).Error; err != nil {
			t.Fatal(err)
		}
		if err := settle("order", ""); err != nil {
			t.Fatal(err)
		}
		if err := db.First(&order, "id = ?", "order").Error; err != nil {
			t.Fatal(err)
		}
		if order.Status != model.BillingStatusSettled || order.ActualAmountMicrocredits != 0 || order.UsageAvailable {
			t.Fatalf("unexpected free settlement: %+v", order)
		}
		var account model.CreditAccount
		if err := db.First(&account, "user_id = ?", "user").Error; err != nil {
			t.Fatal(err)
		}
		if account.AvailableMicrocredits != 123 || account.ReservedMicrocredits != 0 {
			t.Fatalf("free order charged account: %+v", account)
		}
	}
}
