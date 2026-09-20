package paymentplugins

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"
)

func TestEpayV1CreateAndVerifyNotification(t *testing.T) {
	const key = "epay-test-key"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/mapi.php" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		values := mustEpayForm(t, request)
		if values["device"] != "pc" || values["type"] != "alipay" {
			t.Fatalf("form = %#v", values)
		}
		if !epaySafetyEquals(values["sign"], epayMD5Sign(values, key)) {
			t.Fatalf("sign = %#v", values)
		}
		// BOM 前缀应被剥离
		_, _ = writer.Write([]byte("\xEF\xBB\xBF" + `{"code":1,"msg":"ok","trade_no":"EPAY-1","qrcode":"https://pay.example/qr/1"}`))
	}))
	defer server.Close()

	provider := NewEpayProvider(server.Client())
	config := Config{"pid": "1001", "key": key, "gateway": server.URL, "checkoutMode": "qr_code"}
	checkout, err := provider.CreateOrder(context.Background(), config, CreateRequest{
		MerchantOrderNo: "ORDER-1", Description: "充值 10 积分", AmountFen: 100,
		Currency: "CNY", NotifyURL: "https://merchant.example/pay/notify",
	})
	if err != nil {
		t.Fatal(err)
	}
	if checkout.Mode != "qr_code" || checkout.Value != "https://pay.example/qr/1" {
		t.Fatalf("checkout = %#v", checkout)
	}

	values := map[string]string{
		"pid": "1001", "trade_no": "EPAY-1", "out_trade_no": "ORDER-1", "type": "alipay",
		"name": "充值 10 积分", "money": "1.00", "trade_status": "TRADE_SUCCESS", "endtime": "2026-09-19 12:01:00",
	}
	values["sign"] = epayMD5Sign(values, key)
	form := url.Values{}
	for name, value := range values {
		form.Set(name, value)
	}
	notification, err := provider.VerifyNotification(context.Background(), config, nil, []byte(form.Encode()))
	if err != nil {
		t.Fatal(err)
	}
	if !notification.Paid || notification.AmountFen != 100 || notification.ProviderTradeNo != "EPAY-1" {
		t.Fatalf("notification = %#v", notification)
	}
}

func TestEpayV1QueryAndLocalClose(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api.php" || request.URL.Query().Get("act") != "order" {
			t.Fatalf("request = %s %s", request.Method, request.URL.String())
		}
		_, _ = writer.Write([]byte(`{"code":1,"out_trade_no":"ORDER-2","trade_no":"EPAY-2","status":0,"money":"2.00"}`))
	}))
	defer server.Close()

	provider := NewEpayProvider(server.Client())
	config := Config{"pid": "1001", "key": "key", "gateway": server.URL}
	result, err := provider.QueryOrder(context.Background(), config, QueryRequest{MerchantOrderNo: "ORDER-2"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Paid || result.AmountFen != 200 || result.ProviderTradeNo != "EPAY-2" {
		t.Fatalf("result = %#v", result)
	}
	closed, err := provider.CloseOrder(context.Background(), config, CloseRequest{MerchantOrderNo: "ORDER-2"})
	if err != nil {
		t.Fatal(err)
	}
	if !closed.Closed || closed.Paid {
		t.Fatalf("closed = %#v", closed)
	}
}

func TestEpayV2CreateUsesRSASignature(t *testing.T) {
	privateKey, publicKey := testRSAKeyPair(t)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/api/pay/create" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		values := mustEpayForm(t, request)
		if err := rsaSHA256Verify(publicKey, []byte(epayCanonical(values)), values["sign"]); err != nil {
			t.Fatalf("sign: %v", err)
		}
		_, _ = writer.Write([]byte(`{"code":0,"pay_info":"https://pay.example/v2/1"}`))
	}))
	defer server.Close()

	provider := NewEpayProvider(server.Client())
	config := Config{
		"pid": "1001", "version": "1", "gateway": server.URL,
		"privateKey": testPrivatePEM(privateKey), "platformPublicKey": testPublicPEM(&privateKey.PublicKey),
	}
	checkout, err := provider.CreateOrder(context.Background(), config, CreateRequest{
		MerchantOrderNo: "ORDER-V2", AmountFen: 100, Currency: "CNY", NotifyURL: "https://merchant.example/notify",
	})
	if err != nil {
		t.Fatal(err)
	}
	if checkout.Mode != "redirect" || checkout.Value != "https://pay.example/v2/1" {
		t.Fatalf("checkout = %#v", checkout)
	}
}

func TestEpayRejectsUnsafeGatewayAndMissingBills(t *testing.T) {
	provider := NewEpayProvider(http.DefaultClient)
	if err := provider.ValidateConfig(Config{"pid": "1001", "key": "key", "gateway": "https://user:pass@example.invalid"}); err == nil {
		t.Fatal("expected unsafe gateway error")
	}
	_, err := provider.DownloadTradeBill(context.Background(), Config{}, time.Now())
	if !errors.Is(err, ErrTradeBillNotFound) {
		t.Fatalf("error = %v", err)
	}
	if isEpayURL("javascript:alert(1)") || !isEpayURL("weixin://dl/business/?t=1") {
		t.Fatal("isEpayURL scheme rules mismatch")
	}
}

func mustEpayForm(t *testing.T, request *http.Request) map[string]string {
	t.Helper()
	body, err := io.ReadAll(request.Body)
	if err != nil {
		t.Fatal(err)
	}
	form, err := url.ParseQuery(string(body))
	if err != nil {
		t.Fatal(err)
	}
	values := make(map[string]string, len(form))
	for name, items := range form {
		if len(items) > 0 {
			values[name] = items[0]
		}
	}
	return values
}
