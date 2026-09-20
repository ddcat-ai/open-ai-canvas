package paymentplugins

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestEpayRequiresExplicitGateway(t *testing.T) {
	if err := NewEpayProvider(nil).ValidateConfig(Config{"pid": "merchant", "key": "test-key"}); err == nil {
		t.Fatal("missing gateway must not send merchant credentials to a default third party")
	}
}

func TestEpayCheckoutURLAllowlist(t *testing.T) {
	for _, value := range []string{"file://host/etc/passwd", "smb://host/share", "vscode://file/tmp/a", "custom://pay", "javascript://alert(1)", "data://host/value", "https://user:pass@pay.example", "weixin:", "//pay.example"} {
		if isEpayURL(value) {
			t.Errorf("accepted unsafe checkout: %s", value)
		}
	}
	for _, value := range []string{"https://pay.example/order", "weixin://wxpay/bizpayurl?pr=test", "alipays://platformapi/startapp?appId=1", "mqqapi://wallet/pay"} {
		if !isEpayURL(value) {
			t.Errorf("rejected payment URL: %s", value)
		}
	}
}

func TestEpayQueryRejectsIncompleteEvidence(t *testing.T) {
	for _, test := range []struct{ name, response string }{
		{"missing order", `{"code":1,"status":1,"money":"1.00","trade_no":"trade"}`},
		{"different order", `{"code":1,"out_trade_no":"other","status":1,"money":"1.00","trade_no":"trade"}`},
		{"different merchant", `{"code":1,"pid":"other","out_trade_no":"order","status":1,"money":"1.00","trade_no":"trade"}`},
		{"invalid amount", `{"code":1,"out_trade_no":"order","status":1,"money":"bad","trade_no":"trade"}`},
		{"missing amount", `{"code":1,"out_trade_no":"order","status":1,"trade_no":"trade"}`},
		{"zero amount", `{"code":1,"out_trade_no":"order","status":1,"money":"0","trade_no":"trade"}`},
		{"missing transaction", `{"code":1,"out_trade_no":"order","status":1,"money":"1.00"}`},
		{"missing status", `{"code":1,"out_trade_no":"order","money":"1.00","trade_no":"trade"}`},
		{"trailing JSON", `{"code":1,"out_trade_no":"order","status":1,"money":"1.00","trade_no":"trade"}{}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, test.response) }))
			defer server.Close()
			provider := NewEpayProvider(server.Client())
			config := Config{"pid": "merchant", "key": "test-key", "gateway": server.URL}
			if result, err := provider.QueryOrder(context.Background(), config, QueryRequest{MerchantOrderNo: "order"}); err == nil {
				t.Fatalf("invalid payment evidence accepted: %+v", result)
			}
			if result, err := provider.CloseOrder(context.Background(), config, CloseRequest{MerchantOrderNo: "order"}); err == nil {
				t.Fatalf("invalid evidence must not close an order: %+v", result)
			}
		})
	}
}

func TestEpayQueryPreservesNumericTradeID(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"code":1,"out_trade_no":"order","status":1,"money":"1.00","trade_no":1234567890123456789}`)
	}))
	defer server.Close()
	result, err := NewEpayProvider(server.Client()).QueryOrder(context.Background(), Config{"pid": "merchant", "key": "test-key", "gateway": server.URL}, QueryRequest{MerchantOrderNo: "order"})
	if err != nil || !result.Paid || result.ProviderTradeNo != "1234567890123456789" {
		t.Fatalf("trade ID lost precision: %+v, %v", result, err)
	}
}

