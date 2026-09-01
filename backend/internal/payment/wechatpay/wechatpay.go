package wechatpay

import (
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/payment"

	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"
)

const (
	providerCode     = "wechatpay"
	wechatPayAPIBase = "https://api.mch.weixin.qq.com"
	maxBillBytes     = 64 << 20
)

type Config struct {
	AppID                       string `json:"appId"`
	MchID                       string `json:"mchId"`
	MerchantCertificateSerialNo string `json:"merchantCertificateSerialNo"`
	MerchantPrivateKeyPEM       string `json:"merchantPrivateKeyPem"`
	APIv3Key                    string `json:"apiV3Key"`
	WeChatPayPublicKeyID        string `json:"wechatPayPublicKeyId"`
	WeChatPayPublicKeyPEM       string `json:"wechatPayPublicKeyPem"`
	NotifyBaseURL               string `json:"notifyBaseUrl"`
}

type Provider struct{}

func New() *Provider { return &Provider{} }

func (p *Provider) Descriptor() payment.Descriptor {
	return payment.Descriptor{
		Code: providerCode, Name: "微信支付", Methods: []string{"native"},
		ConfigFields: []payment.ConfigField{
			{Key: "appId", Label: "应用 AppID", Kind: "text", Required: true},
			{Key: "mchId", Label: "直连商户号", Kind: "text", Required: true},
			{Key: "merchantCertificateSerialNo", Label: "商户证书序列号", Kind: "text", Required: true},
			{Key: "merchantPrivateKeyPem", Label: "商户 API 私钥", Kind: "textarea", Required: true, Secret: true},
			{Key: "apiV3Key", Label: "APIv3 密钥", Kind: "password", Required: true, Secret: true},
			{Key: "wechatPayPublicKeyId", Label: "微信支付公钥 ID", Kind: "text", Required: true},
			{Key: "wechatPayPublicKeyPem", Label: "微信支付公钥", Kind: "textarea", Required: true, Secret: true},
			{Key: "notifyBaseUrl", Label: "支付回调公网地址", Kind: "text", Required: true, Placeholder: "https://example.com"},
		},
	}
}

func (p *Provider) ValidateConfig(_ context.Context, raw json.RawMessage) error {
	_, _, _, err := parseConfig(raw)
	return err
}

// TestConnection performs a signed query for a deliberately nonexistent
// merchant order. ORDER_NOT_EXIST proves that WeChat accepted the merchant
// signature and that the response verification key is usable, without creating
// a payment or producing any financial side effect.
func (p *Provider) TestConnection(ctx context.Context, raw json.RawMessage) error {
	config, client, _, err := parseConfig(raw)
	if err != nil {
		return err
	}
	orderID := fmt.Sprintf("RTEST%d", time.Now().UTC().UnixNano())
	service := native.NativeApiService{Client: client}
	_, _, err = service.QueryOrderByOutTradeNo(ctx, native.QueryOrderByOutTradeNoRequest{OutTradeNo: &orderID, Mchid: &config.MchID})
	if err == nil {
		return nil
	}
	var apiError *core.APIError
	if errors.As(err, &apiError) && strings.EqualFold(apiError.Code, "ORDER_NOT_EXIST") {
		return nil
	}
	return classifyProviderError("WECHATPAY_CONNECTION_TEST_FAILED", err)
}

func (p *Provider) CreatePayment(ctx context.Context, raw json.RawMessage, request payment.CreatePaymentRequest) (*payment.CreatePaymentResult, error) {
	config, client, _, err := parseConfig(raw)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(request.OrderID) == "" || request.AmountFen <= 0 || !strings.EqualFold(request.Currency, "CNY") {
		return nil, errors.New("invalid WeChat Pay order snapshot")
	}
	if parsed, err := url.ParseRequestURI(request.NotifyURL); err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.RawQuery != "" {
		return nil, errors.New("WeChat Pay notify URL must be a public HTTPS URL without a query string")
	}
	description := strings.TrimSpace(request.Description)
	if description == "" {
		description = "积分充值"
	}
	if len([]rune(description)) > 127 {
		description = string([]rune(description)[:127])
	}
	service := native.NativeApiService{Client: client}
	response, _, err := service.Prepay(ctx, native.PrepayRequest{
		Appid: &config.AppID, Mchid: &config.MchID, Description: &description,
		OutTradeNo: &request.OrderID, TimeExpire: &request.ExpiresAt, NotifyUrl: &request.NotifyURL,
		Amount: &native.Amount{Total: &request.AmountFen, Currency: stringPointer("CNY")},
	})
	if err != nil {
		return nil, classifyProviderError("WECHATPAY_PREPAY_FAILED", err)
	}
	if response == nil || response.CodeUrl == nil || strings.TrimSpace(*response.CodeUrl) == "" {
		return nil, &payment.ProviderError{Code: "WECHATPAY_INVALID_PREPAY_RESPONSE", Uncertain: true, Retryable: true}
	}
	return &payment.CreatePaymentResult{
		PayPayload: map[string]any{"type": "qr_code", "codeUrl": *response.CodeUrl},
		ExpiresAt:  request.ExpiresAt,
	}, nil
}

