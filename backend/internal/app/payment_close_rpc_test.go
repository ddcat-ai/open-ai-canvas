package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/payment"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPaymentCloseRPCRequiresConfirmedOutcome(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test provider uses a POSIX shell script")
	}
	missing := `{"ok":false,"code":"order_not_found","message":"ORDER_NOT_EXIST"}`
	unknown := `{"ok":false,"code":"provider_error","message":"payment provider order not found"}`
	paid := `{"ok":true,"data":{"MerchantOrderNo":"merchant","Paid":true,"ProviderTradeNo":"trade","AmountFen":4900,"Currency":"CNY","ProviderStatus":"SUCCESS"}}`
	for _, tc := range []struct {
		name    string
		replies []string
		status  model.PaymentOrderStatus
		wantErr bool
		credit  int64
	}{
		{"confirmed_missing", []string{missing, missing, missing}, model.PaymentOrderClosed, false, 50000000},
		{"unknown_query", []string{unknown}, model.PaymentOrderPending, true, 50000000},
		{"unknown_recheck", []string{missing, missing, unknown}, model.PaymentOrderPending, true, 50000000},
		{"paid_during_close", []string{missing, missing, paid}, model.PaymentOrderCredited, false, 51000000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { _ = sqlDB.Close() })
			if err := db.AutoMigrate(&model.PaymentOrder{}, &model.PaymentProviderConfig{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}); err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.CreditAccount{UserID: "member", AvailableMicrocredits: 50000000}).Error; err != nil {
				t.Fatal(err)
			}
			s := &Service{repo: repository.New(db), dataDir: t.TempDir()}
			config := model.PaymentProviderConfig{ID: "config", ProviderID: "test", PluginID: "test", Version: 1, ConfigCipher: "{}"}
			if err := db.Create(&config).Error; err != nil {
				t.Fatal(err)
			}
			order := model.PaymentOrder{ID: "payment", UserID: "member", MerchantOrderNo: "merchant", ProviderID: "test", PluginID: "test", ProviderConfigID: config.ID, ProviderConfigVersion: 1, Status: model.PaymentOrderPending, AmountFen: 4900, Currency: "CNY", CreditsMicrocredits: 1000000}
			if err := db.Create(&order).Error; err != nil {
				t.Fatal(err)
			}
			dir := t.TempDir()
			if err := os.MkdirAll(filepath.Join(dir, "backend"), 0o700); err != nil {
				t.Fatal(err)
			}
			script := "#!/bin/sh\nread request\nn=0\nif test -f calls; then n=$(cat calls); fi\nn=$((n+1))\nprintf '%s' \"$n\" > calls\ncase \"$n\" in\n"
			for i, reply := range tc.replies {
				script += fmt.Sprintf("%d) printf '%%s\\n' '%s';;\n", i+1, reply)
			}
			script += "*) exit 1;;\nesac\n"
			if err := os.WriteFile(filepath.Join(dir, "backend", "provider"), []byte(script), 0o700); err != nil {
				t.Fatal(err)
			}
			provider, err := payment.NewRPCProvider(payment.Descriptor{ID: "test", PluginID: "test"}, dir, "backend/provider")
			if err != nil {
				t.Fatal(err)
			}
			s.paymentRegistry, err = payment.NewRegistry(provider)
			if err != nil {
				t.Fatal(err)
			}
			_, err = s.AdminClosePaymentOrder(context.Background(), &model.User{ID: "admin", Role: model.UserRoleAdmin}, order.ID)
			if (err != nil) != tc.wantErr {
				t.Fatalf("close error = %v, want error %v", err, tc.wantErr)
			}
			saved, err := s.repo.PaymentOrder(order.ID)
			if err != nil || saved.Status != tc.status {
				t.Fatalf("payment outcome = %#v, error %v", saved, err)
			}
			var account model.CreditAccount
			if err := db.First(&account, "user_id = ?", "member").Error; err != nil || account.AvailableMicrocredits != tc.credit {
				t.Fatalf("unexpected credit balance %d, error %v", account.AvailableMicrocredits, err)
			}
			calls, err := os.ReadFile(filepath.Join(dir, "calls"))
			if err != nil || strings.TrimSpace(string(calls)) != strconv.Itoa(len(tc.replies)) {
				t.Fatalf("confirmation calls = %s, error %v", calls, err)
			}
		})
	}
}
