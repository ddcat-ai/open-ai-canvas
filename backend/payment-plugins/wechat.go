package paymentplugins

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
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

const wechatCheckoutLifetime = 2 * time.Hour

type WeChatProvider struct {
	client  *http.Client
	baseURL string
	now     func() time.Time
}

func NewWeChatProvider(client *http.Client, baseURL string) *WeChatProvider {
	if client == nil {
		client = http.DefaultClient
	}
	return &WeChatProvider{client: client, baseURL: strings.TrimRight(baseURL, "/"), now: time.Now}
}

func (p *WeChatProvider) Descriptor() Descriptor {
	return Descriptor{ID: ProviderWeChatNative, PluginID: PluginWeChatNative, PluginVersion: "1.0.0", Name: "微信支付 Native", Icon: "brand:wechat-pay", CheckoutMode: "qr_code", IdentityFields: []string{"appId", "mchId"}, NotificationSuccess: NotificationResponse{Status: 204}, NotificationFailure: NotificationResponse{Status: 400}}
}

func (p *WeChatProvider) ValidateConfig(config Config) error {
	for _, key := range []string{"appId", "mchId", "merchantSerialNo", "merchantPrivateKey", "apiV3Key", "wechatPayPublicKeyId", "wechatPayPublicKey"} {
		if strings.TrimSpace(config[key]) == "" {
			return fmt.Errorf("微信支付配置缺少 %s", key)
		}
	}
	if len([]byte(config["apiV3Key"])) != 32 {
		return errors.New("微信支付 APIv3 密钥必须为 32 字节")
	}
	if _, err := parseRSAPrivateKey(config["merchantPrivateKey"]); err != nil {
		return fmt.Errorf("微信支付商户私钥无效：%w", err)
	}
	if _, err := parseRSAPublicKey(config["wechatPayPublicKey"]); err != nil {
		return fmt.Errorf("微信支付公钥无效：%w", err)
	}
	return nil
}

func (p *WeChatProvider) CreateOrder(ctx context.Context, config Config, request CreateRequest) (Checkout, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Checkout{}, err
	}
	if request.AmountFen <= 0 || request.Currency != "CNY" || request.MerchantOrderNo == "" || request.NotifyURL == "" {
		return Checkout{}, errors.New("微信 Native 下单参数无效")
	}
	payload := map[string]any{
		"appid":        config["appId"],
		"mchid":        config["mchId"],
		"description":  truncateUTF8(request.Description, 127),
		"out_trade_no": request.MerchantOrderNo,
		"time_expire":  request.ExpiresAt.Format(time.RFC3339),
		"notify_url":   request.NotifyURL,
		"amount":       map[string]any{"total": request.AmountFen, "currency": request.Currency},
	}
	var response struct {
		CodeURL string `json:"code_url"`
	}
	if err := p.do(ctx, config, http.MethodPost, "/v3/pay/transactions/native", payload, &response); err != nil {
		return Checkout{}, err
	}
	if strings.TrimSpace(response.CodeURL) == "" {
		return Checkout{}, errors.New("微信 Native 下单未返回 code_url")
	}
	expiresAt := p.now().Add(wechatCheckoutLifetime)
	if request.ExpiresAt.Before(expiresAt) {
		expiresAt = request.ExpiresAt
	}
	return Checkout{Mode: "qr_code", Value: response.CodeURL, ExpiresAt: expiresAt}, nil
}

func (p *WeChatProvider) QueryOrder(ctx context.Context, config Config, request QueryRequest) (Result, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Result{}, err
	}
	path := "/v3/pay/transactions/out-trade-no/" + url.PathEscape(request.MerchantOrderNo) + "?mchid=" + url.QueryEscape(config["mchId"])
	var response wechatTransaction
	if err := p.do(ctx, config, http.MethodGet, path, nil, &response); err != nil {
		return Result{}, err
	}
	if response.AppID != config["appId"] || response.MchID != config["mchId"] || response.OutTradeNo != request.MerchantOrderNo || (response.TradeType != "" && response.TradeType != "NATIVE") {
		return Result{}, errors.New("微信支付查单结果与商户订单不匹配")
	}
	return wechatResult(response), nil
}

func (p *WeChatProvider) CloseOrder(ctx context.Context, config Config, request CloseRequest) (Result, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Result{}, err
	}
	path := "/v3/pay/transactions/out-trade-no/" + url.PathEscape(request.MerchantOrderNo) + "/close"
	if err := p.do(ctx, config, http.MethodPost, path, map[string]string{"mchid": config["mchId"]}, nil); err != nil {
		return Result{}, err
	}
	return Result{MerchantOrderNo: request.MerchantOrderNo, ProviderStatus: "CLOSED", Currency: "CNY", Closed: true}, nil
}