func TestEpayQRCodePreferenceFallsBackToRedirectForPayURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"code":1,"payurl":"https://pay.example/checkout"}`)
	}))
	defer server.Close()
	checkout, err := NewEpayProvider(server.Client()).CreateOrder(context.Background(), Config{"pid": "merchant", "key": "test-key", "gateway": server.URL, "checkoutMode": "qr_code"}, CreateRequest{
		MerchantOrderNo: "order", AmountFen: 100, Currency: "CNY", NotifyURL: "https://merchant.example/notify",
	})
	if err != nil || checkout.Mode != "redirect" {
		t.Fatalf("checkout must match returned payload: %+v, %v", checkout, err)
	}
}

func TestEpayNotificationRejectsDuplicateAndInvalidEvidence(t *testing.T) {
	config := Config{"pid": "merchant", "key": "test-key", "gateway": "https://pay.example"}
	for _, kind := range []string{"duplicate", "invalid amount", "zero amount", "missing transaction", "tampered", "pending", "closed", "missing status"} {
		t.Run(kind, func(t *testing.T) {
			values := map[string]string{"pid": "merchant", "out_trade_no": "order", "trade_no": "trade", "money": "1.00", "trade_status": "TRADE_SUCCESS"}
			switch kind {
			case "invalid amount":
				values["money"] = "invalid"
			case "zero amount":
				values["money"] = "0"
			case "missing transaction":
				delete(values, "trade_no")
			case "pending":
				values["trade_status"] = "WAIT_BUYER_PAY"
			case "closed":
				values["trade_status"] = "TRADE_CLOSED"
			case "missing status":
				delete(values, "trade_status")
			}
			values["sign"] = epayMD5Sign(values, config["key"])
			if kind == "tampered" {
				values["money"] = "9.00"
			}
			form := url.Values{}
			for key, value := range values {
				form.Set(key, value)
			}
			if kind == "duplicate" {
				form.Add("money", "9.00")
			}
			if _, err := NewEpayProvider(nil).VerifyNotification(context.Background(), config, nil, []byte(form.Encode())); err == nil {
				t.Fatal("invalid notification accepted")
			}
		})
	}
}

func TestEpayV2NotificationAndUnsupportedClose(t *testing.T) {
	privateKey, _ := testRSAKeyPair(t)
	config := Config{"pid": "merchant", "version": "1", "gateway": "https://pay.example", "privateKey": testPrivatePEM(privateKey), "platformPublicKey": testPublicPEM(&privateKey.PublicKey)}
	values := map[string]string{"pid": "merchant", "out_trade_no": "order", "trade_no": "trade", "money": "1.00", "trade_status": "TRADE_SUCCESS", "sign_type": "RSA"}
	signature, err := epayRSASign(values, config["privateKey"])
	if err != nil {
		t.Fatal(err)
	}
	values["sign"] = signature
	form := url.Values{}
	for key, value := range values {
		form.Set(key, value)
	}
	provider := NewEpayProvider(nil)
	notification, err := provider.VerifyNotification(context.Background(), config, nil, []byte(form.Encode()))
	if err != nil || !notification.Paid || notification.AmountFen != 100 {
		t.Fatalf("valid RSA notification rejected: %+v, %v", notification, err)
	}
	form.Set("money", "9.00")
	if _, err := provider.VerifyNotification(context.Background(), config, nil, []byte(form.Encode())); err == nil {
		t.Fatal("tampered RSA notification accepted")
	}
	if result, err := provider.CloseOrder(context.Background(), config, CloseRequest{MerchantOrderNo: "order"}); err == nil || result.Closed {
		t.Fatalf("unsupported V2 close must not report success: %+v, %v", result, err)
	}
	if _, err := epayRSASign(values, "invalid-key"); err == nil {
		t.Fatal("signing error must not be swallowed")
	}
}

func TestEpayTransportErrorsDoNotExposeMerchantKey(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	server.Close()
	_, err := NewEpayProvider(server.Client()).QueryOrder(context.Background(), Config{"pid": "merchant", "key": "secret-marker", "gateway": server.URL}, QueryRequest{MerchantOrderNo: "order"})
	if err == nil || strings.Contains(err.Error(), "secret-marker") {
		t.Fatalf("unsafe transport error: %v", err)
	}
}
