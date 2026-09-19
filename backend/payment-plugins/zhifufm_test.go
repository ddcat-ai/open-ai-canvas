package paymentplugins

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestZhiFuFMProviderCreateOrderAndVerifyNotification(t *testing.T) {
	merchantNum := "694771317639364608"
	secretKey := "f17bc85d99c1d2b4b4d81eaba1489c7e"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/startOrder" {
			http.NotFound(w, r)
			return
		}
		body, _ := io.ReadAll(r.Body)
		vals, _ := parseNotificationValues(body)
		if vals.Get("merchantNum") != merchantNum {
			t.Errorf("got merchantNum = %q, want %q", vals.Get("merchantNum"), merchantNum)
		}
		expectedSign := md5Hex(merchantNum + vals.Get("orderNo") + vals.Get("amount") + vals.Get("notifyUrl") + secretKey)
		if vals.Get("sign") != expectedSign {
			t.Errorf("got sign = %q, want %q", vals.Get("sign"), expectedSign)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{
			"success": true,
			"code": 200,
			"msg": "success",
			"timestamp": 1720000000000,
			"data": {
				"id": "ZFM202609180001",
				"payUrl": "https://page.zhifu.fm/pay?id=ZFM202609180001"
			}
		}`))
	}))
	defer server.Close()

	provider := NewZhiFuFMProvider(server.Client())
	config := Config{
		"merchantNum":  merchantNum,
		"secretKey":    secretKey,
		"gateway":      server.URL,
		"checkoutMode": "redirect",
	}

	checkout, err := provider.CreateOrder(context.Background(), config, CreateRequest{
		MerchantOrderNo: "TEST_ORDER_12345",
		Description:     "充值 1000 积分",
		AmountFen:       1000, // 10.00 元
		Currency:        "CNY",
		NotifyURL:       "https://my.domain/api/payments/notify",
		ExpiresAt:       time.Now().Add(10 * time.Minute),
	})
	if err != nil {
		t.Fatalf("CreateOrder failed: %v", err)
	}
	if checkout.Mode != "redirect" || checkout.Value != "https://page.zhifu.fm/pay?id=ZFM202609180001" {
		t.Fatalf("unexpected checkout: %#v", checkout)
	}

	// 模拟异步通知回调
	// sign = md5(state + merchantNum + orderNo + amount + secretKey)
	state := "1"
	orderNo := "TEST_ORDER_12345"
	amount := "10.00"
	notifySign := md5Hex(state + merchantNum + orderNo + amount + secretKey)
	notifyForm := "merchantNum=" + merchantNum + "&orderNo=" + orderNo + "&amount=" + amount + "&state=" + state + "&platformOrderNo=ZFM202609180001&payTime=2026-09-18+12:00:00&sign=" + notifySign

	notification, err := provider.VerifyNotification(context.Background(), config, nil, []byte(notifyForm))
	if err != nil {
		t.Fatalf("VerifyNotification failed: %v", err)
	}
	if !notification.Paid || notification.AmountFen != 1000 || notification.MerchantOrderNo != "TEST_ORDER_12345" {
		t.Fatalf("unexpected notification: %#v", notification)
	}
}
