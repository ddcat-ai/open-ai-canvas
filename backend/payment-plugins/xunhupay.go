package paymentplugins

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/rand"
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
	defaultXunHuPayGateway = "https://api.xunhupay.com"
	xunhupayAPIVersion     = "1.1"
	xunhupayPluginName     = "yingce-xunhupay"
	xunhupayPayPath        = "/payment/do.html"
	xunhupayQueryPath      = "/payment/query.html"
	xunhupayQRLifetime     = 5 * time.Minute
)

var xunhupayGatewayHosts = map[string]struct{}{
	"api.xunhupay.com": {},
	"api.dpweixin.com": {},
	"api.diypc.com.cn": {},
}

type XunHuPayProvider struct {
	client  *http.Client
	now     func() time.Time
	baseURL string
	nonce   func() string
}

func NewXunHuPayProvider(client *http.Client) *XunHuPayProvider {
	if client == nil {
		client = http.DefaultClient
	}
	return &XunHuPayProvider{client: client, now: time.Now, nonce: randomNonce}
}

func (p *XunHuPayProvider) Descriptor() Descriptor {
	return Descriptor{
		ID: ProviderXunHuPay, PluginID: PluginXunHuPay, PluginVersion: "1.0.0",
		Name: "虎皮椒聚合支付", Icon: "assets/icon.svg", CheckoutMode: "qr_code",
		IdentityFields:      []string{"appId"},
		NotificationSuccess: NotificationResponse{Status: 200, ContentType: "text/plain; charset=utf-8", Body: "success"},
		NotificationFailure: NotificationResponse{Status: 400, ContentType: "text/plain; charset=utf-8", Body: "failure"},
	}
}

func (p *XunHuPayProvider) ValidateConfig(config Config) error {
	if strings.TrimSpace(config["appId"]) == "" {
		return errors.New("虎皮椒配置缺少 appId")
	}
	if strings.TrimSpace(config["appSecret"]) == "" {
		return errors.New("虎皮椒配置缺少 appSecret")
	}
	mode := xunhupayCheckoutMode(config)
	if mode != "qr_code" && mode != "redirect" {
		return errors.New("虎皮椒 checkoutMode 必须是 qr_code 或 redirect")
	}
	if _, err := xunhupayGatewayOrigin(config); err != nil {
		return err
	}
	return nil
}

func (p *XunHuPayProvider) CreateOrder(ctx context.Context, config Config, request CreateRequest) (Checkout, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Checkout{}, err
	}
	if request.AmountFen <= 0 || request.Currency != "CNY" || request.MerchantOrderNo == "" || request.NotifyURL == "" {
		return Checkout{}, errors.New("虎皮椒下单参数无效")
	}
	params := map[string]string{
		"version":        xunhupayAPIVersion,
		"appid":          strings.TrimSpace(config["appId"]),
		"trade_order_id": request.MerchantOrderNo,
		"total_fee":      formatFen(request.AmountFen),
		"title":          xunhupayTitle(request.Description),
		"time":           strconv.FormatInt(p.now().Unix(), 10),
		"notify_url":     request.NotifyURL,
		"plugins":        xunhupayPluginName,
		"nonce_str":      p.nonce(),
	}
	if request.ReturnURL != "" {
		params["return_url"] = request.ReturnURL
		params["callback_url"] = request.ReturnURL
	}
	var response xunhupayPayResponse
	if err := p.call(ctx, config, xunhupayPayPath, params, &response); err != nil {
		return Checkout{}, err
	}
	mode := xunhupayCheckoutMode(config)
	// url_qrcode 是网关已经画好的二维码图片地址，钱包按图片展示，不能再编码成新二维码。
	value := strings.TrimSpace(response.URLQrcode)
	if mode == "redirect" {
		value = strings.TrimSpace(response.URL)
	}
	if value == "" {
		if mode == "redirect" {
			return Checkout{}, errors.New("虎皮椒下单未返回支付跳转地址")
		}
		return Checkout{}, errors.New("虎皮椒下单未返回支付二维码")
	}
	expiresAt := request.ExpiresAt
	if mode == "qr_code" {
		qrExpires := p.now().Add(xunhupayQRLifetime)
		if expiresAt.IsZero() || qrExpires.Before(expiresAt) {
			expiresAt = qrExpires
		}
	}
	return Checkout{Mode: mode, Value: value, ExpiresAt: expiresAt}, nil
}

