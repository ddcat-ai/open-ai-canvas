package paymentplugins

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	epayPluginVersion = "1.0.9"
	epayQRLifetime    = 10 * time.Minute
	maxEpayResponse   = 2 << 20
)

type EpayProvider struct {
	client *http.Client
	now    func() time.Time
}

func NewEpayProvider(client *http.Client) *EpayProvider {
	if client == nil {
		client = http.DefaultClient
	}
	return &EpayProvider{client: client, now: time.Now}
}

func (p *EpayProvider) Descriptor() Descriptor {
	return Descriptor{
		ID: ProviderEpay, PluginID: PluginEpay, PluginVersion: epayPluginVersion,
		Name: "易支付", Icon: "assets/icon.svg", CheckoutMode: "redirect",
		IdentityFields:      []string{"pid"},
		NotificationSuccess: NotificationResponse{Status: 200, ContentType: "text/plain; charset=utf-8", Body: "success"},
		NotificationFailure: NotificationResponse{Status: 400, ContentType: "text/plain; charset=utf-8", Body: "failure"},
	}
}

func (p *EpayProvider) ValidateConfig(config Config) error {
	if strings.TrimSpace(config["pid"]) == "" {
		return errors.New("易支付配置缺少商户号 pid")
	}
	version := epayVersion(config)
	if version != "0" && version != "1" {
		return errors.New("易支付 version 必须是 0 或 1")
	}
	if version == "0" && strings.TrimSpace(config["key"]) == "" {
		return errors.New("易支付 V1 配置缺少商户密钥 key")
	}
	if version == "1" {
		if strings.TrimSpace(config["privateKey"]) == "" || strings.TrimSpace(config["platformPublicKey"]) == "" {
			return errors.New("易支付 V2 配置缺少 privateKey 或 platformPublicKey")
		}
		if _, err := parseRSAPrivateKey(config["privateKey"]); err != nil {
			return fmt.Errorf("易支付商户私钥无效: %w", err)
		}
		if _, err := parseRSAPublicKey(config["platformPublicKey"]); err != nil {
			return fmt.Errorf("易支付平台公钥无效: %w", err)
		}
	}
	if _, err := epayGateway(config); err != nil {
		return err
	}
	return nil
}

func (p *EpayProvider) CreateOrder(ctx context.Context, config Config, request CreateRequest) (Checkout, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Checkout{}, err
	}
	if request.AmountFen <= 0 || request.Currency != "CNY" || strings.TrimSpace(request.MerchantOrderNo) == "" || strings.TrimSpace(request.NotifyURL) == "" {
		return Checkout{}, errors.New("易支付下单参数无效")
	}

	params := map[string]string{
		"pid":          strings.TrimSpace(config["pid"]),
		"name":         epayTitle(request.Description, request.MerchantOrderNo),
		"type":         epayPayType(config),
		"money":        formatEpayAmount(request.AmountFen),
		"out_trade_no": request.MerchantOrderNo,
		"notify_url":   request.NotifyURL,
		"return_url":   request.ReturnURL,
		"sitename":     request.MerchantOrderNo,
		// CreateRequest 不带买家 IP；mapi 仍要求 clientip，占位即可。
		"clientip": "0.0.0.0",
		"device":   epayDevice(config),
	}

	version := epayVersion(config)
	path := "/mapi.php"
	successCode := "1"
	if version == "1" {
		params["method"] = "jump"
		params["timestamp"] = strconv.FormatInt(p.now().Unix(), 10)
		signature, err := epayRSASign(params, config["privateKey"])
		if err != nil {
			return Checkout{}, &ProviderError{Code: "epay_sign_failed", Message: "易支付请求签名失败", Cause: err}
		}
		params["sign"] = signature
		params["sign_type"] = "RSA"
		path = "/api/pay/create"
		successCode = "0"
	} else {
		params["sign"] = epayMD5Sign(params, config["key"])
		params["sign_type"] = "MD5"
	}

	response, status, err := p.postForm(ctx, config, path, params)
	if err != nil {
		return Checkout{}, err
	}
	if response["code"] != successCode {
		message := strings.TrimSpace(epayString(response["msg"]))
		if message == "" {
			message = fmt.Sprintf("易支付返回失败状态 code=%s", response["code"])
		}
		return Checkout{}, &ProviderError{Code: "epay_order_create_failed", Message: message, Temporary: status >= 500}
	}

	mode := epayCheckoutMode(config)
	var value string
	if version == "1" {
		// method=jump 只会返回跳转地址
		value = epayString(response["pay_info"])
		mode = "redirect"
	} else {
		// payurl、qrcode、urlscheme 三者只会返回其一
		qrcode := epayString(response["qrcode"])
		if mode == "qr_code" && qrcode != "" {
			value = qrcode
		} else {
			// urlscheme 是小程序跳转链接，前端直接跳；没有本地收银台时二维码链接也直接跳过去
			value = firstNonEmpty(epayString(response["payurl"]), epayString(response["urlscheme"]), qrcode)
			mode = "redirect"
		}
	}
	if !isEpayURL(value) {
		return Checkout{}, &ProviderError{Code: "epay_invalid_checkout", Message: "易支付未返回有效的支付地址"}
	}

	expiresAt := request.ExpiresAt
	if expiresAt.IsZero() {
		expiresAt = p.now().Add(epayQRLifetime)
	}
	return Checkout{Mode: mode, Value: value, ExpiresAt: expiresAt}, nil
}

