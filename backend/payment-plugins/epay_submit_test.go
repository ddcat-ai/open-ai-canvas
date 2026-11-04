package paymentplugins

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestEpaySubmitModeBuildsSignedRedirectWithoutCallingGateway(t *testing.T) {
	const key = "epay-submit-key"
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { called = true }))
	defer server.Close()

	provider := NewEpayProvider(server.Client())
	config := Config{"pid": "1001", "key": key, "gateway": server.URL + "/", "submitMode": "submit", "payTypes": "alipay,wxpay:微信支付"}
	checkout, err := provider.CreateOrder(context.Background(), config, CreateRequest{
		MerchantOrderNo: "ORDER-S1", Description: "充值 10 积分", AmountFen: 1234, Currency: "CNY", Method: "wxpay",
		NotifyURL: "https://merchant.example/notify", ReturnURL: "https://merchant.example/return?orderId=o1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("submit mode must not call the gateway server-side")
	}
	parsed, err := url.Parse(checkout.Value)
	if err != nil || checkout.Mode != "redirect" || parsed.Path != "/submit.php" || !strings.HasPrefix(checkout.Value, server.URL+"/submit.php?") {
		t.Fatalf("checkout = %#v", checkout)
	}
	query := parsed.Query()
	values := map[string]string{}
	for name := range query {
		values[name] = query.Get(name)
	}
	if values["type"] != "wxpay" || values["money"] != "12.34" || values["out_trade_no"] != "ORDER-S1" || values["sign_type"] != "MD5" {
		t.Fatalf("query = %#v", values)
	}
	if _, leaked := values["key"]; leaked {
		t.Fatal("merchant key must not appear in the redirect URL")
	}
	if _, ok := values["device"]; ok {
		t.Fatal("submit mode must leave device detection to the gateway")
	}
	if !epaySafetyEquals(values["sign"], epayMD5Sign(values, key)) {
		t.Fatalf("submit.php signature is invalid: %#v", values)
	}
}

func TestEpayRejectsDisabledMethodAndUsesFirstEnabledByDefault(t *testing.T) {
	provider := NewEpayProvider(nil)
	config := Config{"pid": "1001", "key": "k", "gateway": "https://pay.example", "submitMode": "submit", "payTypes": "wxpay, alipay"}
	request := CreateRequest{MerchantOrderNo: "ORDER-S2", AmountFen: 100, Currency: "CNY", NotifyURL: "https://merchant.example/notify", Method: "qqpay"}
	_, err := provider.CreateOrder(context.Background(), config, request)
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.Code != "epay_method_disabled" {
		t.Fatalf("disabled method error = %v", err)
	}
	request.Method = ""
	checkout, err := provider.CreateOrder(context.Background(), config, request)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(checkout.Value)
	if parsed.Query().Get("type") != "wxpay" {
		t.Fatalf("default type = %q", parsed.Query().Get("type"))
	}
}

func TestEpayLegacyPayTypeStillApplies(t *testing.T) {
	types, err := epayPayTypes(Config{"payType": "qqpay"})
	if err != nil || len(types) != 1 || types[0] != "qqpay" {
		t.Fatalf("types = %v, %v", types, err)
	}
	if _, err := epayPayTypes(Config{"payTypes": "alipay,Bad Type"}); err == nil {
		t.Fatal("invalid pay type must be rejected")
	}
}

func TestEpaySettlementCurrencyGatesOrdersAndResults(t *testing.T) {
	const key = "usd-key"
	provider := NewEpayProvider(nil)
	config := Config{"pid": "1001", "key": key, "gateway": "https://pay.example", "submitMode": "submit", "settlementCurrency": "USD"}
	base := CreateRequest{MerchantOrderNo: "ORDER-U1", AmountFen: 999, NotifyURL: "https://merchant.example/notify"}
	cny := base
	cny.Currency = "CNY"
	if _, err := provider.CreateOrder(context.Background(), config, cny); err == nil {
		t.Fatal("USD gateway must reject CNY orders")
	}
	usd := base
	usd.Currency = "USD"
	if _, err := provider.CreateOrder(context.Background(), config, usd); err != nil {
		t.Fatal(err)
	}

	values := map[string]string{"pid": "1001", "trade_no": "T-U1", "out_trade_no": "ORDER-U1", "money": "9.99", "trade_status": "TRADE_SUCCESS"}
	values["sign"] = epayMD5Sign(values, key)
	form := url.Values{}
	for name, value := range values {
		form.Set(name, value)
	}
	notification, err := provider.VerifyNotification(context.Background(), config, nil, []byte(form.Encode()))
	if err != nil {
		t.Fatal(err)
	}
	if notification.Currency != "USD" || notification.AmountFen != 999 {
		t.Fatalf("notification = %#v", notification)
	}
}

func TestEpaySubmitModeConfigurationLimits(t *testing.T) {
	provider := NewEpayProvider(nil)
	base := Config{"pid": "1001", "key": "k", "gateway": "https://pay.example", "submitMode": "submit"}
	for name, override := range map[string]Config{
		"v2":        {"version": "1", "privateKey": "x", "platformPublicKey": "y"},
		"qr":        {"checkoutMode": "qr_code"},
		"mode":      {"submitMode": "form"},
		"currency":  {"settlementCurrency": "EUR"},
		"pay types": {"payTypes": "支付宝"},
	} {
		config := Config{}
		for key, value := range base {
			config[key] = value
		}
		for key, value := range override {
			config[key] = value
		}
		if err := provider.ValidateConfig(config); err == nil {
			t.Fatalf("%s: expected validation error", name)
		}
	}
}