func (p *XunHuPayProvider) QueryOrder(ctx context.Context, config Config, request QueryRequest) (Result, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Result{}, err
	}
	if strings.TrimSpace(request.MerchantOrderNo) == "" {
		return Result{}, errors.New("虎皮椒查单缺少商户订单号")
	}
	order, err := p.query(ctx, config, request.MerchantOrderNo)
	if err != nil {
		return Result{}, err
	}
	return xunhupayResult(request.MerchantOrderNo, order), nil
}

func (p *XunHuPayProvider) CloseOrder(ctx context.Context, config Config, request CloseRequest) (Result, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Result{}, err
	}
	order, err := p.query(ctx, config, request.MerchantOrderNo)
	if err != nil {
		return Result{}, err
	}
	result := xunhupayResult(request.MerchantOrderNo, order)
	if result.Paid {
		return result, nil
	}
	result.Closed = true
	if result.ProviderStatus == "" || result.ProviderStatus == "WP" {
		result.ProviderStatus = "CD"
	}
	return result, nil
}

func (p *XunHuPayProvider) VerifyNotification(_ context.Context, config Config, _ http.Header, rawBody []byte) (Notification, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Notification{}, err
	}
	values, err := parseXunHuPayNotification(rawBody)
	if err != nil {
		return Notification{}, err
	}
	if !xunhupayHashEqual(values, config["appSecret"], values["hash"]) {
		return Notification{}, errors.New("虎皮椒异步通知签名无效")
	}
	if strings.TrimSpace(values["appid"]) != strings.TrimSpace(config["appId"]) {
		return Notification{}, errors.New("虎皮椒异步通知商户身份不匹配")
	}
	status := strings.TrimSpace(values["status"])
	merchantOrderNo := firstNonEmpty(values["trade_order_id"], values["out_trade_order"])
	if merchantOrderNo == "" {
		return Notification{}, errors.New("虎皮椒异步通知缺少商户订单号")
	}
	amount, err := parseYuanToFen(firstNonEmpty(values["total_fee"], values["total_amount"]))
	if err != nil {
		return Notification{}, errors.New("虎皮椒异步通知金额无效")
	}
	paidAt := parseXunHuPayTime(values["time"])
	eventID := firstNonEmpty(values["transaction_id"], values["open_order_id"], merchantOrderNo) + ":" + status + ":" + values["time"]
	return Notification{
		EventID: eventID,
		Result: Result{
			MerchantOrderNo: merchantOrderNo,
			ProviderTradeNo: firstNonEmpty(values["transaction_id"], values["open_order_id"]),
			ProviderStatus:  status,
			AmountFen:       amount,
			Currency:        "CNY",
			Paid:            status == "OD",
			Closed:          status == "CD",
			PaidAt:          paidAt,
		},
	}, nil
}

func (p *XunHuPayProvider) DownloadTradeBill(context.Context, Config, time.Time) ([]BillRecord, error) {
	return nil, fmt.Errorf("%w: 虎皮椒未提供交易账单下载接口", ErrTradeBillNotFound)
}

func (p *XunHuPayProvider) query(ctx context.Context, config Config, merchantOrderNo string) (xunhupayOrderData, error) {
	params := map[string]string{
		"appid":           strings.TrimSpace(config["appId"]),
		"out_trade_order": merchantOrderNo,
		"time":            strconv.FormatInt(p.now().Unix(), 10),
		"nonce_str":       p.nonce(),
	}
	var envelope xunhupayQueryResponse
	if err := p.call(ctx, config, xunhupayQueryPath, params, &envelope); err != nil {
		return xunhupayOrderData{}, err
	}
	if strings.TrimSpace(envelope.Data.Status) == "" {
		return xunhupayOrderData{}, errors.New("虎皮椒查单未返回订单状态")
	}
	return envelope.Data, nil
}

