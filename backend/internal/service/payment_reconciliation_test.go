package service

import (
	"testing"
	"time"
)

func TestParseWechatTradeBill(t *testing.T) {
	content := []byte("微信支付账单明细,,,,,,\n`交易时间,`微信订单号,`商户订单号,`交易类型,`交易状态,`货币种类,`订单金额,`申请退款金额\n`2026-08-30 12:34:56,`wx-transaction-1,`recharge-1,`NATIVE,`SUCCESS,`CNY,`10.01,`0.00\n")
	rows, err := parseWechatTradeBill(content, time.FixedZone("CST", 8*60*60))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].OrderID != "recharge-1" || rows[0].ProviderTransactionID != "wx-transaction-1" || rows[0].AmountFen != 1001 || rows[0].Currency != "CNY" || !wechatTradeStateSucceeded(rows[0].State) {
		t.Fatalf("parseWechatTradeBill() = %#v", rows)
	}
}

func TestDecimalYuanToFenDoesNotUseFloatingPoint(t *testing.T) {
	for value, want := range map[string]int64{"0.01": 1, "10": 1000, "¥12.30": 1230, "`1,234.56": 123456} {
		got, err := decimalYuanToFen(value)
		if err != nil || got != want {
			t.Fatalf("decimalYuanToFen(%q) = %d, %v; want %d", value, got, err, want)
		}
	}
	if _, err := decimalYuanToFen("1.001"); err == nil {
		t.Fatal("decimalYuanToFen accepted more than two decimal places")
	}
}
