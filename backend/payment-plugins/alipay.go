package paymentplugins

import (
	"context"
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

const defaultAlipayGateway = "https://openapi.alipay.com/gateway.do"

type AlipayProvider struct {
	client *http.Client
	now    func() time.Time
}

func NewAlipayProvider(client *http.Client) *AlipayProvider {
	if client == nil {
		client = http.DefaultClient
	}
	return &AlipayProvider{client: client, now: time.Now}
}

func (p *AlipayProvider) Descriptor() Descriptor {
	return Descriptor{ID: ProviderAlipayPage, PluginID: PluginAlipayPage, PluginVersion: "1.0.0", Name: "支付宝电脑网站支付", Icon: "brand:alipay", CheckoutMode: "redirect", IdentityFields: []string{"appId", "sellerId"}, NotificationSuccess: NotificationResponse{Status: 200, ContentType: "text/plain; charset=utf-8", Body: "success"}, NotificationFailure: NotificationResponse{Status: 400, ContentType: "text/plain; charset=utf-8", Body: "failure"}}
}

func (p *AlipayProvider) ValidateConfig(config Config) error {
	for _, key := range []string{"appId", "sellerId", "merchantPrivateKey", "alipayPublicKey"} {
		if strings.TrimSpace(config[key]) == "" {
			return fmt.Errorf("支付宝配置缺少 %s", key)
		}
	}
	if _, err := parseRSAPrivateKey(config["merchantPrivateKey"]); err != nil {
		return fmt.Errorf("支付宝应用私钥无效：%w", err)
	}
	if _, err := parseRSAPublicKey(config["alipayPublicKey"]); err != nil {
		return fmt.Errorf("支付宝公钥无效：%w", err)
	}
	gateway := strings.TrimSpace(config["gateway"])
	if gateway == "" {
		gateway = defaultAlipayGateway
	}
	parsed, err := url.Parse(gateway)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" || parsed.Path != "/gateway.do" || (parsed.Port() != "" && parsed.Port() != "443") {
		return errors.New("支付宝网关必须是官方 HTTPS gateway.do 地址")
	}
	host := strings.ToLower(parsed.Hostname())
	if host != "openapi.alipay.com" && host != "openapi-sandbox.dl.alipaydev.com" {
		return errors.New("支付宝网关仅支持官方生产或沙箱域名")
	}
	return nil
}

func (p *AlipayProvider) CreateOrder(_ context.Context, config Config, request CreateRequest) (Checkout, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Checkout{}, err
	}
	if request.AmountFen <= 0 || request.Currency != "CNY" || request.MerchantOrderNo == "" || request.NotifyURL == "" {
		return Checkout{}, errors.New("支付宝电脑网站支付下单参数无效")
	}
	remaining := request.ExpiresAt.Sub(p.now())
	timeoutMinutes := int((remaining + time.Minute - 1) / time.Minute)
	if remaining <= 0 || timeoutMinutes < 1 {
		timeoutMinutes = 1
	}
	bizContent, err := json.Marshal(map[string]any{
		"out_trade_no":    request.MerchantOrderNo,
		"total_amount":    formatFen(request.AmountFen),
		"subject":         truncateUTF8(request.Description, 256),
		"product_code":    "FAST_INSTANT_TRADE_PAY",
		"timeout_express": fmt.Sprintf("%dm", timeoutMinutes),
	})
	if err != nil {
		return Checkout{}, err
	}
	params := p.commonParams(config, "alipay.trade.page.pay")
	params.Set("notify_url", request.NotifyURL)
	if request.ReturnURL != "" {
		params.Set("return_url", request.ReturnURL)
	}
	params.Set("biz_content", string(bizContent))
	if err := signAlipayParams(config, params); err != nil {
		return Checkout{}, err
	}
	gateway := alipayGateway(config)
	separator := "?"
	if strings.Contains(gateway, "?") {
		separator = "&"
	}
	return Checkout{Mode: "redirect", Value: gateway + separator + params.Encode(), ExpiresAt: request.ExpiresAt}, nil
}

