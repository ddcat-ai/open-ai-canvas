package service

import (
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestNewPaymentOutTradeNoFitsWechatLimitAndIsUnique(t *testing.T) {
	now := time.Now()
	first := newPaymentOutTradeNo(now)
	second := newPaymentOutTradeNo(now)
	if len(first) > 32 || len(first) < 6 {
		t.Fatalf("out_trade_no length = %d, value %q", len(first), first)
	}
	if first == second {
		t.Fatalf("out_trade_no values should be unique: %q", first)
	}
}

func TestParseWechatTradeBill(t *testing.T) {
	bill := strings.Join([]string{
		"`交易时间,`公众账号ID,`商户号,`微信订单号,`商户订单号,`交易状态,`应结订单金额,`订单金额",
		"`2026-08-29 12:00:00,`wx-app,`1900000001,`4200000001,`WP0001,`SUCCESS,`1.00,`1.00",
		"`总交易单数,`1,`应结订单总金额,`1.00",
	}, "\n")
	rows, err := parseWechatTradeBill([]byte(bill))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].OutTradeNo != "WP0001" || rows[0].TransactionID != "4200000001" || rows[0].AmountFen != 100 {
		t.Fatalf("parsed rows = %#v", rows)
	}
}

func TestParseYuanFenAvoidsFloatingPoint(t *testing.T) {
	for input, want := range map[string]int64{"0": 0, "0.01": 1, "1.2": 120, "12.34": 1234} {
		got, err := parseYuanFen(input)
		if err != nil || got != want {
			t.Fatalf("parseYuanFen(%q) = %d, %v; want %d", input, got, err, want)
		}
	}
	if _, err := parseYuanFen("1.234"); err == nil {
		t.Fatal("parseYuanFen accepted sub-fen precision")
	}
}

func TestParseWechatTradeBillDetectsExternalRefund(t *testing.T) {
	bill := strings.Join([]string{
		"`交易时间,`公众账号ID,`商户号,`微信订单号,`商户订单号,`交易状态,`应结订单金额,`微信退款单号,`退款金额,`订单金额",
		"`2026-08-29 13:00:00,`wx-app,`1900000001,`4200000001,`WP0001,`REFUND,`1.00,`5000000001,`0.50,`1.00",
	}, "\n")
	rows, err := parseWechatTradeBill([]byte(bill))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || !rows[0].IsRefund || rows[0].RefundID != "5000000001" || rows[0].RefundAmountFen != 50 {
		t.Fatalf("refund row = %#v", rows)
	}
}

func TestNormalizePaymentExpiryUsesConfiguredRange(t *testing.T) {
	for input, want := range map[int]int{-1: 15, 0: 15, 4: 15, 5: 5, 15: 15, 120: 120, 121: 15} {
		if got := normalizePaymentExpiry(input); got != want {
			t.Fatalf("normalizePaymentExpiry(%d) = %d, want %d", input, got, want)
		}
	}
}

func TestSupportedPaymentChannelUsesProviderAndMethod(t *testing.T) {
	wechatNative := model.PaymentChannel{Provider: model.PaymentProviderWechatPay, PaymentMethod: model.PaymentMethodNative}
	if !supportedPaymentChannel(wechatNative) {
		t.Fatal("wechat native channel should be supported")
	}
	if supportedPaymentChannel(model.PaymentChannel{Provider: "future-provider", PaymentMethod: model.PaymentMethodNative}) {
		t.Fatal("channel without a provider adapter should not be exposed")
	}
	if supportedPaymentChannel(model.PaymentChannel{Provider: model.PaymentProviderWechatPay, PaymentMethod: "jsapi"}) {
		t.Fatal("wechat method without an adapter should not be exposed")
	}
}