func (p *EpayProvider) QueryOrder(ctx context.Context, config Config, request QueryRequest) (Result, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(request.MerchantOrderNo) == "" {
		return Result{}, errors.New("易支付查单缺少商户订单号")
	}
	if epayVersion(config) == "1" {
		return Result{}, &ProviderError{Code: "epay_query_unsupported", Message: "易支付 V2 查单接口未在当前协议中实现"}
	}

	base, _ := epayGateway(config)
	query := url.Values{}
	query.Set("act", "order")
	query.Set("pid", strings.TrimSpace(config["pid"]))
	query.Set("key", strings.TrimSpace(config["key"]))
	query.Set("out_trade_no", request.MerchantOrderNo)
	endpoint := strings.TrimRight(base, "/") + "/api.php?" + query.Encode()
	response, status, err := p.getJSON(ctx, endpoint)
	if err != nil {
		return Result{}, err
	}
	if response["code"] != "1" {
		message := strings.TrimSpace(epayString(response["msg"]))
		if message == "" {
			message = "易支付订单不存在或查询失败"
		}
		return Result{}, &ProviderError{Code: "epay_query_failed", Message: message, Temporary: status >= 500}
	}
	if response["pid"] != "" && response["pid"] != strings.TrimSpace(config["pid"]) {
		return Result{}, errors.New("易支付查单商户号不匹配")
	}
	return epayResult(response, request.MerchantOrderNo)
}

func (p *EpayProvider) CloseOrder(ctx context.Context, config Config, request CloseRequest) (Result, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(request.MerchantOrderNo) == "" {
		return Result{}, errors.New("易支付关单缺少商户订单号")
	}
	if epayVersion(config) == "0" {
		result, err := p.QueryOrder(ctx, config, QueryRequest{MerchantOrderNo: request.MerchantOrderNo})
		if err != nil {
			return Result{}, err
		}
		if result.Paid {
			return result, nil
		}
		result.Closed = true
		result.ProviderStatus = "TRADE_CLOSED"
		return result, nil
	}
	// 未能查证上游状态时不能把未知订单标为已关闭。
	return Result{}, &ProviderError{Code: "epay_close_unsupported", Message: "易支付 V2 暂不支持查单及安全关单，请在支付网关核对订单"}
}

