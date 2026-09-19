package paymentplugins

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	defaultZhiFuFMGateway = "https://api-5a0zvlcbi80.zhifu.fm.it88168.com/api"
	zhifuFMStartOrderPath = "/startOrder"
	zhifuFMQRLifetime     = 10 * time.Minute
)

type ZhiFuFMProvider struct {
	client *http.Client
	now    func() time.Time
}

func NewZhiFuFMProvider(client *http.Client) *ZhiFuFMProvider {
	if client == nil {
		client = http.DefaultClient
	}
	return &ZhiFuFMProvider{client: client, now: time.Now}
}

func (p *ZhiFuFMProvider) Descriptor() Descriptor {
	return Descriptor{
		ID: ProviderZhiFuFM, PluginID: PluginZhiFuFM, PluginVersion: "1.0.0",
		Name: "支付FM", Icon: "assets/icon.svg", CheckoutMode: "redirect",
		IdentityFields:      []string{"merchantNum"},
		NotificationSuccess: NotificationResponse{Status: 200, ContentType: "text/plain; charset=utf-8", Body: "success"},
		NotificationFailure: NotificationResponse{Status: 400, ContentType: "text/plain; charset=utf-8", Body: "fail"},
	}
}

func (p *ZhiFuFMProvider) ValidateConfig(config Config) error {
	if strings.TrimSpace(config["merchantNum"]) == "" {
		return errors.New("支付FM配置缺少商户号 merchantNum")
	}
	if strings.TrimSpace(config["secretKey"]) == "" {
		return errors.New("支付FM配置缺少接入密钥 secretKey")
	}
	mode := zhifuFMCheckoutMode(config)
	if mode != "qr_code" && mode != "redirect" {
		return errors.New("支付FM checkoutMode 必须是 qr_code 或 redirect")
	}
	gateway := zhifuFMGateway(config)
	if _, err := url.Parse(gateway); err != nil || (!strings.HasPrefix(gateway, "http://") && !strings.HasPrefix(gateway, "https://")) {
		return fmt.Errorf("支付FM网关地址无效: %s", gateway)
	}
	return nil
}

type zhifuFMStartOrderResponse struct {
	Success   bool   `json:"success"`
	Code      int    `json:"code"`
	Msg       string `json:"msg"`
	Timestamp int64  `json:"timestamp"`
	Data      struct {
		ID     string `json:"id"`
		PayURL string `json:"payUrl"`
	} `json:"data"`
}

func (p *ZhiFuFMProvider) CreateOrder(ctx context.Context, config Config, request CreateRequest) (Checkout, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Checkout{}, err
	}
	if request.AmountFen <= 0 || request.Currency != "CNY" || request.MerchantOrderNo == "" || request.NotifyURL == "" {
		return Checkout{}, errors.New("支付FM下单参数无效")
	}

	merchantNum := strings.TrimSpace(config["merchantNum"])
	secretKey := strings.TrimSpace(config["secretKey"])
	amountYuan := fmt.Sprintf("%.2f", float64(request.AmountFen)/100.0)

	// sign = md5(商户号 + 商户订单号 + 支付金额 + 异步通知地址 + 接入密钥)
	signRaw := merchantNum + request.MerchantOrderNo + amountYuan + request.NotifyURL + secretKey
	sign := md5Hex(signRaw)

	payType := strings.TrimSpace(config["payType"])
	if payType == "" {
		payType = "alipay"
	}

	form := url.Values{}
	form.Set("merchantNum", merchantNum)
	form.Set("orderNo", request.MerchantOrderNo)
	form.Set("amount", amountYuan)
	form.Set("notifyUrl", request.NotifyURL)
	form.Set("payType", payType)
	form.Set("sign", sign)
	form.Set("returnType", "json")
	form.Set("apiMode", "post_form")
	if request.ReturnURL != "" {
		form.Set("returnUrl", request.ReturnURL)
	}
	if request.Description != "" {
		form.Set("subject", request.Description)
	}

	gateway := zhifuFMGateway(config)
	endpoint := strings.TrimSuffix(gateway, "/") + zhifuFMStartOrderPath

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return Checkout{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := p.client.Do(req)
	if err != nil {
		return Checkout{}, &ProviderError{Code: "zhifufm_transport_error", Message: "支付FM网络请求失败", Temporary: true, Cause: err}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return Checkout{}, &ProviderError{Code: "zhifufm_response_read_error", Message: "读取支付FM响应失败", Temporary: true, Cause: err}
	}

	var res zhifuFMStartOrderResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return Checkout{}, &ProviderError{Code: "zhifufm_response_parse_error", Message: fmt.Sprintf("解析支付FM响应失败 (HTTP %d): %s", resp.StatusCode, string(body)), Temporary: true, Cause: err}
	}

	if !res.Success || res.Code != 200 || res.Data.PayURL == "" {
		msg := res.Msg
		if msg == "" {
			msg = fmt.Sprintf("创建订单失败(code=%d)", res.Code)
		}
		return Checkout{}, &ProviderError{Code: "zhifufm_order_create_failed", Message: fmt.Sprintf("支付FM创建订单失败: %s", msg)}
	}

	mode := zhifuFMCheckoutMode(config)
	expiresAt := request.ExpiresAt
	if expiresAt.IsZero() {
		expiresAt = p.now().Add(zhifuFMQRLifetime)
	}

	return Checkout{
		Mode:      mode,
		Value:     res.Data.PayURL,
		ExpiresAt: expiresAt,
	}, nil
}