func (p *AlipayProvider) QueryOrder(ctx context.Context, config Config, request QueryRequest) (Result, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Result{}, err
	}
	response, err := p.call(ctx, config, "alipay.trade.query", map[string]any{"out_trade_no": request.MerchantOrderNo})
	if err != nil {
		return Result{}, err
	}
	return alipayResult(response), nil
}

func (p *AlipayProvider) CloseOrder(ctx context.Context, config Config, request CloseRequest) (Result, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Result{}, err
	}
	response, err := p.call(ctx, config, "alipay.trade.close", map[string]any{"out_trade_no": request.MerchantOrderNo})
	if err != nil {
		return Result{}, err
	}
	result := alipayResult(response)
	result.MerchantOrderNo = request.MerchantOrderNo
	result.ProviderStatus = "CLOSED"
	result.Closed = true
	result.Currency = "CNY"
	return result, nil
}

func (p *AlipayProvider) VerifyNotification(_ context.Context, config Config, _ http.Header, rawBody []byte) (Notification, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Notification{}, err
	}
	values, err := url.ParseQuery(string(rawBody))
	if err != nil {
		return Notification{}, fmt.Errorf("解析支付宝异步通知：%w", err)
	}
	signature := values.Get("sign")
	if signature == "" || values.Get("sign_type") != "RSA2" {
		return Notification{}, errors.New("支付宝异步通知签名参数缺失")
	}
	verifyValues := cloneURLValues(values)
	verifyValues.Del("sign")
	verifyValues.Del("sign_type")
	publicKey, err := parseRSAPublicKey(config["alipayPublicKey"])
	if err != nil {
		return Notification{}, err
	}
	if err := rsaSHA256Verify(publicKey, []byte(canonicalAlipayParams(verifyValues)), signature); err != nil {
		return Notification{}, err
	}
	status := values.Get("trade_status")
	if values.Get("app_id") != config["appId"] || values.Get("seller_id") != config["sellerId"] || (status != "TRADE_SUCCESS" && status != "TRADE_FINISHED") {
		return Notification{}, errors.New("支付宝异步通知商户身份或交易状态不匹配")
	}
	amount, err := parseYuanToFen(values.Get("total_amount"))
	if err != nil {
		return Notification{}, errors.New("支付宝异步通知金额无效")
	}
	paidAt, _ := time.ParseInLocation("2006-01-02 15:04:05", values.Get("gmt_payment"), time.FixedZone("CST", 8*60*60))
	eventID := strings.TrimSpace(values.Get("notify_id"))
	if eventID == "" {
		eventID = values.Get("trade_no") + ":" + status + ":" + values.Get("gmt_payment")
	}
	return Notification{EventID: eventID, Result: Result{
		MerchantOrderNo: values.Get("out_trade_no"), ProviderTradeNo: values.Get("trade_no"), ProviderStatus: status,
		AmountFen: amount, Currency: "CNY", Paid: true, PaidAt: paidAt,
	}}, nil
}

