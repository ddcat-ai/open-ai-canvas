package paymentplugins

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestWeChatNativeCreateOrderSignsRequestAndReturnsQRCode(t *testing.T) {
	merchantPrivate, merchantPublic := testRSAKeyPair(t)
	platformPrivate, platformPublic := testRSAKeyPair(t)
	fixedNow := time.Date(2026, 9, 2, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	config := testWeChatConfig(merchantPrivate, platformPublic)

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/v3/pay/transactions/native" {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(request.Header.Get("Authorization"), `mchid="1900000001"`) {
			t.Fatalf("authorization = %q", request.Header.Get("Authorization"))
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatal(err)
		}
		if payload["out_trade_no"] != "0123456789abcdef0123456789abcdef" {
			t.Fatalf("out_trade_no = %v", payload["out_trade_no"])
		}
		responseBody := []byte(`{"code_url":"weixin://wxpay/bizpayurl?pr=test"}`)
		timestamp, nonce := fixedNow.Unix(), "response-nonce"
		signature, err := rsaSHA256Sign(platformPrivate, []byte(testWeChatMessage(timestamp, nonce, responseBody)))
		if err != nil {
			t.Fatal(err)
		}
		writer.Header().Set("Wechatpay-Timestamp", "1788321600")
		writer.Header().Set("Wechatpay-Nonce", nonce)
		writer.Header().Set("Wechatpay-Serial", "PUB_KEY_ID_3000000001")
		writer.Header().Set("Wechatpay-Signature", signature)
		_, _ = writer.Write(responseBody)
	}))
	defer server.Close()

	provider := NewWeChatProvider(server.Client(), server.URL)
	provider.now = func() time.Time { return fixedNow }
	checkout, err := provider.CreateOrder(context.Background(), config, CreateRequest{
		MerchantOrderNo: "0123456789abcdef0123456789abcdef", Description: "100 积分",
		AmountFen: 100, Currency: "CNY", ExpiresAt: fixedNow.Add(30 * time.Minute), NotifyURL: "https://merchant.example/api/notify",
	})
	if err != nil {
		t.Fatal(err)
	}
	if checkout.Mode != "qr_code" || !strings.HasPrefix(checkout.Value, "weixin://") || !checkout.ExpiresAt.Equal(fixedNow.Add(30*time.Minute)) {
		t.Fatalf("checkout = %#v", checkout)
	}
	_ = merchantPublic
}