func (p *ZhiFuFMProvider) QueryOrder(ctx context.Context, config Config, request QueryRequest) (Result, error) {
	return Result{
		MerchantOrderNo: request.MerchantOrderNo,
		Currency:        "CNY",
	}, nil
}

func (p *ZhiFuFMProvider) CloseOrder(ctx context.Context, config Config, request CloseRequest) (Result, error) {
	return Result{
		MerchantOrderNo: request.MerchantOrderNo,
		Closed:          true,
		ProviderStatus:  "CLOSED",
		Currency:        "CNY",
	}, nil
}

func (p *ZhiFuFMProvider) VerifyNotification(_ context.Context, config Config, headers http.Header, rawBody []byte) (Notification, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Notification{}, err
	}

	params, err := parseNotificationValues(rawBody)
	if err != nil {
		return Notification{}, err
	}

	merchantNum := strings.TrimSpace(params.Get("merchantNum"))
	orderNo := strings.TrimSpace(params.Get("orderNo"))
	amountStr := strings.TrimSpace(params.Get("amount"))
	state := strings.TrimSpace(params.Get("state"))
	platformOrderNo := strings.TrimSpace(params.Get("platformOrderNo"))
	sign := strings.TrimSpace(params.Get("sign"))

	if merchantNum != strings.TrimSpace(config["merchantNum"]) {
		return Notification{}, errors.New("支付FM异步通知商户号不匹配")
	}

	// 验签: sign = md5(state + merchantNum + orderNo + amount + secretKey)
	expectedSign := md5Hex(state + merchantNum + orderNo + amountStr + strings.TrimSpace(config["secretKey"]))
	if !strings.EqualFold(sign, expectedSign) {
		return Notification{}, fmt.Errorf("支付FM异步通知签名不匹配: got %s, want %s", sign, expectedSign)
	}

	actualAmountStr := strings.TrimSpace(params.Get("actualPayAmount"))
	targetAmountStr := amountStr
	if actualAmountStr != "" {
		targetAmountStr = actualAmountStr
	}

	amountFen, err := parseYuanToFen(targetAmountStr)
	if err != nil {
		amountFen, err = parseYuanToFen(amountStr)
		if err != nil {
			return Notification{}, fmt.Errorf("支付FM异步通知金额格式错误: %s", amountStr)
		}
	}

	paid := state == "1"
	paidAt := time.Now()
	if payTimeStr := strings.TrimSpace(params.Get("payTime")); payTimeStr != "" {
		if t, err := time.ParseInLocation("2006-01-02 15:04:05", payTimeStr, time.Local); err == nil {
			paidAt = t
		}
	}

	eventID := platformOrderNo
	if eventID == "" {
		eventID = orderNo + ":" + state
	}

	return Notification{
		EventID: eventID,
		Result: Result{
			MerchantOrderNo: orderNo,
			ProviderTradeNo: platformOrderNo,
			ProviderStatus:  state,
			AmountFen:       amountFen,
			Currency:        "CNY",
			Paid:            paid,
			Closed:          !paid,
			PaidAt:          paidAt,
		},
	}, nil
}

func (p *ZhiFuFMProvider) DownloadTradeBill(context.Context, Config, time.Time) ([]BillRecord, error) {
	return nil, fmt.Errorf("%w: 支付FM未提供交易账单下载接口", ErrTradeBillNotFound)
}

func zhifuFMGateway(config Config) string {
	g := strings.TrimSpace(config["gateway"])
	if g == "" {
		return defaultZhiFuFMGateway
	}
	return strings.TrimSuffix(g, "/")
}

func zhifuFMCheckoutMode(config Config) string {
	mode := strings.TrimSpace(config["checkoutMode"])
	if mode == "qr_code" {
		return "qr_code"
	}
	return "redirect"
}

func md5Hex(s string) string {
	h := md5.Sum([]byte(s))
	return hex.EncodeToString(h[:])
}

func parseNotificationValues(rawBody []byte) (url.Values, error) {
	bodyStr := string(rawBody)
	if strings.Contains(bodyStr, "=") {
		return url.ParseQuery(bodyStr)
	}
	var jsonMap map[string]any
	if err := json.Unmarshal(rawBody, &jsonMap); err == nil {
		vals := url.Values{}
		for k, v := range jsonMap {
			switch val := v.(type) {
			case string:
				vals.Set(k, val)
			case float64:
				vals.Set(k, strconv.FormatFloat(val, 'f', -1, 64))
			case int64:
				vals.Set(k, strconv.FormatInt(val, 10))
			default:
				vals.Set(k, fmt.Sprint(v))
			}
		}
		return vals, nil
	}
	return nil, errors.New("无法解析支付通知内容")
}