func (p *Provider) QueryPayment(ctx context.Context, raw json.RawMessage, orderID string) (*payment.PaymentStatus, error) {
	config, client, _, err := parseConfig(raw)
	if err != nil {
		return nil, err
	}
	service := native.NativeApiService{Client: client}
	transaction, _, err := service.QueryOrderByOutTradeNo(ctx, native.QueryOrderByOutTradeNoRequest{OutTradeNo: &orderID, Mchid: &config.MchID})
	if err != nil {
		return nil, classifyProviderError("WECHATPAY_QUERY_FAILED", err)
	}
	return transactionStatus(transaction), nil
}

func (p *Provider) ClosePayment(ctx context.Context, raw json.RawMessage, orderID string) error {
	config, client, _, err := parseConfig(raw)
	if err != nil {
		return err
	}
	service := native.NativeApiService{Client: client}
	if _, err := service.CloseOrder(ctx, native.CloseOrderRequest{OutTradeNo: &orderID, Mchid: &config.MchID}); err != nil {
		return classifyProviderError("WECHATPAY_CLOSE_FAILED", err)
	}
	return nil
}

func (p *Provider) ParseNotification(ctx context.Context, raw json.RawMessage, request *http.Request) (*payment.PaymentNotification, error) {
	config, _, publicKey, err := parseConfig(raw)
	if err != nil {
		return nil, err
	}
	verifier := verifiers.NewSHA256WithRSAPubkeyVerifier(config.WeChatPayPublicKeyID, *publicKey)
	handler, err := notify.NewRSANotifyHandler(config.APIv3Key, verifier)
	if err != nil {
		return nil, err
	}
	var transaction payments.Transaction
	notification, err := handler.ParseNotifyRequest(ctx, request, &transaction)
	if err != nil {
		return nil, &payment.ProviderError{Code: "WECHATPAY_INVALID_NOTIFICATION", Err: err}
	}
	if stringValue(transaction.Appid) != config.AppID || stringValue(transaction.Mchid) != config.MchID {
		return nil, &payment.ProviderError{Code: "WECHATPAY_NOTIFICATION_MERCHANT_MISMATCH"}
	}
	status := transactionStatus(&transaction)
	if strings.TrimSpace(notification.ID) == "" || strings.TrimSpace(status.OrderID) == "" {
		return nil, &payment.ProviderError{Code: "WECHATPAY_INVALID_NOTIFICATION_CONTENT"}
	}
	return &payment.PaymentNotification{
		EventID: notification.ID, EventType: notification.EventType, ResourceType: notification.ResourceType,
		Summary: notification.Summary, OrderID: status.OrderID, State: status.State,
		ProviderTransactionID: status.ProviderTransactionID, AmountFen: status.AmountFen,
		Currency: status.Currency, PaidAt: status.PaidAt,
	}, nil
}

func (p *Provider) DownloadTradeBill(ctx context.Context, raw json.RawMessage, tradeDate string) (*payment.TradeBill, error) {
	_, client, _, err := parseConfig(raw)
	if err != nil {
		return nil, err
	}
	if _, err := time.Parse("2006-01-02", tradeDate); err != nil {
		return nil, errors.New("trade date must be YYYY-MM-DD")
	}
	requestURL := wechatPayAPIBase + "/v3/bill/tradebill?bill_date=" + url.QueryEscape(tradeDate) + "&bill_type=ALL"
	result, err := client.Get(ctx, requestURL)
	if err != nil {
		return nil, classifyProviderError("WECHATPAY_TRADE_BILL_FAILED", err)
	}
	var response struct {
		HashType    string `json:"hash_type"`
		HashValue   string `json:"hash_value"`
		DownloadURL string `json:"download_url"`
	}
	if err := core.UnMarshalResponse(result.Response, &response); err != nil {
		return nil, err
	}
	if response.DownloadURL == "" || !strings.EqualFold(response.HashType, "SHA256") || response.HashValue == "" {
		return nil, errors.New("invalid WeChat Pay trade bill response")
	}
	downloadRequest, err := http.NewRequestWithContext(ctx, http.MethodGet, response.DownloadURL, nil)
	if err != nil {
		return nil, err
	}
	downloadResponse, err := http.DefaultClient.Do(downloadRequest)
	if err != nil {
		return nil, classifyProviderError("WECHATPAY_TRADE_BILL_DOWNLOAD_FAILED", err)
	}
	defer downloadResponse.Body.Close()
	if downloadResponse.StatusCode < 200 || downloadResponse.StatusCode > 299 {
		return nil, &payment.ProviderError{Code: "WECHATPAY_TRADE_BILL_DOWNLOAD_FAILED", Retryable: downloadResponse.StatusCode >= 500, Err: fmt.Errorf("HTTP %d", downloadResponse.StatusCode)}
	}
	content, err := io.ReadAll(io.LimitReader(downloadResponse.Body, maxBillBytes+1))
	if err != nil {
		return nil, err
	}
	if len(content) > maxBillBytes {
		return nil, errors.New("WeChat Pay trade bill exceeds 64 MiB limit")
	}
	digestBytes := sha256.Sum256(content)
	digest := hex.EncodeToString(digestBytes[:])
	if !strings.EqualFold(digest, response.HashValue) {
		return nil, errors.New("WeChat Pay trade bill digest mismatch")
	}
	return &payment.TradeBill{TradeDate: tradeDate, Content: content, Digest: digest, ContentType: downloadResponse.Header.Get("Content-Type")}, nil
}

