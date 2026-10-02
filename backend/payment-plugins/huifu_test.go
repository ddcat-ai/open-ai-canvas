package paymentplugins

import (
	"context"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestHuifuH5CreateOrderPostsOfficialPreorderFields(t *testing.T) {
	privateKey, publicKey := testRSAKeyPair(t)
	config := testHuifuConfig(privateKey, publicKey)
	fixedNow := time.Date(2026, 9, 27, 15, 4, 5, 0, huifuLocation())
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != huifuPreorderPath {
			t.Fatalf("request = %s %s", request.Method, request.URL.Path)
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(body, &captured); err != nil {
			t.Fatal(err)
		}
		data := captured["data"].(map[string]any)
		if captured["sys_id"] != "sys-1" || captured["product_id"] != "YYZY" {
			t.Fatalf("envelope = %#v", captured)
		}
		if data["pre_order_type"] != "1" || data["req_seq_id"] != "order-1" || data["trans_amt"] != "1.00" || data["huifu_id"] != "6666000109133323" {
			t.Fatalf("data = %#v", data)
		}
		if data["req_date"] != "20260927" || data["time_expire"] != "20260927153405" {
			t.Fatalf("time fields = %#v", data)
		}
		if data["notify_url"] != "https://merchant.example/api/payments/notify/huifu-h5-cashier/cfg" {
			t.Fatalf("notify_url = %v", data["notify_url"])
		}
		var hosting map[string]string
		if err := json.Unmarshal([]byte(data["hosting_data"].(string)), &hosting); err != nil {
			t.Fatal(err)
		}
		if hosting["request_type"] != "M" || hosting["project_id"] != "PROJECTID2023101225142567" || hosting["callback_url"] != "https://merchant.example/return" {
			t.Fatalf("hosting = %#v", hosting)
		}
		if captured["sign"] != huifuTestSign(t, config, data) {
			t.Fatalf("sign mismatch")
		}
		writeHuifuJSON(t, writer, config, map[string]any{
			"resp_code": "00000000", "resp_desc": "交易成功",
			"jump_url":    "https://api.huifu.com/hostingh5/?jump_id=H1&huifu_id=6666000109133323",
			"time_expire": "20260927153405", "pre_order_id": "H20260927",
		})
	}))
	defer server.Close()

	provider := NewHuifuH5Provider(server.Client())
	provider.baseURL = server.URL
	provider.now = func() time.Time { return fixedNow }
	checkout, err := provider.CreateOrder(context.Background(), config, CreateRequest{
		MerchantOrderNo: "order-1", Description: "100 积分", AmountFen: 100, Currency: "CNY",
		ExpiresAt: fixedNow.Add(30 * time.Minute),
		NotifyURL: "https://merchant.example/api/payments/notify/huifu-h5-cashier/cfg",
		ReturnURL: "https://merchant.example/return",
	})
	if err != nil {
		t.Fatal(err)
	}
	if checkout.Mode != "redirect" || !strings.HasPrefix(checkout.Value, "https://api.huifu.com/hostingh5/") {
		t.Fatalf("checkout = %#v", checkout)
	}
}

func TestHuifuH5QueryOrderMapsTransStatSuccess(t *testing.T) {
	privateKey, publicKey := testRSAKeyPair(t)
	config := testHuifuConfig(privateKey, publicKey)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != huifuQueryPath {
			t.Fatalf("path = %s", request.URL.Path)
		}
		writeHuifuJSON(t, writer, config, map[string]any{
			"resp_code": "00000000", "resp_desc": "操作成功",
			"org_req_seq_id": "order-1", "org_hf_seq_id": "HFSEQ1",
			"trans_stat": "S", "trans_amt": "1.00", "trans_time": "20260927153000",
			"org_req_date": "20260927",
		})
	}))
	defer server.Close()
	provider := NewHuifuH5Provider(server.Client())
	provider.baseURL = server.URL
	result, err := provider.QueryOrder(context.Background(), config, QueryRequest{MerchantOrderNo: "order-1"})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Paid || result.AmountFen != 100 || result.ProviderTradeNo != "HFSEQ1" || result.MerchantOrderNo != "order-1" {
		t.Fatalf("result = %#v", result)
	}
}

func TestHuifuH5CloseOrderSkipsWhenAlreadyPaid(t *testing.T) {
	privateKey, publicKey := testRSAKeyPair(t)
	config := testHuifuConfig(privateKey, publicKey)
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		paths = append(paths, request.URL.Path)
		writeHuifuJSON(t, writer, config, map[string]any{
			"resp_code": "00000000", "trans_stat": "S", "trans_amt": "1.00", "org_req_seq_id": "order-1",
		})
	}))
	defer server.Close()
	provider := NewHuifuH5Provider(server.Client())
	provider.baseURL = server.URL
	result, err := provider.CloseOrder(context.Background(), config, CloseRequest{MerchantOrderNo: "order-1"})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Paid || result.Closed {
		t.Fatalf("result = %#v", result)
	}
	if len(paths) != 1 || paths[0] != huifuQueryPath {
		t.Fatalf("paths = %#v", paths)
	}
}

