package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"infinite-canvas/backend/internal/model"

	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"github.com/wechatpay-apiv3/wechatpay-go/core/auth/verifiers"
	"github.com/wechatpay-apiv3/wechatpay-go/core/consts"
	"github.com/wechatpay-apiv3/wechatpay-go/core/downloader"
	"github.com/wechatpay-apiv3/wechatpay-go/core/notify"
	"github.com/wechatpay-apiv3/wechatpay-go/core/option"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments"
	"github.com/wechatpay-apiv3/wechatpay-go/services/payments/native"
	"github.com/wechatpay-apiv3/wechatpay-go/utils"
)

type wechatPayProvider struct {
	merchantID string
	api        native.NativeApiService
	notify     *notify.Handler
	downloader *downloader.CertificateDownloaderMgr
	client     *core.Client
	billClient *core.Client
}

func newWechatPayProvider(ctx context.Context, version model.PaymentChannelVersion, privateKeyPEM string, apiV3Key string) (*wechatPayProvider, error) {
	privateKey, err := utils.LoadPrivateKey(privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("读取商户私钥：%w", err)
	}
	if len(apiV3Key) != 32 {
		return nil, errors.New("APIv3 密钥必须是 32 个字符")
	}

	var clientOption core.ClientOption
	var verifier coreVerifier
	var manager *downloader.CertificateDownloaderMgr
	switch version.VerifyMode {
	case model.PaymentVerifyPublicKey:
		publicKey, loadErr := utils.LoadPublicKey(version.WechatPayPublicKey)
		if loadErr != nil {
			return nil, fmt.Errorf("读取微信支付公钥：%w", loadErr)
		}
		if strings.TrimSpace(version.WechatPayPublicKeyID) == "" {
			return nil, errors.New("微信支付公钥 ID 不能为空")
		}
		clientOption = option.WithWechatPayPublicKeyAuthCipher(version.MerchantID, version.MerchantCertSerial, privateKey, version.WechatPayPublicKeyID, publicKey)
		verifier = verifiers.NewSHA256WithRSAPubkeyVerifier(version.WechatPayPublicKeyID, *publicKey)
	case model.PaymentVerifyCertificate:
		manager = downloader.NewCertificateDownloaderMgr(context.Background())
		if err := manager.RegisterDownloaderWithPrivateKey(ctx, privateKey, version.MerchantCertSerial, version.MerchantID, apiV3Key); err != nil {
			manager.Stop()
			return nil, fmt.Errorf("下载微信支付平台证书：%w", err)
		}
		clientOption = option.WithWechatPayAutoAuthCipherUsingDownloaderMgr(version.MerchantID, version.MerchantCertSerial, privateKey, manager)
		verifier = verifiers.NewSHA256WithRSAVerifier(manager.GetCertificateVisitor(version.MerchantID))
	default:
		return nil, errors.New("不支持的微信支付验签模式")
	}
	client, err := core.NewClient(ctx, clientOption)
	if err != nil {
		if manager != nil {
			manager.Stop()
		}
		return nil, fmt.Errorf("初始化微信支付客户端：%w", err)
	}
	notifyHandler, err := notify.NewRSANotifyHandler(apiV3Key, verifier)
	if err != nil {
		if manager != nil {
			manager.Stop()
		}
		return nil, fmt.Errorf("初始化微信支付回调处理器：%w", err)
	}
	billClient, err := core.NewClient(ctx, option.WithMerchantCredential(version.MerchantID, version.MerchantCertSerial, privateKey), option.WithoutValidator())
	if err != nil {
		if manager != nil {
			manager.Stop()
		}
		return nil, fmt.Errorf("初始化微信支付账单客户端：%w", err)
	}
	return &wechatPayProvider{
		merchantID: version.MerchantID,
		api:        native.NativeApiService{Client: client},
		notify:     notifyHandler,
		downloader: manager,
		client:     client,
		billClient: billClient,
	}, nil
}