func (p *WeChatProvider) VerifyNotification(_ context.Context, config Config, headers http.Header, rawBody []byte) (Notification, error) {
	if err := p.ValidateConfig(config); err != nil {
		return Notification{}, err
	}
	if err := p.verifyMessage(config, headers, rawBody); err != nil {
		return Notification{}, err
	}
	var envelope struct {
		ID           string `json:"id"`
		EventType    string `json:"event_type"`
		ResourceType string `json:"resource_type"`
		Resource     struct {
			Algorithm      string `json:"algorithm"`
			Ciphertext     string `json:"ciphertext"`
			AssociatedData string `json:"associated_data"`
			Nonce          string `json:"nonce"`
		} `json:"resource"`
	}
	if err := json.Unmarshal(rawBody, &envelope); err != nil {
		return Notification{}, fmt.Errorf("解析微信支付通知：%w", err)
	}
	if envelope.ID == "" || envelope.EventType != "TRANSACTION.SUCCESS" || envelope.ResourceType != "encrypt-resource" || envelope.Resource.Algorithm != "AEAD_AES_256_GCM" {
		return Notification{}, errors.New("微信支付通知类型无效")
	}
	plaintext, err := decryptWeChatResource(config["apiV3Key"], envelope.Resource.Nonce, envelope.Resource.AssociatedData, envelope.Resource.Ciphertext)
	if err != nil {
		return Notification{}, err
	}
	var transaction wechatTransaction
	if err := json.Unmarshal(plaintext, &transaction); err != nil {
		return Notification{}, fmt.Errorf("解析微信支付通知资源：%w", err)
	}
	if transaction.AppID != config["appId"] || transaction.MchID != config["mchId"] || transaction.TradeType != "NATIVE" || transaction.TradeState != "SUCCESS" {
		return Notification{}, errors.New("微信支付通知商户身份或交易状态不匹配")
	}
	return Notification{EventID: envelope.ID, Result: wechatResult(transaction)}, nil
}

func (p *WeChatProvider) DownloadTradeBill(ctx context.Context, config Config, billDate time.Time) ([]BillRecord, error) {
	if err := p.ValidateConfig(config); err != nil {
		return nil, err
	}
	path := "/v3/bill/tradebill?bill_date=" + url.QueryEscape(billDate.Format("2006-01-02")) + "&bill_type=SUCCESS"
	var bill struct {
		HashType    string `json:"hash_type"`
		HashValue   string `json:"hash_value"`
		DownloadURL string `json:"download_url"`
	}
	if err := p.do(ctx, config, http.MethodGet, path, nil, &bill); err != nil {
		return nil, err
	}
	if !strings.EqualFold(bill.HashType, "SHA1") || strings.TrimSpace(bill.HashValue) == "" {
		return nil, errors.New("微信交易账单摘要信息无效")
	}
	target, err := trustedDownloadURL(bill.DownloadURL, p.baseURL, "api.mch.weixin.qq.com", "api2.mch.weixin.qq.com")
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/octet-stream")
	request.Header.Set("Wechatpay-Serial", config["wechatPayPublicKeyId"])
	request.Header.Set("Authorization", p.authorization(config, http.MethodGet, target.RequestURI(), nil))
	response, err := clientWithTrustedRedirects(p.client, p.baseURL, "api.mch.weixin.qq.com", "api2.mch.weixin.qq.com").Do(request)
	if err != nil {
		return nil, &ProviderError{Code: "wechat_bill_download_error", Message: "下载微信交易账单失败", Temporary: true, Cause: err}
	}
	defer response.Body.Close()
	if response.Request == nil {
		return nil, errors.New("微信交易账单下载响应无效")
	}
	if _, err := trustedDownloadURL(response.Request.URL.String(), p.baseURL, "api.mch.weixin.qq.com", "api2.mch.weixin.qq.com"); err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, &ProviderError{Code: "wechat_bill_http_error", Message: "微信交易账单下载失败", Temporary: response.StatusCode >= 500}
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxTradeBillBytes+1))
	if err != nil {
		return nil, &ProviderError{Code: "wechat_bill_read_error", Message: "读取微信交易账单失败", Temporary: true, Cause: err}
	}
	if len(raw) > maxTradeBillBytes {
		return nil, errors.New("微信交易账单超过安全限制")
	}
	digest := sha1.Sum(raw)
	if !strings.EqualFold(hex.EncodeToString(digest[:]), strings.TrimSpace(bill.HashValue)) {
		return nil, errors.New("微信交易账单摘要校验失败")
	}
	return parseWeChatTradeBill(raw)
}

type wechatTransaction struct {
	AppID          string `json:"appid"`
	MchID          string `json:"mchid"`
	OutTradeNo     string `json:"out_trade_no"`
	TransactionID  string `json:"transaction_id"`
	TradeType      string `json:"trade_type"`
	TradeState     string `json:"trade_state"`
	TradeStateDesc string `json:"trade_state_desc"`
	SuccessTime    string `json:"success_time"`
	Amount         struct {
		Total    int64  `json:"total"`
		Currency string `json:"currency"`
	} `json:"amount"`
}