func (p *XunHuPayProvider) call(ctx context.Context, config Config, path string, params map[string]string, output any) error {
	params["hash"] = xunhupayHash(params, config["appSecret"])
	payload, err := json.Marshal(params)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint(config, path), bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")
	response, err := p.client.Do(request)
	if err != nil {
		return &ProviderError{Code: "xunhupay_transport_error", Message: "虎皮椒网络请求失败", Temporary: true, Cause: err}
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return &ProviderError{Code: "xunhupay_response_read_error", Message: "读取虎皮椒响应失败", Temporary: true, Cause: err}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &ProviderError{Code: "xunhupay_http_error", Message: "虎皮椒接口返回失败", Temporary: response.StatusCode >= 500}
	}
	var envelope xunhupayEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("解析虎皮椒响应：%w", err)
	}
	if envelope.Hash != "" {
		values, err := jsonObjectStrings(body)
		if err != nil {
			return fmt.Errorf("解析虎皮椒响应签名字段：%w", err)
		}
		if !xunhupayHashEqual(values, config["appSecret"], envelope.Hash) {
			return errors.New("虎皮椒响应签名无效")
		}
	}
	if envelope.ErrCode != 0 {
		message := strings.TrimSpace(envelope.ErrMsg)
		if message == "" {
			message = "虎皮椒业务请求失败"
		}
		if isXunHuPayOrderMissing(message) {
			return fmt.Errorf("%w: %s", ErrOrderNotFound, message)
		}
		return &ProviderError{Code: strconv.Itoa(int(envelope.ErrCode)), Message: message}
	}
	if output == nil {
		return nil
	}
	return json.Unmarshal(body, output)
}

func (p *XunHuPayProvider) endpoint(config Config, path string) string {
	if strings.TrimSpace(p.baseURL) != "" {
		return strings.TrimRight(p.baseURL, "/") + path
	}
	origin, err := xunhupayGatewayOrigin(config)
	if err != nil {
		return defaultXunHuPayGateway + path
	}
	return origin + path
}

type xunhupayEnvelope struct {
	ErrCode xunhupayCode `json:"errcode"`
	ErrMsg  string       `json:"errmsg"`
	Hash    string       `json:"hash"`
}

type xunhupayCode int