func parseConfig(raw json.RawMessage) (Config, *core.Client, *rsa.PublicKey, error) {
	var config Config
	if err := json.Unmarshal(raw, &config); err != nil {
		return config, nil, nil, fmt.Errorf("invalid WeChat Pay config: %w", err)
	}
	config.AppID = strings.TrimSpace(config.AppID)
	config.MchID = strings.TrimSpace(config.MchID)
	config.MerchantCertificateSerialNo = strings.TrimSpace(config.MerchantCertificateSerialNo)
	config.WeChatPayPublicKeyID = strings.TrimSpace(config.WeChatPayPublicKeyID)
	config.NotifyBaseURL = strings.TrimRight(strings.TrimSpace(config.NotifyBaseURL), "/")
	if config.AppID == "" || config.MchID == "" || config.MerchantCertificateSerialNo == "" || config.WeChatPayPublicKeyID == "" {
		return config, nil, nil, errors.New("WeChat Pay AppID, merchant ID, certificate serial and public key ID are required")
	}
	if len(config.APIv3Key) != 32 {
		return config, nil, nil, errors.New("WeChat Pay APIv3 key must contain exactly 32 bytes")
	}
	notifyBaseURL, err := url.ParseRequestURI(config.NotifyBaseURL)
	if err != nil || notifyBaseURL.Scheme != "https" || notifyBaseURL.Host == "" || notifyBaseURL.RawQuery != "" || notifyBaseURL.Fragment != "" {
		return config, nil, nil, errors.New("WeChat Pay notify base URL must be a public HTTPS URL without query or fragment")
	}
	privateKey, err := utils.LoadPrivateKey(strings.TrimSpace(config.MerchantPrivateKeyPEM))
	if err != nil {
		return config, nil, nil, fmt.Errorf("invalid merchant private key: %w", err)
	}
	publicKey, err := utils.LoadPublicKey(strings.TrimSpace(config.WeChatPayPublicKeyPEM))
	if err != nil {
		return config, nil, nil, fmt.Errorf("invalid WeChat Pay public key: %w", err)
	}
	client, err := core.NewClient(context.Background(), option.WithWechatPayPublicKeyAuthCipher(
		config.MchID, config.MerchantCertificateSerialNo, privateKey, config.WeChatPayPublicKeyID, publicKey,
	))
	if err != nil {
		return config, nil, nil, err
	}
	return config, client, publicKey, nil
}

func transactionStatus(transaction *payments.Transaction) *payment.PaymentStatus {
	status := &payment.PaymentStatus{}
	if transaction == nil {
		return status
	}
	status.OrderID = stringValue(transaction.OutTradeNo)
	status.State = stringValue(transaction.TradeState)
	status.StateDescription = stringValue(transaction.TradeStateDesc)
	status.ProviderTransactionID = stringValue(transaction.TransactionId)
	if transaction.Amount != nil {
		status.AmountFen = int64Value(transaction.Amount.Total)
		status.Currency = stringValue(transaction.Amount.Currency)
	}
	if transaction.SuccessTime != nil {
		status.PaidAt, _ = time.Parse(time.RFC3339, *transaction.SuccessTime)
	}
	return status
}

func classifyProviderError(code string, err error) error {
	providerError := &payment.ProviderError{Code: code, Err: err, Retryable: true, Uncertain: true}
	var apiError *core.APIError
	if errors.As(err, &apiError) {
		providerError.Code = apiError.Code
		providerError.Retryable = apiError.StatusCode == http.StatusTooManyRequests || apiError.StatusCode >= 500
		providerError.Uncertain = apiError.StatusCode >= 500
	}
	return providerError
}

func stringPointer(value string) *string { return &value }

func stringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func int64Value(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}