func (p *EpayProvider) VerifyNotification(_ context.Context, config Config, _ http.Header, rawBody []byte) (Notification, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Notification{}, err
	}
	params, err := parseNotificationValues(rawBody)
	if err != nil {
		return Notification{}, fmt.Errorf("解析易支付异步通知失败: %w", err)
	}
	values := make(map[string]string, len(params))
	for key, items := range params {
		if len(items) != 1 {
			return Notification{}, errors.New("易支付异步通知存在重复参数")
		}
		values[key] = items[0]
	}
	if values["pid"] != strings.TrimSpace(config["pid"]) {
		return Notification{}, errors.New("易支付异步通知商户号不匹配")
	}
	if strings.TrimSpace(values["out_trade_no"]) == "" || strings.TrimSpace(values["money"]) == "" {
		return Notification{}, errors.New("易支付异步通知缺少订单号或金额")
	}

	if epayVersion(config) == "1" {
		signType := strings.ToUpper(strings.TrimSpace(values["sign_type"]))
		if signType != "" && signType != "RSA" && signType != "RSA2" {
			return Notification{}, errors.New("易支付异步通知签名类型无效")
		}
		publicKey, err := parseRSAPublicKey(config["platformPublicKey"])
		if err != nil {
			return Notification{}, err
		}
		if err := rsaSHA256Verify(publicKey, []byte(epayCanonical(values)), values["sign"]); err != nil {
			return Notification{}, errors.New("易支付异步通知 RSA 签名无效")
		}
	} else {
		signType := strings.ToUpper(strings.TrimSpace(values["sign_type"]))
		if signType != "" && signType != "MD5" {
			return Notification{}, errors.New("易支付异步通知签名类型无效")
		}
		// 定时安全比较，且只吃字符串（挡掉 sign 传数组/缺失）；与其它支付插件一致
		if !epaySafetyEquals(values["sign"], epayMD5Sign(values, config["key"])) {
			return Notification{}, errors.New("易支付异步通知 MD5 签名无效")
		}
	}

	amount, err := parseYuanToFen(values["money"])
	if err != nil || amount <= 0 {
		return Notification{}, errors.New("易支付异步通知金额无效")
	}
	status := strings.TrimSpace(values["trade_status"])
	// 宿主通知队列只处理到账事件，其他状态不得占用同一流水的幂等键。
	if status != "TRADE_SUCCESS" {
		return Notification{}, errors.New("易支付异步通知不是成功状态")
	}
	providerTradeNo := firstNonEmpty(values["trade_no"], values["api_trade_no"])
	if providerTradeNo == "" {
		return Notification{}, errors.New("易支付成功通知缺少支付流水号")
	}
	eventID := firstNonEmpty(values["notify_id"], providerTradeNo, values["out_trade_no"]+":"+status)
	return Notification{
		EventID: eventID,
		Result: Result{
			MerchantOrderNo: values["out_trade_no"], ProviderTradeNo: providerTradeNo,
			ProviderStatus: status, AmountFen: amount, Currency: "CNY",
			Paid: true, PaidAt: parseEpayTime(firstNonEmpty(values["endtime"], values["gmt_payment"])),
		},
	}, nil
}

func (p *EpayProvider) DownloadTradeBill(context.Context, Config, time.Time) ([]BillRecord, error) {
	return nil, fmt.Errorf("%w: 易支付未提供统一账单下载接口", ErrTradeBillNotFound)
}

type epayResponse map[string]string

func (p *EpayProvider) postForm(ctx context.Context, config Config, path string, values map[string]string) (epayResponse, int, error) {
	base, err := epayGateway(config)
	if err != nil {
		return nil, 0, err
	}
	form := url.Values{}
	for key, value := range values {
		form.Set(key, value)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(base, "/")+path, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	// 网关卡住不能一直等；超时由注入的 http.Client 控制（RPC 入口约 25s）
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, 0, &ProviderError{Code: "epay_transport_error", Message: "易支付网络请求失败", Temporary: true, Cause: err}
	}
	defer resp.Body.Close()
	return epayJSONResponse(resp)
}

func (p *EpayProvider) getJSON(ctx context.Context, endpoint string) (epayResponse, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, 0, err
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return nil, 0, &ProviderError{Code: "epay_transport_error", Message: "易支付网络请求失败", Temporary: true, Cause: err}
	}
	defer resp.Body.Close()
	return epayJSONResponse(resp)
}

func epayJSONResponse(resp *http.Response) (epayResponse, int, error) {
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxEpayResponse+1))
	if err != nil {
		return nil, resp.StatusCode, &ProviderError{Code: "epay_response_read_error", Message: "读取易支付响应失败", Temporary: true, Cause: err}
	}
	if len(body) > maxEpayResponse {
		return nil, resp.StatusCode, &ProviderError{Code: "epay_response_too_large", Message: "易支付响应过大"}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, resp.StatusCode, &ProviderError{Code: "epay_http_error", Message: fmt.Sprintf("易支付 HTTP 状态异常: %d", resp.StatusCode), Temporary: resp.StatusCode >= 500}
	}
	var raw map[string]any
	// 有的网关输出带 BOM
	decoder := json.NewDecoder(bytes.NewReader(bytes.TrimPrefix(body, []byte("\xEF\xBB\xBF"))))
	decoder.UseNumber()
	if err := decoder.Decode(&raw); err != nil {
		return nil, resp.StatusCode, &ProviderError{Code: "epay_response_parse_error", Message: "易支付响应不是有效 JSON", Temporary: true, Cause: err}
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, resp.StatusCode, &ProviderError{Code: "epay_response_parse_error", Message: "易支付响应包含多余内容"}
	}
	result := make(epayResponse, len(raw))
	for key, value := range raw {
		result[key] = epayString(value)
	}
	return result, resp.StatusCode, nil
}

func epayGateway(config Config) (string, error) {
	gateway := strings.TrimSpace(config["gateway"])
	if gateway == "" {
		return "", errors.New("易支付配置缺少支付网关 gateway")
	}
	parsed, err := url.Parse(gateway)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("易支付网关必须是有效的 HTTP(S) 根地址")
	}
	return strings.TrimRight(gateway, "/"), nil
}