func (p *AlipayProvider) DownloadTradeBill(ctx context.Context, config Config, billDate time.Time) ([]BillRecord, error) {
	if err := p.ValidateConfig(config); err != nil {
		return nil, err
	}
	var bill struct {
		BillDownloadURL string `json:"bill_download_url"`
	}
	if err := p.callJSON(ctx, config, "alipay.data.dataservice.bill.downloadurl.query", map[string]any{
		"bill_type": "trade", "bill_date": billDate.Format("2006-01-02"),
	}, &bill); err != nil {
		return nil, err
	}
	alipayHTTPBillHosts := []string{"dwbillcenter.alipay.com", "dwbillcenter.alipaydev.com"}
	target, err := trustedDownloadURLWithPolicy(bill.BillDownloadURL, alipayGateway(config), alipayHTTPBillHosts, "alipay.com", "alipayobjects.com", "alipaydev.com")
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	response, err := clientWithTrustedRedirectPolicy(p.client, alipayGateway(config), alipayHTTPBillHosts, "alipay.com", "alipayobjects.com", "alipaydev.com").Do(request)
	if err != nil {
		return nil, &ProviderError{Code: "alipay_bill_download_error", Message: "下载支付宝交易账单失败", Temporary: true, Cause: err}
	}
	defer response.Body.Close()
	if response.Request == nil {
		return nil, errors.New("支付宝交易账单下载响应无效")
	}
	if _, err := trustedDownloadURLWithPolicy(response.Request.URL.String(), alipayGateway(config), alipayHTTPBillHosts, "alipay.com", "alipayobjects.com", "alipaydev.com"); err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &ProviderError{Code: "alipay_bill_http_error", Message: "支付宝交易账单下载失败", Temporary: response.StatusCode >= 500}
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxTradeBillBytes+1))
	if err != nil {
		return nil, &ProviderError{Code: "alipay_bill_read_error", Message: "读取支付宝交易账单失败", Temporary: true, Cause: err}
	}
	if len(raw) > maxTradeBillBytes {
		return nil, errors.New("支付宝交易账单超过安全限制")
	}
	return parseAlipayTradeBill(raw)
}

type alipayTradeResponse struct {
	Code          string `json:"code"`
	Msg           string `json:"msg"`
	SubCode       string `json:"sub_code"`
	SubMsg        string `json:"sub_msg"`
	OutTradeNo    string `json:"out_trade_no"`
	TradeNo       string `json:"trade_no"`
	TradeStatus   string `json:"trade_status"`
	TotalAmount   string `json:"total_amount"`
	SendPayDate   string `json:"send_pay_date"`
	ReceiptAmount string `json:"receipt_amount"`
}

func alipayResult(response alipayTradeResponse) Result {
	amount, _ := parseYuanToFen(response.TotalAmount)
	paidAt, _ := time.ParseInLocation("2006-01-02 15:04:05", response.SendPayDate, time.FixedZone("CST", 8*60*60))
	paid := response.TradeStatus == "TRADE_SUCCESS" || response.TradeStatus == "TRADE_FINISHED"
	return Result{
		MerchantOrderNo: response.OutTradeNo, ProviderTradeNo: response.TradeNo, ProviderStatus: response.TradeStatus,
		AmountFen: amount, Currency: "CNY", Paid: paid, Closed: response.TradeStatus == "TRADE_CLOSED", PaidAt: paidAt,
	}
}

func (p *AlipayProvider) call(ctx context.Context, config Config, method string, biz any) (alipayTradeResponse, error) {
	var tradeResponse alipayTradeResponse
	if err := p.callJSON(ctx, config, method, biz, &tradeResponse); err != nil {
		return alipayTradeResponse{}, err
	}
	return tradeResponse, nil
}