func TestHuifuH5CloseOrderCallsOfficialCloseWhenUnpaid(t *testing.T) {
	privateKey, publicKey := testRSAKeyPair(t)
	config := testHuifuConfig(privateKey, publicKey)
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		paths = append(paths, request.URL.Path)
		if request.URL.Path == huifuQueryPath {
			writeHuifuJSON(t, writer, config, map[string]any{
				"resp_code": "00000000", "trans_stat": "P", "trans_amt": "1.00", "org_req_date": "20260927",
			})
			return
		}
		body, _ := io.ReadAll(request.Body)
		var envelope map[string]any
		_ = json.Unmarshal(body, &envelope)
		data := envelope["data"].(map[string]any)
		if data["org_req_seq_id"] != "order-1" || data["huifu_id"] != "6666000109133323" {
			t.Fatalf("close data = %#v", data)
		}
		writeHuifuJSON(t, writer, config, map[string]any{"resp_code": "00000000", "close_stat": "S", "org_trans_stat": "P"})
	}))
	defer server.Close()
	provider := NewHuifuH5Provider(server.Client())
	provider.baseURL = server.URL
	result, err := provider.CloseOrder(context.Background(), config, CloseRequest{MerchantOrderNo: "order-1"})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Closed || result.Paid {
		t.Fatalf("result = %#v", result)
	}
	if len(paths) != 2 || paths[1] != huifuClosePath {
		t.Fatalf("paths = %#v", paths)
	}
}

func TestHuifuH5VerifyNotificationUsesOfficialRespData(t *testing.T) {
	privateKey, publicKey := testRSAKeyPair(t)
	config := testHuifuConfig(privateKey, publicKey)
	respData := `{"huifu_id":"6666000109133323","req_seq_id":"order-1","trans_amt":"1.00","trans_stat":"S","hf_seq_id":"HFSEQ1","end_time":"20260927153000"}`
	signature, err := rsaSHA256Sign(privateKey, []byte(respData))
	if err != nil {
		t.Fatal(err)
	}
	form := url.Values{"resp_data": {respData}, "sign": {signature}}
	provider := NewHuifuH5Provider(http.DefaultClient)
	notification, err := provider.VerifyNotification(context.Background(), config, nil, []byte(form.Encode()))
	if err != nil {
		t.Fatal(err)
	}
	if !notification.Paid || notification.MerchantOrderNo != "order-1" || notification.AmountFen != 100 || notification.ProviderTradeNo != "HFSEQ1" {
		t.Fatalf("notification = %#v", notification)
	}
}

func TestHuifuH5VerifyNotificationRejectsBadSign(t *testing.T) {
	privateKey, publicKey := testRSAKeyPair(t)
	config := testHuifuConfig(privateKey, publicKey)
	form := url.Values{"resp_data": {`{"huifu_id":"6666000109133323","req_seq_id":"order-1","trans_amt":"1.00","trans_stat":"S"}`}, "sign": {"aaaa"}}
	provider := NewHuifuH5Provider(http.DefaultClient)
	if _, err := provider.VerifyNotification(context.Background(), config, nil, []byte(form.Encode())); err == nil {
		t.Fatal("expected signature error")
	}
}

func TestHuifuH5DownloadTradeBillIsNotOnH5API(t *testing.T) {
	privateKey, publicKey := testRSAKeyPair(t)
	provider := NewHuifuH5Provider(http.DefaultClient)
	_, err := provider.DownloadTradeBill(context.Background(), testHuifuConfig(privateKey, publicKey), time.Now())
	if !errors.Is(err, ErrTradeBillNotFound) {
		t.Fatalf("err = %v", err)
	}
}

func TestHuifuH5RejectsNotifyURLWithQuery(t *testing.T) {
	privateKey, publicKey := testRSAKeyPair(t)
	config := testHuifuConfig(privateKey, publicKey)
	provider := NewHuifuH5Provider(http.DefaultClient)
	_, err := provider.CreateOrder(context.Background(), config, CreateRequest{
		MerchantOrderNo: "order-1", Description: "x", AmountFen: 100, Currency: "CNY",
		NotifyURL: "https://merchant.example/notify?x=1",
	})
	if err == nil || !strings.Contains(err.Error(), "查询参数") {
		t.Fatalf("err = %v", err)
	}
}

func testHuifuConfig(merchantPrivate *rsa.PrivateKey, huifuPublic *rsa.PublicKey) Config {
	return Config{
		"publicBaseUrl":      "https://merchant.example",
		"sysId":              "sys-1",
		"productId":          "YYZY",
		"huifuId":            "6666000109133323",
		"projectId":          "PROJECTID2023101225142567",
		"projectTitle":       "收银台标题",
		"merchantPrivateKey": testPrivatePEM(merchantPrivate),
		"huifuPublicKey":     testPublicPEM(huifuPublic),
		"gateway":            "https://api.huifu.com",
	}
}

func writeHuifuJSON(t *testing.T, writer http.ResponseWriter, config Config, data map[string]any) {
	t.Helper()
	privateKey, err := parseRSAPrivateKey(config["merchantPrivateKey"])
	if err != nil {
		t.Fatal(err)
	}
	signature, err := rsaSHA256Sign(privateKey, []byte(huifuCanonical(data)))
	if err != nil {
		t.Fatal(err)
	}
	envelope := map[string]any{"data": data, "sign": signature}
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(envelope)
}

func huifuTestSign(t *testing.T, config Config, data map[string]any) string {
	t.Helper()
	privateKey, err := parseRSAPrivateKey(config["merchantPrivateKey"])
	if err != nil {
		t.Fatal(err)
	}
	signature, err := rsaSHA256Sign(privateKey, []byte(huifuCanonical(data)))
	if err != nil {
		t.Fatal(err)
	}
	return signature
}