func epayVersion(config Config) string {
	version := strings.TrimSpace(config["version"])
	if version == "" {
		return "0"
	}
	return version
}

func epayCheckoutMode(config Config) string {
	if strings.TrimSpace(config["checkoutMode"]) == "qr_code" {
		return "qr_code"
	}
	return "redirect"
}

func epayPayType(config Config) string {
	payType := strings.TrimSpace(config["payType"])
	if payType == "" {
		return "alipay"
	}
	return payType
}

// mapi 是服务端下单，网关看不到买家的浏览器，只能靠 device 决定给什么支付页。
// 微信/QQ/支付宝里打开的要报对，不然拿到的是 App 内打不开的 H5 或二维码。
// 宿主 CreateRequest 不带 UA，可用配置 device 覆盖；留空默认 pc。
func epayDevice(config Config) string {
	if device := strings.TrimSpace(config["device"]); device != "" {
		return device
	}
	return "pc"
}

func epayTitle(description, orderNo string) string {
	title := strings.TrimSpace(description)
	if title == "" {
		title = "商品订单号:" + orderNo
	}
	return strings.ReplaceAll(title, "%", "")
}

func formatEpayAmount(amountFen int64) string {
	return strconv.FormatInt(amountFen/100, 10) + "." + fmt.Sprintf("%02d", amountFen%100)
}

func epayMD5Sign(values map[string]string, key string) string {
	return epayMD5Hex(epayCanonical(values) + key)
}

func epayCanonical(values map[string]string) string {
	keys := make([]string, 0, len(values))
	for key, value := range values {
		if key == "sign" || key == "sign_type" || value == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+values[key])
	}
	return strings.Join(parts, "&")
}

func epayMD5Hex(value string) string {
	hash := md5.Sum([]byte(value))
	return hex.EncodeToString(hash[:])
}

func epayRSASign(values map[string]string, privateKey string) (string, error) {
	key, err := parseRSAPrivateKey(privateKey)
	if err != nil {
		return "", err
	}
	return rsaSHA256Sign(key, []byte(epayCanonical(values)))
}

func epaySafetyEquals(actual, expected string) bool {
	return actual != "" && len(actual) == len(expected) && subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) == 1
}

func epayResult(response epayResponse, expectedOrderNo string) (Result, error) {
	status := epayString(response["status"])
	if status == "" && response["trade_status"] != "" {
		status = response["trade_status"]
	}
	switch status {
	case "0", "1", "WAIT_BUYER_PAY", "TRADE_SUCCESS", "TRADE_CLOSED":
	default:
		return Result{}, errors.New("易支付查单支付状态缺失或无效")
	}
	if response["out_trade_no"] != expectedOrderNo {
		return Result{}, errors.New("易支付查单订单号缺失或不匹配")
	}
	amount, err := parseYuanToFen(firstNonEmpty(response["money"], response["total_amount"]))
	if err != nil || amount <= 0 {
		return Result{}, errors.New("易支付查单金额无效")
	}
	providerTradeNo := firstNonEmpty(response["trade_no"], response["api_trade_no"])
	if (status == "1" || status == "TRADE_SUCCESS") && providerTradeNo == "" {
		return Result{}, errors.New("易支付成功订单缺少支付流水号")
	}
	return Result{
		MerchantOrderNo: response["out_trade_no"],
		ProviderTradeNo: providerTradeNo,
		ProviderStatus:  status, AmountFen: amount, Currency: "CNY",
		Paid: status == "1" || status == "TRADE_SUCCESS", Closed: status == "TRADE_CLOSED",
		PaidAt: parseEpayTime(firstNonEmpty(epayString(response["endtime"]), epayString(response["gmt_payment"]))),
	}, nil
}

func epayString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	default:
		return ""
	}
}

// 只允许浏览器支付页和已知支付 App 协议，不接受任意本机协议。
func isEpayURL(value string) bool {
	value = strings.TrimSpace(value)
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return false
	}
	scheme := strings.ToLower(parsed.Scheme)
	switch scheme {
	case "http", "https", "weixin", "alipay", "alipays", "mqqapi":
		return true
	default:
		return false
	}
}

func parseEpayTime(value string) time.Time {
	value = strings.TrimSpace(value)
	for _, layout := range []string{"2006-01-02 15:04:05", time.RFC3339} {
		if parsed, err := time.ParseInLocation(layout, value, time.Local); err == nil {
			return parsed
		}
	}
	return time.Time{}
}
