package paymentplugins

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestXunHuPayCreateOrderSignsJSONAndReturnsQRCode(t *testing.T) {
	fixedNow := time.Date(2026, 9, 17, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	config := testXunHuPayConfig()
	var captured map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/payment/do.html" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		if !strings.Contains(request.Header.Get("Content-Type"), "application/json") {
			t.Fatalf("content-type = %q", request.Header.Get("Content-Type"))
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(body, &captured); err != nil {
			t.Fatal(err)
		}
		if captured["trade_order_id"] != "order-1" || captured["total_fee"] != "1.00" || captured["version"] != "1.1" {
			t.Fatalf("payload = %#v", captured)
		}
		if captured["hash"] != xunhupayHash(captured, config["appSecret"]) {
			t.Fatalf("hash = %q", captured["hash"])
		}
		response := map[string]string{
			"errcode": "0", "errmsg": "success!", "url_qrcode": "https://api.xunhupay.com/qrcode.png",
			"url": "https://api.xunhupay.com/pay/jump",
		}
		response["hash"] = xunhupayHash(response, config["appSecret"])
		_ = json.NewEncoder(writer).Encode(response)
	}))
	defer server.Close()

	provider := NewXunHuPayProvider(server.Client())
	provider.baseURL = server.URL
	provider.now = func() time.Time { return fixedNow }
	provider.nonce = func() string { return "fixed-nonce" }
	checkout, err := provider.CreateOrder(context.Background(), config, CreateRequest{
		MerchantOrderNo: "order-1", Description: "100 积分", AmountFen: 100, Currency: "CNY",
		ExpiresAt: fixedNow.Add(30 * time.Minute), NotifyURL: "https://merchant.example/api/payments/notify/xunhupay-aggregate/cfg",
		ReturnURL: "https://merchant.example/api/payments/return/xunhupay-aggregate?orderId=1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if checkout.Mode != "qr_code" || checkout.Value != "https://api.xunhupay.com/qrcode.png" {
		t.Fatalf("checkout = %#v", checkout)
	}
	if !checkout.ExpiresAt.Equal(fixedNow.Add(5 * time.Minute)) {
		t.Fatalf("expiresAt = %s", checkout.ExpiresAt)
	}
}

func TestXunHuPayCreateOrderCanReturnRedirectCheckout(t *testing.T) {
	config := testXunHuPayConfig()
	config["checkoutMode"] = "redirect"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		response := map[string]string{"errcode": "0", "errmsg": "success!", "url": "https://api.xunhupay.com/pay/jump"}
		response["hash"] = xunhupayHash(response, config["appSecret"])
		_ = json.NewEncoder(writer).Encode(response)
	}))
	defer server.Close()
	provider := NewXunHuPayProvider(server.Client())
	provider.baseURL = server.URL
	provider.nonce = func() string { return "fixed-nonce" }
	checkout, err := provider.CreateOrder(context.Background(), config, CreateRequest{
		MerchantOrderNo: "order-2", Description: "充值", AmountFen: 200, Currency: "CNY",
		ExpiresAt: time.Now().Add(20 * time.Minute), NotifyURL: "https://merchant.example/notify",
	})
	if err != nil {
		t.Fatal(err)
	}
	if checkout.Mode != "redirect" || checkout.Value != "https://api.xunhupay.com/pay/jump" {
		t.Fatalf("checkout = %#v", checkout)
	}
}

func TestXunHuPayQueryAndCloseMapOfficialStatuses(t *testing.T) {
	config := testXunHuPayConfig()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/payment/query.html" {
			t.Fatalf("path = %s", request.URL.Path)
		}
		var payload map[string]string
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if payload["out_trade_order"] != "order-3" || payload["hash"] != xunhupayHash(payload, config["appSecret"]) {
			t.Fatalf("payload = %#v", payload)
		}
		response := map[string]any{
			"errcode": 0, "errmsg": "success!",
			"data": map[string]string{"status": "WP", "out_trade_order": "order-3", "open_order_id": "open-3", "total_fee": "1.50"},
		}
		_ = json.NewEncoder(writer).Encode(response)
	}))
	defer server.Close()
	provider := NewXunHuPayProvider(server.Client())
	provider.baseURL = server.URL
	provider.nonce = func() string { return "fixed-nonce" }
	result, err := provider.QueryOrder(context.Background(), config, QueryRequest{MerchantOrderNo: "order-3"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Paid || result.Closed || result.AmountFen != 150 || result.ProviderStatus != "WP" {
		t.Fatalf("query = %#v", result)
	}
	closed, err := provider.CloseOrder(context.Background(), config, CloseRequest{MerchantOrderNo: "order-3"})
	if err != nil {
		t.Fatal(err)
	}
	if !closed.Closed || closed.Paid || closed.ProviderStatus != "CD" {
		t.Fatalf("close = %#v", closed)
	}
}

func TestXunHuPayNotificationVerifiesFormHash(t *testing.T) {
	config := testXunHuPayConfig()
	values := map[string]string{
		"trade_order_id": "order-4", "total_fee": "2.00", "transaction_id": "tx-4",
		"open_order_id": "open-4", "status": "OD", "appid": config["appId"], "time": "1788321600", "nonce_str": "cb-nonce",
	}
	values["hash"] = xunhupayHash(values, config["appSecret"])
	body := "trade_order_id=order-4&total_fee=2.00&transaction_id=tx-4&open_order_id=open-4&status=OD&appid=" + config["appId"] + "&time=1788321600&nonce_str=cb-nonce&hash=" + values["hash"]
	notification, err := NewXunHuPayProvider(http.DefaultClient).VerifyNotification(context.Background(), config, nil, []byte(body))
	if err != nil {
		t.Fatal(err)
	}
	if !notification.Paid || notification.AmountFen != 200 || notification.MerchantOrderNo != "order-4" || notification.ProviderTradeNo != "tx-4" {
		t.Fatalf("notification = %#v", notification)
	}
}

func TestXunHuPayRejectsUnknownGatewayAndMissingBills(t *testing.T) {
	provider := NewXunHuPayProvider(http.DefaultClient)
	config := testXunHuPayConfig()
	config["gateway"] = "https://evil.example/payment/do.html"
	if err := provider.ValidateConfig(config); err == nil {
		t.Fatal("expected untrusted gateway to fail")
	}
	_, err := provider.DownloadTradeBill(context.Background(), testXunHuPayConfig(), time.Now())
	if !errors.Is(err, ErrTradeBillNotFound) {
		t.Fatalf("bill error = %v", err)
	}
}

func testXunHuPayConfig() Config {
	return Config{
		"publicBaseUrl": "https://merchant.example",
		"appId":         "20146122002",
		"appSecret":     "test-app-secret",
		"gateway":       defaultXunHuPayGateway,
	}
}
