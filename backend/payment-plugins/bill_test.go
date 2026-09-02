package paymentplugins

import (
	"archive/zip"
	"bytes"
	"net/http"
	"net/url"
	"testing"
)

func TestParseWeChatSuccessTradeBill(t *testing.T) {
	raw := []byte("`交易时间,`微信订单号,`商户订单号,`交易状态,`货币种类,`订单金额\n" +
		"`2026-09-01 12:00:00,`420000001,`0123456789abcdef0123456789abcdef,`SUCCESS,`CNY,`1.23\n" +
		"`总交易单数,`1\n")
	records, err := parseWeChatTradeBill(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].MerchantOrderNo != "0123456789abcdef0123456789abcdef" || records[0].ProviderTradeNo != "420000001" || records[0].AmountFen != 123 {
		t.Fatalf("records = %#v", records)
	}
	if records[0].PaidAt.IsZero() {
		t.Fatal("expected paid time")
	}
}

func TestParseAlipayTradeBillArchiveSkipsRefundRows(t *testing.T) {
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	file, err := writer.Create("20260901_业务明细.csv")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write([]byte("支付宝交易号,商户订单号,业务类型,完成时间,订单金额（元）\n" +
		"202609010001,0123456789abcdef0123456789abcdef,交易,2026-09-01 12:00:00,2.50\n" +
		"202609010001,0123456789abcdef0123456789abcdef,退款,2026-09-01 13:00:00,-2.50\n"))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	records, err := parseAlipayTradeBill(archive.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].ProviderTradeNo != "202609010001" || records[0].AmountFen != 250 {
		t.Fatalf("records = %#v", records)
	}
}

func TestTrustedDownloadURLRejectsUnrelatedHosts(t *testing.T) {
	if _, err := trustedDownloadURL("https://evil.example/bill.csv", "https://openapi.alipay.com", "alipay.com"); err == nil {
		t.Fatal("expected untrusted host error")
	}
	if _, err := trustedDownloadURL("https://dwbillcenter.alipay.com/bill.zip", "https://openapi.alipay.com", "alipay.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := trustedDownloadURLWithPolicy("http://dwbillcenter.alipay.com/bill.zip", "https://openapi.alipay.com", []string{"dwbillcenter.alipay.com"}, "alipay.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := trustedDownloadURLWithPolicy("http://other.alipay.com/bill.zip", "https://openapi.alipay.com", []string{"dwbillcenter.alipay.com"}, "alipay.com"); err == nil {
		t.Fatal("expected non-bill-center HTTP URL error")
	}
	if _, err := trustedDownloadURL("https://api.mch.weixin.qq.com:8443/bill.csv", "https://api.mch.weixin.qq.com", "api.mch.weixin.qq.com"); err == nil {
		t.Fatal("expected non-standard port error")
	}
}

func TestTrustedDownloadRedirectIsRejectedBeforeFollow(t *testing.T) {
	client := clientWithTrustedRedirects(&http.Client{}, "https://openapi.alipay.com", "alipay.com")
	target, err := url.Parse("https://internal.invalid/bill.zip")
	if err != nil {
		t.Fatal(err)
	}
	if err := client.CheckRedirect(&http.Request{URL: target}, nil); err == nil {
		t.Fatal("expected untrusted redirect error")
	}
}