func (p *wechatPayProvider) DownloadTradeBill(ctx context.Context, billDate string) ([]byte, string, error) {
	requestURL := "https://api.mch.weixin.qq.com/v3/bill/tradebill?bill_date=" + url.QueryEscape(billDate) + "&bill_type=ALL"
	result, err := p.client.Get(ctx, requestURL)
	if err != nil {
		return nil, "", err
	}
	if result == nil || result.Response == nil {
		return nil, "", errors.New("微信支付未返回账单申请响应")
	}
	defer result.Response.Body.Close()
	var response struct {
		HashType    string `json:"hash_type"`
		HashValue   string `json:"hash_value"`
		DownloadURL string `json:"download_url"`
	}
	if err := json.NewDecoder(io.LimitReader(result.Response.Body, 1<<20)).Decode(&response); err != nil {
		return nil, "", fmt.Errorf("解析微信支付账单申请响应：%w", err)
	}
	if !strings.EqualFold(response.HashType, "SHA256") || strings.TrimSpace(response.HashValue) == "" {
		return nil, "", errors.New("微信支付账单摘要算法不是 SHA256")
	}
	downloadURL, err := url.Parse(response.DownloadURL)
	if err != nil || downloadURL.Scheme != "https" || !allowedWechatBillHost(downloadURL.Hostname()) {
		return nil, "", errors.New("微信支付账单下载地址无效")
	}
	download, err := p.billClient.Get(ctx, downloadURL.String())
	if err != nil {
		return nil, "", err
	}
	if download == nil || download.Response == nil {
		return nil, "", errors.New("微信支付未返回账单文件")
	}
	defer download.Response.Body.Close()
	const maxBillBytes = 64 << 20
	content, err := io.ReadAll(io.LimitReader(download.Response.Body, maxBillBytes+1))
	if err != nil {
		return nil, "", fmt.Errorf("读取微信支付账单文件：%w", err)
	}
	if len(content) > maxBillBytes {
		return nil, "", errors.New("微信支付账单文件超过 64 MiB 限制")
	}
	digest := sha256.Sum256(content)
	actualHash := hex.EncodeToString(digest[:])
	if !strings.EqualFold(actualHash, response.HashValue) {
		return nil, "", errors.New("微信支付账单 SHA256 完整性校验失败")
	}
	return content, actualHash, nil
}

func allowedWechatBillHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return host == "api.mch.weixin.qq.com" || host == "api2.mch.weixin.qq.com"
}

// coreVerifier keeps the SDK verifier type behind its public interface without duplicating crypto code.
type coreVerifier interface {
	Verify(context.Context, string, string, string) error
	GetSerial(context.Context) (string, error)
}

func (p *wechatPayProvider) Prepay(ctx context.Context, input paymentPrepayRequest) (paymentPrepayResult, error) {
	response, result, err := p.api.Prepay(ctx, native.PrepayRequest{
		Appid: core.String(input.AppID), Mchid: core.String(input.MerchantID),
		Description: core.String(input.Description), OutTradeNo: core.String(input.OutTradeNo),
		TimeExpire: &input.ExpiresAt, NotifyUrl: core.String(input.NotifyURL),
		Amount: &native.Amount{Total: core.Int64(input.AmountFen), Currency: core.String("CNY")},
	})
	if err != nil {
		return paymentPrepayResult{}, err
	}
	if response == nil || response.CodeUrl == nil || strings.TrimSpace(*response.CodeUrl) == "" {
		return paymentPrepayResult{}, errors.New("微信支付未返回二维码链接")
	}
	return paymentPrepayResult{CodeURL: *response.CodeUrl, RequestID: paymentRequestID(result)}, nil
}

func (p *wechatPayProvider) Query(ctx context.Context, outTradeNo string) (paymentTransaction, error) {
	transaction, _, err := p.api.QueryOrderByOutTradeNo(ctx, native.QueryOrderByOutTradeNoRequest{
		OutTradeNo: core.String(outTradeNo), Mchid: core.String(p.merchantID),
	})
	if err != nil {
		return paymentTransaction{}, err
	}
	return transactionFromWechat(transaction), nil
}

func (p *wechatPayProvider) Close(ctx context.Context, outTradeNo string) error {
	_, err := p.api.CloseOrder(ctx, native.CloseOrderRequest{OutTradeNo: core.String(outTradeNo), Mchid: core.String(p.merchantID)})
	return err
}

func (p *wechatPayProvider) ParseNotification(ctx context.Context, request *http.Request) (paymentNotification, error) {
	transaction := new(payments.Transaction)
	notifyRequest, err := p.notify.ParseNotifyRequest(ctx, request, transaction)
	if err != nil {
		return paymentNotification{}, err
	}
	digest := sha256.Sum256([]byte(notifyRequest.Resource.Plaintext))
	return paymentNotification{
		ProviderEventID: notifyRequest.ID,
		EventType:       notifyRequest.EventType,
		ResourceDigest:  hex.EncodeToString(digest[:]),
		Transaction:     transactionFromWechat(transaction),
	}, nil
}

func transactionFromWechat(value *payments.Transaction) paymentTransaction {
	if value == nil {
		return paymentTransaction{}
	}
	transaction := paymentTransaction{
		AppID: paymentStringValue(value.Appid), MerchantID: paymentStringValue(value.Mchid),
		OutTradeNo: paymentStringValue(value.OutTradeNo), TransactionID: paymentStringValue(value.TransactionId),
		TradeState: paymentStringValue(value.TradeState), TradeStateDescription: paymentStringValue(value.TradeStateDesc),
		SuccessTime: paymentStringValue(value.SuccessTime), Currency: "CNY",
	}
	if value.Amount != nil {
		if value.Amount.Total != nil {
			transaction.AmountFen = *value.Amount.Total
		}
		transaction.Currency = defaultString(paymentStringValue(value.Amount.Currency), "CNY")
	}
	return transaction
}

func paymentRequestID(result *core.APIResult) string {
	if result == nil || result.Response == nil {
		return ""
	}
	return result.Response.Header.Get(consts.RequestID)
}

func paymentStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