func TestWeChatNotificationVerifiesAndDecrypts(t *testing.T) {
	merchantPrivate, _ := testRSAKeyPair(t)
	platformPrivate, platformPublic := testRSAKeyPair(t)
	fixedNow := time.Date(2026, 9, 2, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	config := testWeChatConfig(merchantPrivate, platformPublic)
	transaction := []byte(`{"appid":"wx-app","mchid":"1900000001","out_trade_no":"0123456789abcdef0123456789abcdef","transaction_id":"420000001","trade_type":"NATIVE","trade_state":"SUCCESS","success_time":"2026-09-02T11:59:00+08:00","amount":{"total":100,"currency":"CNY"}}`)
	ciphertext := encryptWeChatTestResource(t, config["apiV3Key"], "0123456789ab", "transaction", transaction)
	envelope, err := json.Marshal(map[string]any{
		"id": "EV-1", "event_type": "TRANSACTION.SUCCESS", "resource_type": "encrypt-resource",
		"resource": map[string]any{"algorithm": "AEAD_AES_256_GCM", "ciphertext": ciphertext, "associated_data": "transaction", "nonce": "0123456789ab"},
	})
	if err != nil {
		t.Fatal(err)
	}
	nonce := "notification-nonce"
	signature, err := rsaSHA256Sign(platformPrivate, []byte(testWeChatMessage(fixedNow.Unix(), nonce, envelope)))
	if err != nil {
		t.Fatal(err)
	}
	headers := http.Header{
		"Wechatpay-Timestamp": {"1788321600"}, "Wechatpay-Nonce": {nonce},
		"Wechatpay-Serial": {"PUB_KEY_ID_3000000001"}, "Wechatpay-Signature": {signature},
	}
	provider := NewWeChatProvider(http.DefaultClient, "https://example.invalid")
	provider.now = func() time.Time { return fixedNow }
	notification, err := provider.VerifyNotification(context.Background(), config, headers, envelope)
	if err != nil {
		t.Fatal(err)
	}
	if notification.EventID != "EV-1" || !notification.Paid || notification.AmountFen != 100 || notification.ProviderTradeNo != "420000001" {
		t.Fatalf("notification = %#v", notification)
	}
}

func TestWeChatMissingTradeBillUsesBillSentinel(t *testing.T) {
	merchantPrivate, _ := testRSAKeyPair(t)
	platformPrivate, platformPublic := testRSAKeyPair(t)
	fixedNow := time.Date(2026, 9, 2, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	config := testWeChatConfig(merchantPrivate, platformPublic)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		body := []byte(`{"code":"NO_STATEMENT_EXIST","message":"not ready"}`)
		nonce := "bill-response-nonce"
		signature, err := rsaSHA256Sign(platformPrivate, []byte(testWeChatMessage(fixedNow.Unix(), nonce, body)))
		if err != nil {
			t.Fatal(err)
		}
		writer.Header().Set("Wechatpay-Timestamp", strconv.FormatInt(fixedNow.Unix(), 10))
		writer.Header().Set("Wechatpay-Nonce", nonce)
		writer.Header().Set("Wechatpay-Serial", "PUB_KEY_ID_3000000001")
		writer.Header().Set("Wechatpay-Signature", signature)
		writer.WriteHeader(http.StatusNotFound)
		_, _ = writer.Write(body)
	}))
	defer server.Close()

	provider := NewWeChatProvider(server.Client(), server.URL)
	provider.now = func() time.Time { return fixedNow }
	_, err := provider.DownloadTradeBill(context.Background(), config, fixedNow.AddDate(0, 0, -1))
	if !errors.Is(err, ErrTradeBillNotFound) {
		t.Fatalf("error = %v", err)
	}
}

func TestAlipayPagePayBuildsSignedDesktopCheckout(t *testing.T) {
	merchantPrivate, merchantPublic := testRSAKeyPair(t)
	_, alipayPublic := testRSAKeyPair(t)
	config := testAlipayConfig(merchantPrivate, alipayPublic)
	provider := NewAlipayProvider(http.DefaultClient)
	fixedNow := time.Date(2026, 9, 2, 12, 0, 0, 0, time.FixedZone("CST", 8*60*60))
	provider.now = func() time.Time { return fixedNow.Add(time.Second) }
	checkout, err := provider.CreateOrder(context.Background(), config, CreateRequest{
		MerchantOrderNo: "0123456789abcdef0123456789abcdef", Description: "100 积分",
		AmountFen: 100, Currency: "CNY", ExpiresAt: fixedNow.Add(30 * time.Minute),
		NotifyURL: "https://merchant.example/api/notify", ReturnURL: "https://merchant.example/api/return",
	})
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(checkout.Value)
	if err != nil {
		t.Fatal(err)
	}
	params := parsed.Query()
	signature := params.Get("sign")
	params.Del("sign")
	if err := rsaSHA256Verify(merchantPublic, []byte(canonicalAlipayParams(params)), signature); err != nil {
		t.Fatalf("checkout signature: %v", err)
	}
	if params.Get("method") != "alipay.trade.page.pay" || !strings.Contains(params.Get("biz_content"), `"product_code":"FAST_INSTANT_TRADE_PAY"`) || !strings.Contains(params.Get("biz_content"), `"timeout_express":"30m"`) {
		t.Fatalf("params = %v", params)
	}
}

func TestAlipayRejectsNonOfficialGateway(t *testing.T) {
	merchantPrivate, _ := testRSAKeyPair(t)
	_, alipayPublic := testRSAKeyPair(t)
	config := testAlipayConfig(merchantPrivate, alipayPublic)
	config["gateway"] = "https://evil.example/gateway.do"
	if err := NewAlipayProvider(http.DefaultClient).ValidateConfig(config); err == nil {
		t.Fatal("expected non-official gateway error")
	}
}