func wechatResult(transaction wechatTransaction) Result {
	paidAt, _ := time.Parse(time.RFC3339, transaction.SuccessTime)
	return Result{
		MerchantOrderNo: transaction.OutTradeNo,
		ProviderTradeNo: transaction.TransactionID,
		ProviderStatus:  transaction.TradeState,
		AmountFen:       transaction.Amount.Total,
		Currency:        transaction.Amount.Currency,
		Paid:            transaction.TradeState == "SUCCESS",
		Closed:          transaction.TradeState == "CLOSED",
		PaidAt:          paidAt,
	}
}

func (p *WeChatProvider) do(ctx context.Context, config Config, method, path string, payload any, output any) error {
	var body []byte
	var err error
	if payload != nil {
		body, err = json.Marshal(payload)
		if err != nil {
			return err
		}
	}
	request, err := http.NewRequestWithContext(ctx, method, p.baseURL+path, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Wechatpay-Serial", config["wechatPayPublicKeyId"])
	request.Header.Set("Authorization", p.authorization(config, method, request.URL.RequestURI(), body))
	response, err := p.client.Do(request)
	if err != nil {
		return &ProviderError{Code: "wechat_transport_error", Message: "微信支付网络请求失败", Temporary: true, Cause: err}
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return &ProviderError{Code: "wechat_response_read_error", Message: "读取微信支付响应失败", Temporary: true, Cause: err}
	}
	if err := p.verifyMessage(config, response.Header, responseBody); err != nil {
		return fmt.Errorf("微信支付响应验签失败：%w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var detail struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		_ = json.Unmarshal(responseBody, &detail)
		if detail.Code == "NO_STATEMENT_EXIST" {
			return fmt.Errorf("%w: %s", ErrTradeBillNotFound, detail.Code)
		}
		if response.StatusCode == http.StatusNotFound {
			return fmt.Errorf("%w: %s", ErrOrderNotFound, detail.Code)
		}
		return &ProviderError{Code: detail.Code, Message: "微信支付接口返回失败", Temporary: response.StatusCode >= 500}
	}
	if output == nil || len(responseBody) == 0 {
		return nil
	}
	if err := json.Unmarshal(responseBody, output); err != nil {
		return fmt.Errorf("解析微信支付响应：%w", err)
	}
	return nil
}

func (p *WeChatProvider) authorization(config Config, method, target string, body []byte) string {
	timestamp := strconv.FormatInt(p.now().Unix(), 10)
	nonce := randomHex(16)
	message := method + "\n" + target + "\n" + timestamp + "\n" + nonce + "\n" + string(body) + "\n"
	privateKey, _ := parseRSAPrivateKey(config["merchantPrivateKey"])
	signature, _ := rsaSHA256Sign(privateKey, []byte(message))
	return fmt.Sprintf(`WECHATPAY2-SHA256-RSA2048 mchid="%s",nonce_str="%s",signature="%s",timestamp="%s",serial_no="%s"`, config["mchId"], nonce, signature, timestamp, config["merchantSerialNo"])
}

func (p *WeChatProvider) verifyMessage(config Config, headers http.Header, body []byte) error {
	timestamp := strings.TrimSpace(headers.Get("Wechatpay-Timestamp"))
	nonce := headers.Get("Wechatpay-Nonce")
	signature := headers.Get("Wechatpay-Signature")
	serial := headers.Get("Wechatpay-Serial")
	if timestamp == "" || nonce == "" || signature == "" || serial == "" {
		return errors.New("微信支付签名请求头不完整")
	}
	if serial != config["wechatPayPublicKeyId"] {
		return errors.New("微信支付公钥 ID 不匹配")
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || absDuration(p.now().Sub(time.Unix(seconds, 0))) > 5*time.Minute {
		return errors.New("微信支付签名时间戳无效")
	}
	publicKey, err := parseRSAPublicKey(config["wechatPayPublicKey"])
	if err != nil {
		return err
	}
	message := timestamp + "\n" + nonce + "\n" + string(body) + "\n"
	return rsaSHA256Verify(publicKey, []byte(message), signature)
}

func decryptWeChatResource(apiV3Key, nonce, associatedData, ciphertext string) ([]byte, error) {
	block, err := aes.NewCipher([]byte(apiV3Key))
	if err != nil {
		return nil, fmt.Errorf("创建微信支付解密器：%w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	decoded, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, fmt.Errorf("微信支付通知密文无效：%w", err)
	}
	plaintext, err := gcm.Open(nil, []byte(nonce), decoded, []byte(associatedData))
	if err != nil {
		return nil, errors.New("微信支付通知解密失败")
	}
	return plaintext, nil
}

func randomHex(size int) string {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		sum := sha256.Sum256([]byte(strconv.FormatInt(time.Now().UnixNano(), 10)))
		return hex.EncodeToString(sum[:size])
	}
	return hex.EncodeToString(value)
}

func absDuration(value time.Duration) time.Duration {
	if value < 0 {
		return -value
	}
	return value
}

func truncateUTF8(value string, limit int) string {
	value = strings.TrimSpace(value)
	for len([]byte(value)) > limit {
		runes := []rune(value)
		value = string(runes[:len(runes)-1])
	}
	return value
}
