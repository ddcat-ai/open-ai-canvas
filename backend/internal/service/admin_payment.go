package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"regexp"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"github.com/wechatpay-apiv3/wechatpay-go/utils"
	"gorm.io/gorm"
)

var paymentCodePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{2,48}$`)

type PaymentChannelCredentialRequest struct {
	AppID                string `json:"appId"`
	MerchantID           string `json:"merchantId"`
	MerchantCertSerial   string `json:"merchantCertSerial"`
	MerchantPrivateKey   string `json:"merchantPrivateKey"`
	APIv3Key             string `json:"apiV3Key"`
	VerifyMode           string `json:"verifyMode"`
	WechatPayPublicKeyID string `json:"wechatPayPublicKeyId"`
	WechatPayPublicKey   string `json:"wechatPayPublicKey"`
}

type CreatePaymentChannelRequest struct {
	Code               string `json:"code"`
	Name               string `json:"name"`
	Enabled            bool   `json:"enabled"`
	IsDefault          bool   `json:"isDefault"`
	NotifyBaseURL      string `json:"notifyBaseUrl"`
	OrderExpireMinutes int    `json:"orderExpireMinutes"`
	PaymentChannelCredentialRequest
}

type UpdatePaymentChannelRequest struct {
	Name               *string `json:"name"`
	Enabled            *bool   `json:"enabled"`
	IsDefault          *bool   `json:"isDefault"`
	NotifyBaseURL      *string `json:"notifyBaseUrl"`
	OrderExpireMinutes *int    `json:"orderExpireMinutes"`
}

type PaymentChannelVersionView struct {
	ID                    string                            `json:"id"`
	ChannelID             string                            `json:"channelId"`
	Version               int                               `json:"version"`
	AppID                 string                            `json:"appId"`
	MerchantID            string                            `json:"merchantId"`
	MerchantCertSerial    string                            `json:"merchantCertSerial"`
	VerifyMode            string                            `json:"verifyMode"`
	WechatPayPublicKeyID  string                            `json:"wechatPayPublicKeyId,omitempty"`
	ConfigFingerprint     string                            `json:"configFingerprint"`
	Status                model.PaymentChannelVersionStatus `json:"status"`
	HasMerchantPrivateKey bool                              `json:"hasMerchantPrivateKey"`
	HasAPIv3Key           bool                              `json:"hasApiV3Key"`
	HasWechatPayPublicKey bool                              `json:"hasWechatPayPublicKey"`
	CreatedBy             string                            `json:"createdBy"`
	CreatedAt             time.Time                         `json:"createdAt"`
}

type PaymentChannelDetail struct {
	Channel     model.PaymentChannel        `json:"channel"`
	Versions    []PaymentChannelVersionView `json:"versions"`
	CallbackURL string                      `json:"callbackUrl,omitempty"`
}

type RechargeProductRequest struct {
	SKU                 string `json:"sku"`
	Name                string `json:"name"`
	Description         string `json:"description"`
	AmountFen           int64  `json:"amountFen"`
	CreditsMicrocredits int64  `json:"creditsMicrocredits"`
	Enabled             bool   `json:"enabled"`
	SortOrder           int    `json:"sortOrder"`
}

type AdminPaymentOrderPage struct {
	Orders []repository.AdminPaymentOrderRow `json:"orders"`
	Total  int64                             `json:"total"`
	Page   int                               `json:"page"`
	Limit  int                               `json:"limit"`
}

func (s *Service) AdminPaymentChannels(actor *model.User) ([]model.PaymentChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.repo.PaymentChannels()
}

func (s *Service) AdminPaymentChannel(actor *model.User, id string) (*PaymentChannelDetail, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.PaymentChannel(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("支付渠道不存在")
	}
	if err != nil {
		return nil, err
	}
	versions, err := s.repo.PaymentChannelVersions(channel.ID)
	if err != nil {
		return nil, err
	}
	views := make([]PaymentChannelVersionView, 0, len(versions))
	for _, version := range versions {
		views = append(views, paymentVersionView(version))
	}
	callbackURL := ""
	if channel.ActiveVersionID != "" {
		callbackURL = paymentNotifyURL(channel.NotifyBaseURL, channel.ActiveVersionID)
	}
	return &PaymentChannelDetail{Channel: *channel, Versions: views, CallbackURL: callbackURL}, nil
}

func (s *Service) CreateAdminPaymentChannel(actor *model.User, req CreatePaymentChannelRequest) (*PaymentChannelDetail, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	code := strings.ToLower(strings.TrimSpace(req.Code))
	name := strings.TrimSpace(req.Name)
	if !paymentCodePattern.MatchString(code) {
		return nil, BadAuthRequest("渠道编码只能包含字母、数字、中划线或下划线")
	}
	if name == "" {
		return nil, BadAuthRequest("请填写渠道名称")
	}
	notifyBaseURL, err := validatePaymentNotifyBaseURL(req.NotifyBaseURL)
	if err != nil {
		return nil, err
	}
	if req.OrderExpireMinutes < 5 || req.OrderExpireMinutes > 120 {
		if req.OrderExpireMinutes == 0 {
			req.OrderExpireMinutes = 15
		} else {
			return nil, BadAuthRequest("订单有效期必须在 5–120 分钟之间")
		}
	}
	now := time.Now()
	channel := &model.PaymentChannel{
		ID: newID(), Code: code, Name: truncateRunes(name, 120), Provider: model.PaymentProviderWechatPay,
		PaymentMethod: model.PaymentMethodNative, Enabled: req.Enabled, IsDefault: req.IsDefault,
		NotifyBaseURL: notifyBaseURL, OrderExpireMinutes: req.OrderExpireMinutes,
		CreatedBy: actor.ID, UpdatedBy: actor.ID, CreatedAt: now, UpdatedAt: now,
	}
	version, err := s.buildPaymentChannelVersion(channel.ID, 1, actor.ID, req.PaymentChannelCredentialRequest)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreatePaymentChannel(channel, version); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "payment_channel.create", "payment_channel", channel.ID, "创建微信支付渠道", map[string]any{"code": channel.Code, "version": 1}); err != nil {
		return nil, err
	}
	return s.AdminPaymentChannel(actor, channel.ID)
}

func (s *Service) UpdateAdminPaymentChannel(actor *model.User, id string, req UpdatePaymentChannelRequest) (*PaymentChannelDetail, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.PaymentChannel(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("支付渠道不存在")
	}
	if err != nil {
		return nil, err
	}
	if req.Name != nil {
		channel.Name = truncateRunes(strings.TrimSpace(*req.Name), 120)
		if channel.Name == "" {
			return nil, BadAuthRequest("渠道名称不能为空")
		}
	}
	if req.Enabled != nil {
		channel.Enabled = *req.Enabled
	}
	if req.IsDefault != nil {
		channel.IsDefault = *req.IsDefault
	}
	if req.NotifyBaseURL != nil {
		channel.NotifyBaseURL, err = validatePaymentNotifyBaseURL(*req.NotifyBaseURL)
		if err != nil {
			return nil, err
		}
	}
	if req.OrderExpireMinutes != nil {
		if *req.OrderExpireMinutes < 5 || *req.OrderExpireMinutes > 120 {
			return nil, BadAuthRequest("订单有效期必须在 5–120 分钟之间")
		}
		channel.OrderExpireMinutes = *req.OrderExpireMinutes
	}
	channel.UpdatedBy = actor.ID
	channel.UpdatedAt = time.Now()
	if err := s.repo.SavePaymentChannel(channel); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "payment_channel.update", "payment_channel", channel.ID, "更新支付渠道运营配置", map[string]any{"enabled": channel.Enabled, "isDefault": channel.IsDefault, "orderExpireMinutes": channel.OrderExpireMinutes}); err != nil {
		return nil, err
	}
	return s.AdminPaymentChannel(actor, channel.ID)
}

func (s *Service) RotateAdminPaymentChannelVersion(actor *model.User, id string, req PaymentChannelCredentialRequest) (*PaymentChannelDetail, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.PaymentChannel(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("支付渠道不存在")
	}
	if err != nil {
		return nil, err
	}
	versions, err := s.repo.PaymentChannelVersions(channel.ID)
	if err != nil {
		return nil, err
	}
	nextVersion := 1
	for _, version := range versions {
		if version.Version >= nextVersion {
			nextVersion = version.Version + 1
		}
	}
	version, err := s.buildPaymentChannelVersion(channel.ID, nextVersion, actor.ID, req)
	if err != nil {
		return nil, err
	}
	channel.UpdatedBy = actor.ID
	channel.UpdatedAt = time.Now()
	if err := s.repo.RotatePaymentChannelVersion(channel, version); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "payment_channel.rotate_credentials", "payment_channel", channel.ID, "轮换微信支付渠道凭据", map[string]any{"version": nextVersion, "fingerprint": version.ConfigFingerprint}); err != nil {
		return nil, err
	}
	return s.AdminPaymentChannel(actor, channel.ID)
}

func (s *Service) TestAdminPaymentChannel(ctx context.Context, actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	channel, err := s.repo.PaymentChannel(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("支付渠道不存在")
	}
	if err != nil {
		return err
	}
	version, err := s.repo.PaymentChannelVersion(channel.ActiveVersionID)
	if err != nil {
		return err
	}
	_, err = s.paymentProvider(ctx, *version)
	return err
}

func (s *Service) buildPaymentChannelVersion(channelID string, versionNumber int, actorID string, req PaymentChannelCredentialRequest) (*model.PaymentChannelVersion, error) {
	req.AppID = strings.TrimSpace(req.AppID)
	req.MerchantID = strings.TrimSpace(req.MerchantID)
	req.MerchantCertSerial = strings.TrimSpace(req.MerchantCertSerial)
	req.MerchantPrivateKey = strings.TrimSpace(req.MerchantPrivateKey)
	req.APIv3Key = strings.TrimSpace(req.APIv3Key)
	req.VerifyMode = strings.TrimSpace(req.VerifyMode)
	req.WechatPayPublicKeyID = strings.TrimSpace(req.WechatPayPublicKeyID)
	req.WechatPayPublicKey = strings.TrimSpace(req.WechatPayPublicKey)
	if req.AppID == "" || req.MerchantID == "" || req.MerchantCertSerial == "" {
		return nil, BadAuthRequest("AppID、商户号和商户证书序列号不能为空")
	}
	if _, err := utils.LoadPrivateKey(req.MerchantPrivateKey); err != nil {
		return nil, BadAuthRequest("商户私钥不是有效的 PKCS#8 RSA PEM")
	}
	if len(req.APIv3Key) != 32 {
		return nil, BadAuthRequest("APIv3 密钥必须是 32 个字符")
	}
	switch req.VerifyMode {
	case model.PaymentVerifyPublicKey:
		if req.WechatPayPublicKeyID == "" {
			return nil, BadAuthRequest("请填写微信支付公钥 ID")
		}
		if _, err := utils.LoadPublicKey(req.WechatPayPublicKey); err != nil {
			return nil, BadAuthRequest("微信支付公钥不是有效的 RSA PEM")
		}
	case model.PaymentVerifyCertificate:
		req.WechatPayPublicKeyID = ""
		req.WechatPayPublicKey = ""
	default:
		return nil, BadAuthRequest("请选择微信支付公钥或平台证书验签模式")
	}
	privateCipher, err := s.encryptSettingSecret(req.MerchantPrivateKey)
	if err != nil {
		return nil, err
	}
	apiV3Cipher, err := s.encryptSettingSecret(req.APIv3Key)
	if err != nil {
		return nil, err
	}
	fingerprintData := strings.Join([]string{req.AppID, req.MerchantID, req.MerchantCertSerial, req.MerchantPrivateKey, req.APIv3Key, req.VerifyMode, req.WechatPayPublicKeyID, req.WechatPayPublicKey}, "\x00")
	fingerprint := sha256.Sum256([]byte(fingerprintData))
	return &model.PaymentChannelVersion{
		ID: newID(), ChannelID: channelID, Version: versionNumber, AppID: req.AppID,
		MerchantID: req.MerchantID, MerchantCertSerial: req.MerchantCertSerial,
		MerchantPrivateKeyCipher: privateCipher, APIv3KeyCipher: apiV3Cipher,
		VerifyMode: req.VerifyMode, WechatPayPublicKeyID: req.WechatPayPublicKeyID,
		WechatPayPublicKey: req.WechatPayPublicKey, ConfigFingerprint: hex.EncodeToString(fingerprint[:]),
		Status: model.PaymentChannelVersionActive, CreatedBy: actorID, CreatedAt: time.Now(),
	}, nil
}

func paymentVersionView(version model.PaymentChannelVersion) PaymentChannelVersionView {
	return PaymentChannelVersionView{
		ID: version.ID, ChannelID: version.ChannelID, Version: version.Version,
		AppID: version.AppID, MerchantID: version.MerchantID, MerchantCertSerial: version.MerchantCertSerial,
		VerifyMode: version.VerifyMode, WechatPayPublicKeyID: version.WechatPayPublicKeyID,
		ConfigFingerprint: version.ConfigFingerprint, Status: version.Status,
		HasMerchantPrivateKey: version.MerchantPrivateKeyCipher != "", HasAPIv3Key: version.APIv3KeyCipher != "",
		HasWechatPayPublicKey: version.WechatPayPublicKey != "", CreatedBy: version.CreatedBy, CreatedAt: version.CreatedAt,
	}
}

func validatePaymentNotifyBaseURL(raw string) (string, error) {
	value := strings.TrimRight(strings.TrimSpace(raw), "/")
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", BadAuthRequest("通知基础地址必须是无查询参数的 HTTPS 地址")
	}
	return value, nil
}

func (s *Service) AdminRechargeProducts(actor *model.User) ([]model.CreditRechargeProduct, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.repo.RechargeProducts(true)
}

func (s *Service) SaveAdminRechargeProduct(actor *model.User, id string, req RechargeProductRequest) (*model.CreditRechargeProduct, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	req.SKU = strings.ToLower(strings.TrimSpace(req.SKU))
	req.Name = strings.TrimSpace(req.Name)
	if !paymentCodePattern.MatchString(req.SKU) {
		return nil, BadAuthRequest("套餐 SKU 只能包含字母、数字、中划线或下划线")
	}
	if req.Name == "" || req.AmountFen <= 0 || req.CreditsMicrocredits <= 0 {
		return nil, BadAuthRequest("套餐名称、支付金额和积分数量必须大于 0")
	}
	now := time.Now()
	creating := strings.TrimSpace(id) == ""
	var product *model.CreditRechargeProduct
	if creating {
		product = &model.CreditRechargeProduct{ID: newID(), CreatedBy: actor.ID, CreatedAt: now}
	} else {
		var err error
		product, err = s.repo.RechargeProduct(strings.TrimSpace(id), true)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("充值套餐不存在")
		}
		if err != nil {
			return nil, err
		}
	}
	product.SKU = req.SKU
	product.Name = truncateRunes(req.Name, 120)
	product.Description = truncateRunes(strings.TrimSpace(req.Description), 500)
	product.AmountFen = req.AmountFen
	product.CreditsMicrocredits = req.CreditsMicrocredits
	product.Enabled = req.Enabled
	product.SortOrder = req.SortOrder
	product.UpdatedBy = actor.ID
	product.UpdatedAt = now
	if creating {
		if err := s.repo.Create(product); err != nil {
			return nil, err
		}
	} else if err := s.repo.Save(product); err != nil {
		return nil, err
	}
	action := "recharge_product.update"
	summary := "更新充值套餐"
	if creating {
		action = "recharge_product.create"
		summary = "创建充值套餐"
	}
	if err := s.appendAdminAudit(actor, action, "recharge_product", product.ID, summary, map[string]any{"sku": product.SKU, "amountFen": product.AmountFen, "creditsMicrocredits": product.CreditsMicrocredits, "enabled": product.Enabled}); err != nil {
		return nil, err
	}
	return product, nil
}

func (s *Service) AdminPaymentOrderPage(actor *model.User, query AdminListQuery) (*AdminPaymentOrderPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	items, total, err := s.repo.AdminPaymentOrders(query.Status, query.Keyword, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &AdminPaymentOrderPage{Orders: items, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) AdminPaymentOrder(actor *model.User, id string) (*model.PaymentOrder, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	order, err := s.repo.PaymentOrder(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("支付订单不存在")
	}
	return order, err
}

func (s *Service) AdminSyncPaymentOrder(ctx context.Context, actor *model.User, id string) (*model.PaymentOrder, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	order, err := s.repo.PaymentOrder(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("支付订单不存在")
	}
	if err != nil {
		return nil, err
	}
	result, err := s.syncPaymentOrder(ctx, order, true)
	if err != nil {
		return nil, err
	}
	_ = s.appendAdminAudit(actor, "payment_order.query", "payment_order", order.ID, "主动查询微信支付订单", map[string]any{"outTradeNo": order.OutTradeNo, "status": result.Status})
	return result, nil
}

func (s *Service) AdminClosePaymentOrder(ctx context.Context, actor *model.User, id string) (*model.PaymentOrder, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	order, err := s.repo.PaymentOrder(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("支付订单不存在")
	}
	if err != nil {
		return nil, err
	}
	if order.Status == model.PaymentOrderSucceeded {
		return order, BadAuthRequest("已支付订单不能关闭")
	}
	if order.Status != model.PaymentOrderPending && order.Status != model.PaymentOrderClosing {
		return order, BadAuthRequest("当前订单不能关闭")
	}
	if err := s.closePaymentOrder(ctx, order); err != nil {
		return nil, err
	}
	result, err := s.repo.PaymentOrder(order.ID)
	if err != nil {
		return nil, err
	}
	_ = s.appendAdminAudit(actor, "payment_order.close", "payment_order", order.ID, "查询后关闭未支付订单", map[string]any{"outTradeNo": order.OutTradeNo, "status": result.Status})
	return result, nil
}