func (p *AlipayProvider) callJSON(ctx context.Context, config Config, method string, biz any, output any) error {
	bizContent, err := json.Marshal(biz)
	if err != nil {
		return err
	}
	params := p.commonParams(config, method)
	params.Set("biz_content", string(bizContent))
	if err := signAlipayParams(config, params); err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, alipayGateway(config), strings.NewReader(params.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
	response, err := p.client.Do(request)
	if err != nil {
		return &ProviderError{Code: "alipay_transport_error", Message: "支付宝网络请求失败", Temporary: true, Cause: err}
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return &ProviderError{Code: "alipay_response_read_error", Message: "读取支付宝响应失败", Temporary: true, Cause: err}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &ProviderError{Code: "alipay_http_error", Message: "支付宝接口返回失败", Temporary: response.StatusCode >= 500}
	}
	responseKey := strings.ReplaceAll(method, ".", "_") + "_response"
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(body, &envelope); err != nil {
		return fmt.Errorf("解析支付宝响应：%w", err)
	}
	responseRaw := envelope[responseKey]
	if len(responseRaw) == 0 {
		return errors.New("支付宝响应缺少业务节点")
	}
	var signature string
	if err := json.Unmarshal(envelope["sign"], &signature); err != nil || signature == "" {
		return errors.New("支付宝响应缺少签名")
	}
	publicKey, err := parseRSAPublicKey(config["alipayPublicKey"])
	if err != nil {
		return err
	}
	if err := rsaSHA256Verify(publicKey, responseRaw, signature); err != nil {
		return fmt.Errorf("支付宝响应验签失败：%w", err)
	}
	var status struct {
		Code    string `json:"code"`
		SubCode string `json:"sub_code"`
	}
	if err := json.Unmarshal(responseRaw, &status); err != nil {
		return err
	}
	if status.Code != "10000" {
		if status.SubCode == "ACQ.TRADE_NOT_EXIST" {
			return fmt.Errorf("%w: %s", ErrOrderNotFound, status.SubCode)
		}
		if status.SubCode == "BILL_NOT_EXIST" {
			return fmt.Errorf("%w: %s", ErrTradeBillNotFound, status.SubCode)
		}
		return &ProviderError{Code: status.SubCode, Message: "支付宝业务请求失败", Temporary: false}
	}
	if output == nil {
		return nil
	}
	return json.Unmarshal(responseRaw, output)
}

func (p *AlipayProvider) commonParams(config Config, method string) url.Values {
	return url.Values{
		"app_id":    {config["appId"]},
		"method":    {method},
		"format":    {"JSON"},
		"charset":   {"utf-8"},
		"sign_type": {"RSA2"},
		"timestamp": {p.now().In(time.FixedZone("CST", 8*60*60)).Format("2006-01-02 15:04:05")},
		"version":   {"1.0"},
	}
}

func signAlipayParams(config Config, params url.Values) error {
	privateKey, err := parseRSAPrivateKey(config["merchantPrivateKey"])
	if err != nil {
		return err
	}
	signature, err := rsaSHA256Sign(privateKey, []byte(canonicalAlipayParams(params)))
	if err != nil {
		return err
	}
	params.Set("sign", signature)
	return nil
}

func canonicalAlipayParams(params url.Values) string {
	keys := make([]string, 0, len(params))
	for key, values := range params {
		if key != "sign" && len(values) > 0 && values[0] != "" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+params.Get(key))
	}
	return strings.Join(parts, "&")
}

func cloneURLValues(input url.Values) url.Values {
	result := make(url.Values, len(input))
	for key, values := range input {
		result[key] = append([]string(nil), values...)
	}
	return result
}

func alipayGateway(config Config) string {
	if value := strings.TrimSpace(config["gateway"]); value != "" {
		return value
	}
	return defaultAlipayGateway
}

func formatFen(value int64) string {
	return fmt.Sprintf("%d.%02d", value/100, value%100)
}

func parseYuanToFen(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "-") {
		return 0, errors.New("invalid amount")
	}
	parts := strings.Split(value, ".")
	if len(parts) > 2 {
		return 0, errors.New("invalid amount")
	}
	yuan, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || yuan > (1<<63-1)/100 {
		return 0, errors.New("invalid amount")
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	if len(fraction) > 2 {
		return 0, errors.New("invalid amount precision")
	}
	fraction += strings.Repeat("0", 2-len(fraction))
	fen := int64(0)
	if fraction != "" {
		fen, err = strconv.ParseInt(fraction, 10, 64)
		if err != nil {
			return 0, errors.New("invalid amount")
		}
	}
	const maxInt64 = int64(1<<63 - 1)
	if yuan > (maxInt64-fen)/100 {
		return 0, errors.New("invalid amount")
	}
	return yuan*100 + fen, nil
}