func (code *xunhupayCode) UnmarshalJSON(raw []byte) error {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || string(raw) == "null" {
		*code = 0
		return nil
	}
	if raw[0] == '"' {
		var text string
		if err := json.Unmarshal(raw, &text); err != nil {
			return err
		}
		if strings.TrimSpace(text) == "" {
			*code = 0
			return nil
		}
		parsed, err := strconv.Atoi(strings.TrimSpace(text))
		if err != nil {
			return err
		}
		*code = xunhupayCode(parsed)
		return nil
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	*code = xunhupayCode(value)
	return nil
}

type xunhupayPayResponse struct {
	xunhupayEnvelope
	URLQrcode string `json:"url_qrcode"`
	URL       string `json:"url"`
}

type xunhupayQueryResponse struct {
	xunhupayEnvelope
	Data xunhupayOrderData `json:"data"`
}

type xunhupayOrderData struct {
	Status        string `json:"status"`
	OpenOrderID   string `json:"open_order_id"`
	TransactionID string `json:"transaction_id"`
	TotalAmount   string `json:"total_amount"`
	TotalFee      string `json:"total_fee"`
	OutTradeOrder string `json:"out_trade_order"`
	PaidDate      string `json:"paid_date"`
}

func xunhupayResult(merchantOrderNo string, order xunhupayOrderData) Result {
	amount, _ := parseYuanToFen(firstNonEmpty(order.TotalFee, order.TotalAmount))
	status := strings.TrimSpace(order.Status)
	return Result{
		MerchantOrderNo: firstNonEmpty(order.OutTradeOrder, merchantOrderNo),
		ProviderTradeNo: firstNonEmpty(order.TransactionID, order.OpenOrderID),
		ProviderStatus:  status,
		AmountFen:       amount,
		Currency:        "CNY",
		Paid:            status == "OD",
		Closed:          status == "CD",
		PaidAt:          parseXunHuPayTime(order.PaidDate),
	}
}

func xunhupayGatewayOrigin(config Config) (string, error) {
	raw := strings.TrimSpace(config["gateway"])
	if raw == "" {
		raw = defaultXunHuPayGateway
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" || (parsed.Port() != "" && parsed.Port() != "443") {
		return "", errors.New("虎皮椒网关必须是官方 HTTPS 地址")
	}
	host := strings.ToLower(parsed.Hostname())
	if _, ok := xunhupayGatewayHosts[host]; !ok {
		return "", errors.New("虎皮椒网关仅支持官方生产或备用域名")
	}
	if parsed.Path != "" && parsed.Path != "/" && !strings.HasPrefix(parsed.Path, "/payment/") {
		return "", errors.New("虎皮椒网关路径无效")
	}
	return "https://" + parsed.Hostname(), nil
}

func xunhupayCheckoutMode(config Config) string {
	mode := strings.TrimSpace(config["checkoutMode"])
	if mode == "" {
		return "qr_code"
	}
	return mode
}

func xunhupayTitle(value string) string {
	title := strings.ReplaceAll(truncateUTF8(value, 120), "%", "")
	if title == "" {
		return "积分充值"
	}
	return title
}

func xunhupayHash(params map[string]string, secret string) string {
	keys := make([]string, 0, len(params))
	for key, value := range params {
		if key == "hash" || value == "" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+params[key])
	}
	sum := md5.Sum([]byte(strings.Join(parts, "&") + secret))
	return hex.EncodeToString(sum[:])
}

func xunhupayHashEqual(params map[string]string, secret, actual string) bool {
	expected := xunhupayHash(params, secret)
	return actual != "" && strings.EqualFold(expected, strings.TrimSpace(actual))
}

func parseXunHuPayNotification(rawBody []byte) (map[string]string, error) {
	trimmed := bytes.TrimSpace(rawBody)
	if len(trimmed) == 0 {
		return nil, errors.New("虎皮椒异步通知为空")
	}
	if trimmed[0] == '{' {
		values, err := jsonObjectStrings(trimmed)
		if err != nil {
			return nil, fmt.Errorf("解析虎皮椒异步通知：%w", err)
		}
		return values, nil
	}
	form, err := url.ParseQuery(string(trimmed))
	if err != nil {
		return nil, fmt.Errorf("解析虎皮椒异步通知：%w", err)
	}
	values := make(map[string]string, len(form))
	for key, items := range form {
		if len(items) > 0 {
			values[key] = items[0]
		}
	}
	return values, nil
}

func jsonObjectStrings(raw []byte) (map[string]string, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var object map[string]any
	if err := decoder.Decode(&object); err != nil {
		return nil, err
	}
	values := make(map[string]string, len(object))
	for key, value := range object {
		if key == "" || value == nil {
			continue
		}
		switch typed := value.(type) {
		case string:
			values[key] = typed
		case json.Number:
			values[key] = typed.String()
		case bool:
			values[key] = strconv.FormatBool(typed)
		}
	}
	return values, nil
}

func parseXunHuPayTime(value string) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	if unix, err := strconv.ParseInt(value, 10, 64); err == nil && unix > 0 {
		return time.Unix(unix, 0)
	}
	if parsed, err := time.ParseInLocation("2006-01-02 15:04:05", value, time.FixedZone("CST", 8*60*60)); err == nil {
		return parsed
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed
	}
	return time.Time{}
}

func isXunHuPayOrderMissing(message string) bool {
	lower := strings.ToLower(message)
	return strings.Contains(lower, "not exist") || strings.Contains(lower, "not found") || strings.Contains(message, "不存在")
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func randomNonce() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(raw[:])
}