func TestAlipayNotificationVerifiesMerchantAndAmount(t *testing.T) {
	merchantPrivate, _ := testRSAKeyPair(t)
	alipayPrivate, alipayPublic := testRSAKeyPair(t)
	config := testAlipayConfig(merchantPrivate, alipayPublic)
	values := url.Values{
		"notify_id": {"notify-1"}, "app_id": {"2026000000000001"}, "seller_id": {"2088000000000001"},
		"out_trade_no": {"0123456789abcdef0123456789abcdef"}, "trade_no": {"2026090200001"},
		"trade_status": {"TRADE_SUCCESS"}, "total_amount": {"1.00"}, "gmt_payment": {"2026-09-02 12:00:00"},
		"sign_type": {"RSA2"},
	}
	unsigned := cloneURLValues(values)
	unsigned.Del("sign_type")
	signature, err := rsaSHA256Sign(alipayPrivate, []byte(canonicalAlipayParams(unsigned)))
	if err != nil {
		t.Fatal(err)
	}
	values.Set("sign", signature)
	provider := NewAlipayProvider(http.DefaultClient)
	notification, err := provider.VerifyNotification(context.Background(), config, nil, []byte(values.Encode()))
	if err != nil {
		t.Fatal(err)
	}
	if notification.EventID != "notify-1" || !notification.Paid || notification.AmountFen != 100 || notification.Currency != "CNY" {
		t.Fatalf("notification = %#v", notification)
	}
}

func TestParseYuanToFenUsesExactDecimalArithmetic(t *testing.T) {
	for value, expected := range map[string]int64{"0.01": 1, "1": 100, "1.2": 120, "1000000.99": 100000099} {
		actual, err := parseYuanToFen(value)
		if err != nil || actual != expected {
			t.Fatalf("parseYuanToFen(%q) = %d, %v; want %d", value, actual, err, expected)
		}
	}
	if _, err := parseYuanToFen("1.001"); err == nil {
		t.Fatal("expected precision error")
	}
	if _, err := parseYuanToFen("92233720368547758.08"); err == nil {
		t.Fatal("expected overflow error")
	}
}

func TestRSAKeyParsersAcceptRawBase64(t *testing.T) {
	privateKey, publicKey := testRSAKeyPair(t)
	privateDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parseRSAPrivateKey(base64.StdEncoding.EncodeToString(privateDER)); err != nil {
		t.Fatal(err)
	}
	if _, err := parseRSAPublicKey(base64.StdEncoding.EncodeToString(publicDER)); err != nil {
		t.Fatal(err)
	}
}

func testRSAKeyPair(t *testing.T) (*rsa.PrivateKey, *rsa.PublicKey) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return privateKey, &privateKey.PublicKey
}

func testPrivatePEM(key *rsa.PrivateKey) string {
	encoded, _ := x509.MarshalPKCS8PrivateKey(key)
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}))
}

func testPublicPEM(key *rsa.PublicKey) string {
	encoded, _ := x509.MarshalPKIXPublicKey(key)
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: encoded}))
}

func testWeChatConfig(merchantPrivate *rsa.PrivateKey, platformPublic *rsa.PublicKey) Config {
	return Config{
		"appId": "wx-app", "mchId": "1900000001", "merchantSerialNo": "MERCHANT-SERIAL",
		"merchantPrivateKey": testPrivatePEM(merchantPrivate), "apiV3Key": "0123456789abcdef0123456789abcdef",
		"wechatPayPublicKeyId": "PUB_KEY_ID_3000000001", "wechatPayPublicKey": testPublicPEM(platformPublic),
	}
}

func testAlipayConfig(merchantPrivate *rsa.PrivateKey, alipayPublic *rsa.PublicKey) Config {
	return Config{
		"appId": "2026000000000001", "sellerId": "2088000000000001", "merchantPrivateKey": testPrivatePEM(merchantPrivate),
		"alipayPublicKey": testPublicPEM(alipayPublic), "gateway": "https://openapi.alipay.com/gateway.do",
	}
}

func testWeChatMessage(timestamp int64, nonce string, body []byte) string {
	return strconv.FormatInt(timestamp, 10) + "\n" + nonce + "\n" + string(body) + "\n"
}

func encryptWeChatTestResource(t *testing.T, key, nonce, associatedData string, plaintext []byte) string {
	t.Helper()
	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		t.Fatal(err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nil, []byte(nonce), plaintext, []byte(associatedData)))
}
