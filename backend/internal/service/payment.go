package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/payment"
	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const (
	maxActivePaymentOrdersPerUser = 5
	maxTopupCreditsMicrocredits   = int64(1_000_000_000) * CreditScale
)

type PaymentProviderView struct {
	ID                string `json:"id"`
	PluginID          string `json:"pluginId"`
	Name              string `json:"name"`
	Icon              string `json:"icon"`
	CheckoutMode      string `json:"checkoutMode"`
	Enabled           bool   `json:"enabled"`
	PluginEnabled     bool   `json:"pluginEnabled"`
	Configured        bool   `json:"configured"`
	CloseAfterMinutes int    `json:"closeAfterMinutes"`
}

type AdminPaymentProviderView struct {
	PaymentProviderView
	ConfigID         string                   `json:"configId,omitempty"`
	ConfigEnabled    bool                     `json:"configEnabled"`
	Version          int64                    `json:"version"`
	Values           map[string]string        `json:"values"`
	SecretConfigured map[string]bool          `json:"secretConfigured"`
	ConfigFields     []protocol.ManifestField `json:"configFields"`
	UpdatedAt        *time.Time               `json:"updatedAt,omitempty"`
}

type UpdatePaymentProviderConfigRequest struct {
	Enabled           bool              `json:"enabled"`
	CloseAfterMinutes int               `json:"closeAfterMinutes"`
	Values            map[string]string `json:"values"`
}

type TopupProductRequest struct {
	Name                string `json:"name"`
	Description         string `json:"description"`
	AmountFen           int64  `json:"amountFen"`
	CreditsMicrocredits int64  `json:"creditsMicrocredits"`
	Enabled             bool   `json:"enabled"`
	SortOrder           int    `json:"sortOrder"`
}

type CreatePaymentOrderRequest struct {
	ProductID      string `json:"productId"`
	ProviderID     string `json:"providerId"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type PaymentCheckoutView struct {
	Mode      string     `json:"mode"`
	Value     string     `json:"value,omitempty"`
	URL       string     `json:"url,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

type PaymentOrderView struct {
	ID                  string                   `json:"id"`
	UserID              string                   `json:"userId,omitempty"`
	MerchantOrderNo     string                   `json:"merchantOrderNo"`
	ProductID           string                   `json:"productId"`
	ProductName         string                   `json:"productName"`
	ProviderID          string                   `json:"providerId"`
	AmountFen           int64                    `json:"amountFen"`
	Currency            string                   `json:"currency"`
	CreditsMicrocredits int64                    `json:"creditsMicrocredits"`
	Status              model.PaymentOrderStatus `json:"status"`
	ProviderStatus      string                   `json:"providerStatus,omitempty"`
	ProviderTradeNo     string                   `json:"providerTradeNo,omitempty"`
	Checkout            PaymentCheckoutView      `json:"checkout"`
	ExpiresAt           time.Time                `json:"expiresAt"`
	ProviderPaidAt      *time.Time               `json:"providerPaidAt,omitempty"`
	CreditedAt          *time.Time               `json:"creditedAt,omitempty"`
	ClosedAt            *time.Time               `json:"closedAt,omitempty"`
	CreatedAt           time.Time                `json:"createdAt"`
	UpdatedAt           time.Time                `json:"updatedAt"`
}

type AdminPaymentOrderPage struct {
	Orders []PaymentOrderView `json:"orders"`
	Total  int64              `json:"total"`
	Page   int                `json:"page"`
	Limit  int                `json:"limit"`
}

func (s *Service) PaymentNotificationResponse(providerID string, success bool) (int, string, string) {
	return PaymentNotificationResponseForWithRegistry(s.paymentRegistry, providerID, success, http.StatusInternalServerError)
}

func (s *Service) PaymentNotificationFailureResponse(providerID string, status int) (int, string, string) {
	return PaymentNotificationResponseForWithRegistry(s.paymentRegistry, providerID, false, status)
}

func PaymentNotificationResponseFor(providerID string, success bool, failureStatus int) (int, string, string) {
	registry, _ := payment.NewRegistry()
	return PaymentNotificationResponseForWithRegistry(registry, providerID, success, failureStatus)
}

func PaymentNotificationResponseForWithRegistry(registry *payment.Registry, providerID string, success bool, failureStatus int) (int, string, string) {
	if registry != nil {
		if provider, ok := registry.Get(providerID); ok {
			descriptor := provider.Descriptor()
			response := descriptor.NotificationFailure
			if success {
				response = descriptor.NotificationSuccess
			}
			status := response.Status
			if status == 0 {
				status = failureStatus
			}
			contentType, body := response.ContentType, response.Body
			if contentType == "" {
				contentType = "text/plain; charset=utf-8"
			}
			return status, contentType, body
		}
	}
	if success {
		return http.StatusNoContent, "", ""
	}
	return failureStatus, "", ""
}

func (s *Service) PaymentProviders(actor *model.User) ([]PaymentProviderView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	items := make([]PaymentProviderView, 0)
	for _, descriptor := range s.paymentRegistry.Descriptors() {
		view, _, err := s.paymentProviderView(descriptor)
		if err != nil {
			return nil, err
		}
		if view.Enabled && view.Configured {
			items = append(items, view)
		}
	}
	return items, nil
}

func (s *Service) AdminPaymentProviders(actor *model.User) ([]AdminPaymentProviderView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	items := make([]AdminPaymentProviderView, 0)
	for _, descriptor := range s.paymentRegistry.Descriptors() {
		base, config, err := s.paymentProviderView(descriptor)
		if err != nil {
			return nil, err
		}
		manifest, _ := paymentManifestForProvider(descriptor.ID)
		view := AdminPaymentProviderView{PaymentProviderView: base, Values: map[string]string{}, SecretConfigured: map[string]bool{}, ConfigFields: manifest.Configuration.Fields}
		if config != nil {
			values, err := s.decryptPaymentConfig(config)
			if err != nil {
				return nil, err
			}
			view.ConfigID = config.ID
			view.ConfigEnabled = config.Enabled
			view.Version = config.Version
			view.UpdatedAt = &config.CreatedAt
			for _, field := range manifest.Configuration.Fields {
				if field.Secret {
					view.SecretConfigured[field.Name] = strings.TrimSpace(values[field.Name]) != ""
					continue
				}
				view.Values[field.Name] = values[field.Name]
			}
		}
		items = append(items, view)
	}
	return items, nil
}

func (s *Service) UpdatePaymentProviderConfig(actor *model.User, providerID string, request UpdatePaymentProviderConfigRequest) (*AdminPaymentProviderView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	provider, ok := s.paymentRegistry.Get(providerID)
	if !ok {
		return nil, BadAuthRequest("未知支付渠道")
	}
	descriptor := provider.Descriptor()
	manifest, ok := paymentManifestForProvider(descriptor.ID)
	if !ok {
		return nil, BadAuthRequest("支付插件清单不存在")
	}
	policy := manifest.Contributes.PaymentProviders[0].ExpiryPolicy
	if request.CloseAfterMinutes < policy.MinMinutes || request.CloseAfterMinutes > policy.MaxMinutes {
		return nil, BadAuthRequest(fmt.Sprintf("未支付关闭时间必须为 %d-%d 分钟", policy.MinMinutes, policy.MaxMinutes))
	}
	values := make(payment.Config)
	previousIdentity := make(map[string]string)
	current, err := s.repo.LatestPaymentProviderConfig(providerID)
	if err == nil {
		values, err = s.decryptPaymentConfig(current)
		if err != nil {
			return nil, err
		}
		for _, field := range descriptor.IdentityFields {
			previousIdentity[field] = strings.TrimSpace(values[field])
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	for _, field := range manifest.Configuration.Fields {
		value, supplied := request.Values[field.Name]
		value = strings.TrimSpace(value)
		if field.Secret && (!supplied || value == "") {
			continue
		}
		if !supplied && field.Default != nil && strings.TrimSpace(values[field.Name]) == "" {
			value = strings.TrimSpace(fmt.Sprint(field.Default))
		}
		values[field.Name] = value
	}
	changedIdentityField := ""
	for field, previous := range previousIdentity {
		if previous != "" && strings.TrimSpace(values[field]) != previous {
			changedIdentityField = field
			break
		}
	}
	if changedIdentityField != "" {
		orderCount, err := s.repo.PaymentOrderCountForProvider(providerID)
		if err != nil {
			return nil, err
		}
		if orderCount > 0 {
			return nil, BadAuthRequest("该渠道已有历史订单，首期不支持切换商户身份；请保持 " + changedIdentityField + " 不变")
		}
	}
	if base := values["publicBaseUrl"]; base != "" {
		if err := validatePaymentPublicBaseURL(base); err != nil {
			return nil, BadAuthRequest(err.Error())
		}
	}
	if request.Enabled {
		if strings.TrimSpace(values["publicBaseUrl"]) == "" {
			return nil, BadAuthRequest("启用支付渠道前必须填写服务器公网地址")
		}
		if err := provider.ValidateConfig(values); err != nil {
			return nil, BadAuthRequest(err.Error())
		}
	}
	plain, err := json.Marshal(values)
	if err != nil {
		return nil, err
	}
	ciphertext, err := s.encryptSettingSecret(string(plain))
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(plain)
	config := &model.PaymentProviderConfig{
		ID: newID(), ProviderID: descriptor.ID, PluginID: descriptor.PluginID, PluginVersion: descriptor.PluginVersion,
		Enabled: request.Enabled, CloseAfterMinutes: request.CloseAfterMinutes,
		ConfigCipher: ciphertext, ConfigDigest: hex.EncodeToString(digest[:]), CreatedBy: actor.ID,
	}
	if err := s.repo.CreatePaymentProviderConfig(config); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "payment_provider.config.update", "payment_provider", providerID, "更新支付渠道配置", map[string]any{
		"version": config.Version, "enabled": config.Enabled, "closeAfterMinutes": config.CloseAfterMinutes,
	}); err != nil {
		return nil, err
	}
	items, err := s.AdminPaymentProviders(actor)
	if err != nil {
		return nil, err
	}
	for index := range items {
		if items[index].ID == providerID {
			return &items[index], nil
		}
	}
	return nil, errors.New("保存支付渠道配置后未找到渠道")
}

func (s *Service) paymentProviderView(descriptor payment.Descriptor) (PaymentProviderView, *model.PaymentProviderConfig, error) {
	view := PaymentProviderView{ID: descriptor.ID, PluginID: descriptor.PluginID, Name: descriptor.Name, Icon: descriptor.Icon, CheckoutMode: descriptor.CheckoutMode}
	if manifest, ok := paymentManifestForProvider(descriptor.ID); ok && len(manifest.Contributes.PaymentProviders) > 0 {
		view.CloseAfterMinutes = manifest.Contributes.PaymentProviders[0].ExpiryPolicy.DefaultMinutes
	}
	state, err := s.pluginStateForUser(nil, descriptor.PluginID, s.Plugins())
	if err == nil {
		view.PluginEnabled = state.PlatformAvailable
		view.Enabled = state.PlatformAvailable
	}
	config, configErr := s.repo.LatestPaymentProviderConfig(descriptor.ID)
	if errors.Is(configErr, gorm.ErrRecordNotFound) {
		return view, nil, nil
	}
	if configErr != nil {
		return view, nil, configErr
	}
	view.Configured = strings.TrimSpace(config.ConfigCipher) != ""
	view.Enabled = view.Enabled && config.Enabled
	view.CloseAfterMinutes = config.CloseAfterMinutes
	return view, config, nil
}

func paymentManifestForProvider(providerID string) (protocol.Manifest, bool) {
	for _, manifest := range bundledPaymentPluginManifests() {
		for _, contribution := range manifest.Contributes.PaymentProviders {
			if contribution.ID == providerID {
				return manifest, true
			}
		}
	}
	return protocol.Manifest{}, false
}

func (s *Service) decryptPaymentConfig(config *model.PaymentProviderConfig) (payment.Config, error) {
	if config == nil {
		return nil, errors.New("支付渠道配置不存在")
	}
	plain, err := s.decryptSettingSecret(config.ConfigCipher)
	if err != nil {
		return nil, err
	}
	values := make(payment.Config)
	if err := json.Unmarshal([]byte(plain), &values); err != nil {
		return nil, errors.New("支付渠道配置内容无效")
	}
	return values, nil
}

func validatePaymentPublicBaseURL(value string) error {
	parsed, err := url.Parse(strings.TrimRight(strings.TrimSpace(value), "/"))
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil || parsed.Fragment != "" || parsed.RawQuery != "" || (parsed.Path != "" && parsed.Path != "/") {
		return errors.New("服务器公网地址必须是有效的 HTTP(S) 根地址")
	}
	return nil
}

func (s *Service) TopupProducts(actor *model.User) ([]model.TopupProduct, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	return s.repo.TopupProducts(false)
}

func (s *Service) AdminTopupProducts(actor *model.User) ([]model.TopupProduct, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.repo.TopupProducts(true)
}

func (s *Service) CreateTopupProduct(actor *model.User, request TopupProductRequest) (*model.TopupProduct, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	product, err := topupProductFromRequest(newID(), actor.ID, request)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateTopupProduct(product); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "topup_product.create", "topup_product", product.ID, "创建积分充值商品", map[string]any{"amountFen": product.AmountFen, "creditsMicrocredits": product.CreditsMicrocredits}); err != nil {
		return nil, err
	}
	return product, nil
}

func (s *Service) UpdateTopupProduct(actor *model.User, id string, request TopupProductRequest) (*model.TopupProduct, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if _, err := s.repo.TopupProduct(id); err != nil {
		return nil, err
	}
	product, err := topupProductFromRequest(strings.TrimSpace(id), actor.ID, request)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateTopupProduct(product); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "topup_product.update", "topup_product", product.ID, "更新积分充值商品", map[string]any{"enabled": product.Enabled}); err != nil {
		return nil, err
	}
	return s.repo.TopupProduct(product.ID)
}

func topupProductFromRequest(id, actorID string, request TopupProductRequest) (*model.TopupProduct, error) {
	name := strings.TrimSpace(request.Name)
	if name == "" || len([]rune(name)) > 120 {
		return nil, BadAuthRequest("充值商品名称不能为空且不能超过 120 个字符")
	}
	if request.AmountFen <= 0 || request.AmountFen > 100_000_000 {
		return nil, BadAuthRequest("充值金额必须为 1 分至 100 万元")
	}
	if request.CreditsMicrocredits <= 0 || request.CreditsMicrocredits > maxTopupCreditsMicrocredits {
		return nil, BadAuthRequest("充值积分必须为 0.000001 至 10 亿积分")
	}
	return &model.TopupProduct{
		ID: id, Name: name, Description: truncateRunes(strings.TrimSpace(request.Description), 500),
		AmountFen: request.AmountFen, CreditsMicrocredits: request.CreditsMicrocredits,
		Enabled: request.Enabled, SortOrder: request.SortOrder, CreatedBy: actorID, UpdatedBy: actorID,
	}, nil
}

func (s *Service) CreatePaymentOrder(ctx context.Context, actor *model.User, request CreatePaymentOrderRequest) (*PaymentOrderView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	idempotencyKey := strings.TrimSpace(request.IdempotencyKey)
	if idempotencyKey == "" {
		return nil, BadAuthRequest("支付幂等标识不能为空")
	}
	if len(idempotencyKey) > 120 {
		return nil, BadAuthRequest("支付幂等标识过长")
	}
	productID := strings.TrimSpace(request.ProductID)
	providerID := strings.TrimSpace(request.ProviderID)
	if existing, err := s.repo.PaymentOrderByIdempotency(actor.ID, idempotencyKey); err == nil {
		if existing.ProductID != productID || existing.ProviderID != providerID {
			return nil, NewAppError(http.StatusConflict, "支付幂等标识已用于不同的商品或支付渠道")
		}
		result := paymentOrderView(*existing)
		return &result, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	product, err := s.repo.TopupProduct(productID)
	if err != nil || !product.Enabled {
		return nil, BadAuthRequest("充值商品不存在或已停用")
	}
	provider, ok := s.paymentRegistry.Get(providerID)
	if !ok {
		return nil, BadAuthRequest("未知支付渠道")
	}
	view, config, err := s.paymentProviderView(provider.Descriptor())
	if err != nil {
		return nil, err
	}
	if !view.Enabled || !view.Configured || config == nil {
		return nil, Forbidden("支付渠道未启用或尚未配置")
	}
	activeCount, err := s.repo.ActivePaymentOrderCount(actor.ID)
	if err != nil {
		return nil, err
	}
	if activeCount >= maxActivePaymentOrdersPerUser {
		return nil, NewAppError(http.StatusConflict, "未支付订单过多，请先完成或关闭已有订单")
	}
	now := time.Now()
	order := &model.PaymentOrder{
		ID: newID(), UserID: actor.ID, IdempotencyKey: idempotencyKey, MerchantOrderNo: newID(),
		ProductID: product.ID, ProductName: product.Name, ProviderID: provider.Descriptor().ID,
		PluginID: provider.Descriptor().PluginID, PluginVersion: provider.Descriptor().PluginVersion, ProviderConfigID: config.ID, ProviderConfigVersion: config.Version,
		AmountFen: product.AmountFen, Currency: "CNY", CreditsMicrocredits: product.CreditsMicrocredits,
		Status: model.PaymentOrderCreated, CheckoutMode: provider.Descriptor().CheckoutMode,
		ExpiresAt: now.Add(time.Duration(config.CloseAfterMinutes) * time.Minute),
	}
	order, created, err := s.repo.CreatePaymentOrder(order)
	if err != nil {
		return nil, err
	}
	if !created {
		view := paymentOrderView(*order)
		return &view, nil
	}
	values, err := s.decryptPaymentConfig(config)
	if err != nil {
		_ = s.repo.SetPaymentOrderCreateFailure(order.ID, safePaymentError(err))
		return nil, err
	}
	baseURL := strings.TrimRight(values["publicBaseUrl"], "/")
	checkout, err := provider.CreateOrder(ctx, values, payment.CreateRequest{
		MerchantOrderNo: order.MerchantOrderNo, Description: product.Name, AmountFen: order.AmountFen,
		Currency: order.Currency, ExpiresAt: order.ExpiresAt,
		NotifyURL: baseURL + "/api/payments/notify/" + url.PathEscape(order.ProviderID) + "/" + url.PathEscape(config.ID),
		ReturnURL: baseURL + "/api/payments/return/" + url.PathEscape(order.ProviderID) + "?orderId=" + url.QueryEscape(order.ID),
	})
	if err != nil {
		_ = s.repo.SetPaymentOrderCreateFailure(order.ID, safePaymentError(err))
		return nil, WrapAppError(http.StatusBadGateway, "支付渠道下单失败，请稍后重试", err)
	}
	if err := s.repo.SetPaymentOrderCheckout(order.ID, checkout.Mode, checkout.Value, checkout.ExpiresAt); err != nil {
		_ = s.repo.SetPaymentOrderCreateFailure(order.ID, safePaymentError(err))
		return nil, err
	}
	order, err = s.repo.PaymentOrder(order.ID)
	if err != nil {
		return nil, err
	}
	result := paymentOrderView(*order)
	return &result, nil
}

func (s *Service) PaymentOrder(actor *model.User, id string) (*PaymentOrderView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	order, err := s.repo.PaymentOrderForUser(actor.ID, id)
	if err != nil {
		return nil, err
	}
	view := paymentOrderView(*order)
	return &view, nil
}

func (s *Service) PaymentCheckout(actor *model.User, id string) (string, error) {
	if actor == nil {
		return "", Unauthorized("请先登录")
	}
	order, err := s.repo.PaymentOrderForUser(actor.ID, id)
	if err != nil {
		return "", err
	}
	if order.Status != model.PaymentOrderPending || order.CheckoutMode != "redirect" || strings.TrimSpace(order.CheckoutValue) == "" || !order.ExpiresAt.After(time.Now()) {
		return "", BadAuthRequest("支付订单当前不能跳转收银台")
	}
	return order.CheckoutValue, nil
}

// RefreshPaymentCheckout reuses the original merchant order number and order
// snapshot. It always queries the provider before rebuilding a checkout so an
// ambiguous create response cannot turn into a duplicate payment attempt.
func (s *Service) RefreshPaymentCheckout(ctx context.Context, actor *model.User, id string) (*PaymentOrderView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	order, err := s.repo.PaymentOrderForUser(actor.ID, id)
	if err != nil {
		return nil, err
	}
	if (order.CheckoutMode != "qr_code" && order.CheckoutMode != "redirect") || (order.Status != model.PaymentOrderPending && order.Status != model.PaymentOrderCreateFailed) || !order.ExpiresAt.After(time.Now()) {
		return nil, BadAuthRequest("支付订单当前不能刷新收银台")
	}
	provider, config, values, err := s.paymentRuntimeForOrder(order)
	if err != nil {
		return nil, err
	}
	providerResult, queryErr := provider.QueryOrder(ctx, values, payment.QueryRequest{MerchantOrderNo: order.MerchantOrderNo})
	if queryErr == nil {
		if strings.TrimSpace(providerResult.MerchantOrderNo) != order.MerchantOrderNo {
			return nil, repository.ErrPaymentEvidenceMismatch
		}
		_ = s.repo.RecordPaymentQuery(order.ID, providerResult.ProviderStatus)
		updated, applyErr := s.applyPaymentResult(order.ProviderID, providerResult)
		if applyErr != nil {
			return nil, applyErr
		}
		if providerResult.Paid || providerResult.Closed {
			view := paymentOrderView(*updated)
			return &view, nil
		}
	} else if !errors.Is(queryErr, payment.ErrOrderNotFound) {
		return nil, WrapAppError(http.StatusBadGateway, "刷新支付收银台前查单失败，请稍后重试", queryErr)
	}
	baseURL := strings.TrimRight(values["publicBaseUrl"], "/")
	checkout, err := provider.CreateOrder(ctx, values, payment.CreateRequest{
		MerchantOrderNo: order.MerchantOrderNo, Description: order.ProductName, AmountFen: order.AmountFen,
		Currency: order.Currency, ExpiresAt: order.ExpiresAt,
		NotifyURL: baseURL + "/api/payments/notify/" + url.PathEscape(order.ProviderID) + "/" + url.PathEscape(config.ID),
		ReturnURL: baseURL + "/api/payments/return/" + url.PathEscape(order.ProviderID) + "?orderId=" + url.QueryEscape(order.ID),
	})
	if err != nil {
		return nil, WrapAppError(http.StatusBadGateway, "刷新支付收银台失败，请稍后重试", err)
	}
	if err := s.repo.SetPaymentOrderCheckout(order.ID, checkout.Mode, checkout.Value, checkout.ExpiresAt); err != nil {
		return nil, err
	}
	order, err = s.repo.PaymentOrder(order.ID)
	if err != nil {
		return nil, err
	}
	view := paymentOrderView(*order)
	return &view, nil
}

func (s *Service) QueryPaymentOrder(ctx context.Context, actor *model.User, id string) (*PaymentOrderView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	order, err := s.repo.PaymentOrderForUser(actor.ID, id)
	if err != nil {
		return nil, err
	}
	if order.Status == model.PaymentOrderCredited || order.Status == model.PaymentOrderClosed {
		view := paymentOrderView(*order)
		return &view, nil
	}
	if order.LastQueriedAt != nil && time.Since(*order.LastQueriedAt) < 2*time.Second {
		view := paymentOrderView(*order)
		return &view, nil
	}
	if err := s.queryPaymentOrder(ctx, order); err != nil {
		return nil, err
	}
	order, err = s.repo.PaymentOrder(order.ID)
	if err != nil {
		return nil, err
	}
	view := paymentOrderView(*order)
	return &view, nil
}

func (s *Service) ClosePaymentOrder(ctx context.Context, actor *model.User, id string) (*PaymentOrderView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	order, err := s.repo.PaymentOrderForUser(actor.ID, id)
	if err != nil {
		return nil, err
	}
	if order.Status == model.PaymentOrderCredited || order.Status == model.PaymentOrderClosed {
		view := paymentOrderView(*order)
		return &view, nil
	}
	if err := s.closePaymentOrder(ctx, order); err != nil {
		return nil, err
	}
	order, err = s.repo.PaymentOrder(order.ID)
	if err != nil {
		return nil, err
	}
	view := paymentOrderView(*order)
	return &view, nil
}

func (s *Service) AcceptPaymentNotification(ctx context.Context, providerID, configID string, headers http.Header, rawBody []byte) error {
	provider, ok := s.paymentRegistry.Get(providerID)
	if !ok {
		return BadAuthRequest("未知支付通知渠道")
	}
	config, err := s.repo.PaymentProviderConfig(configID)
	if err != nil || config.ProviderID != providerID {
		return BadAuthRequest("支付通知配置版本不存在")
	}
	values, err := s.decryptPaymentConfig(config)
	if err != nil {
		return err
	}
	notification, err := provider.VerifyNotification(ctx, values, headers, rawBody)
	if err != nil {
		return BadAuthRequest("支付通知验签失败")
	}
	order, err := s.repo.PaymentOrderByMerchant(providerID, notification.MerchantOrderNo)
	if err != nil || order.ProviderConfigID != config.ID {
		return BadAuthRequest("支付通知订单不存在或配置版本不匹配")
	}
	normalized, err := json.Marshal(notification.Result)
	if err != nil {
		return err
	}
	payloadCipher, err := s.encryptSettingSecret(string(rawBody))
	if err != nil {
		return err
	}
	digest := sha256.Sum256(rawBody)
	inbox := &model.PaymentNotification{
		ID: newID(), ProviderID: providerID, ProviderEventID: truncateRunes(notification.EventID, 160),
		ProviderConfigID: config.ID, MerchantOrderNo: order.MerchantOrderNo, PaymentOrderID: order.ID,
		PayloadDigest: hex.EncodeToString(digest[:]), PayloadCipher: payloadCipher, NormalizedJSON: string(normalized),
		Status: model.PaymentNotificationPending, NextAttemptAt: time.Now(),
	}
	created, err := s.repo.SaveVerifiedPaymentNotification(inbox)
	if err != nil || !created {
		return err
	}
	// Keep the callback path fast but try once immediately. A durable inbox row
	// remains for the worker if the credit transaction cannot complete now.
	if err := s.processPaymentNotification(inbox); err != nil {
		_ = s.repo.RetryPaymentNotification(inbox.ID, safePaymentError(err), time.Now().Add(5*time.Second))
	}
	return nil
}

func (s *Service) processPaymentNotification(notification *model.PaymentNotification) error {
	var result payment.Result
	if err := json.Unmarshal([]byte(notification.NormalizedJSON), &result); err != nil {
		return err
	}
	if !result.Paid {
		return errors.New("支付通知不是成功状态")
	}
	if _, err := s.applyPaymentResult(notification.ProviderID, result); err != nil {
		return err
	}
	return s.repo.CompletePaymentNotification(notification.ID)
}

func (s *Service) queryPaymentOrder(ctx context.Context, order *model.PaymentOrder) error {
	provider, config, values, err := s.paymentRuntimeForOrder(order)
	if err != nil {
		return err
	}
	_ = config
	result, err := provider.QueryOrder(ctx, values, payment.QueryRequest{MerchantOrderNo: order.MerchantOrderNo})
	if errors.Is(err, payment.ErrOrderNotFound) {
		_ = s.repo.RecordPaymentQuery(order.ID, "NOT_FOUND")
		return nil
	}
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "支付渠道查单失败，请稍后重试", err)
	}
	if strings.TrimSpace(result.MerchantOrderNo) != order.MerchantOrderNo {
		return repository.ErrPaymentEvidenceMismatch
	}
	_ = s.repo.RecordPaymentQuery(order.ID, result.ProviderStatus)
	_, err = s.applyPaymentResult(order.ProviderID, result)
	return err
}

func (s *Service) closePaymentOrder(ctx context.Context, order *model.PaymentOrder) error {
	provider, _, values, err := s.paymentRuntimeForOrder(order)
	if err != nil {
		return err
	}
	queryNotFound := false
	result, queryErr := provider.QueryOrder(ctx, values, payment.QueryRequest{MerchantOrderNo: order.MerchantOrderNo})
	if queryErr == nil {
		if strings.TrimSpace(result.MerchantOrderNo) != order.MerchantOrderNo {
			return repository.ErrPaymentEvidenceMismatch
		}
		_ = s.repo.RecordPaymentQuery(order.ID, result.ProviderStatus)
		if _, err := s.applyPaymentResult(order.ProviderID, result); err != nil {
			return err
		}
		if result.Paid || result.Closed {
			return nil
		}
	} else if errors.Is(queryErr, payment.ErrOrderNotFound) {
		queryNotFound = true
	} else {
		return WrapAppError(http.StatusBadGateway, "关单前查单失败，请稍后重试", queryErr)
	}
	closed, err := provider.CloseOrder(ctx, values, payment.CloseRequest{MerchantOrderNo: order.MerchantOrderNo})
	if err == nil {
		if closed.MerchantOrderNo == "" {
			closed.MerchantOrderNo = order.MerchantOrderNo
		}
		if strings.TrimSpace(closed.MerchantOrderNo) != order.MerchantOrderNo {
			return repository.ErrPaymentEvidenceMismatch
		}
		if closed.Paid || closed.Closed {
			_, applyErr := s.applyPaymentResult(order.ProviderID, closed)
			return applyErr
		}
		return s.repo.MarkPaymentOrderClosed(order.ID, closed.ProviderStatus)
	}

	// A payment can complete after the first query and immediately before the
	// close request. Query once more on every close failure so a successful
	// payment is credited instead of being left in a closing retry loop.
	recheck, recheckErr := provider.QueryOrder(ctx, values, payment.QueryRequest{MerchantOrderNo: order.MerchantOrderNo})
	if recheckErr == nil {
		if strings.TrimSpace(recheck.MerchantOrderNo) != order.MerchantOrderNo {
			return repository.ErrPaymentEvidenceMismatch
		}
		_ = s.repo.RecordPaymentQuery(order.ID, recheck.ProviderStatus)
		if _, applyErr := s.applyPaymentResult(order.ProviderID, recheck); applyErr != nil {
			return applyErr
		}
		if recheck.Paid || recheck.Closed {
			return nil
		}
	}
	if queryNotFound && errors.Is(err, payment.ErrOrderNotFound) && errors.Is(recheckErr, payment.ErrOrderNotFound) {
		return s.repo.MarkPaymentOrderClosed(order.ID, "NOT_FOUND")
	}
	return WrapAppError(http.StatusBadGateway, "支付渠道关单失败，请稍后重试", err)
}

func (s *Service) applyPaymentResult(providerID string, result payment.Result) (*model.PaymentOrder, error) {
	order, err := s.repo.PaymentOrderByMerchant(providerID, result.MerchantOrderNo)
	if err != nil {
		return nil, err
	}
	if result.Paid {
		if result.AmountFen != order.AmountFen || result.Currency != order.Currency {
			return nil, repository.ErrPaymentEvidenceMismatch
		}
		completed, _, err := s.repo.CompletePaymentOrder(providerID, result.MerchantOrderNo, repository.PaymentEvidence{
			ProviderTradeNo: result.ProviderTradeNo, ProviderStatus: result.ProviderStatus,
			AmountFen: result.AmountFen, Currency: result.Currency, PaidAt: result.PaidAt,
		})
		return completed, err
	}
	if result.Closed {
		if err := s.repo.MarkPaymentOrderClosed(order.ID, result.ProviderStatus); err != nil {
			return nil, err
		}
		return s.repo.PaymentOrder(order.ID)
	}
	return order, nil
}

func (s *Service) paymentRuntimeForOrder(order *model.PaymentOrder) (payment.Provider, *model.PaymentProviderConfig, payment.Config, error) {
	if order == nil {
		return nil, nil, nil, errors.New("支付订单不存在")
	}
	provider, ok := s.paymentRegistry.Get(order.ProviderID)
	if !ok {
		return nil, nil, nil, errors.New("支付宿主适配器不存在")
	}
	config, err := s.repo.PaymentProviderConfig(order.ProviderConfigID)
	if err != nil {
		return nil, nil, nil, err
	}
	if config.ProviderID != order.ProviderID || config.PluginID != order.PluginID || (config.PluginVersion != "" && order.PluginVersion != "" && config.PluginVersion != order.PluginVersion) || config.Version != order.ProviderConfigVersion {
		return nil, nil, nil, repository.ErrPaymentOrderStateConflict
	}
	values, err := s.decryptPaymentConfig(config)
	return provider, config, values, err
}

func paymentOrderView(order model.PaymentOrder) PaymentOrderView {
	providerTradeNo := ""
	if order.ProviderTradeNo != nil {
		providerTradeNo = *order.ProviderTradeNo
	}
	checkout := PaymentCheckoutView{Mode: order.CheckoutMode, ExpiresAt: order.CheckoutExpiresAt}
	if order.Status == model.PaymentOrderPending && order.ExpiresAt.After(time.Now()) {
		if order.CheckoutMode == "qr_code" {
			checkout.Value = order.CheckoutValue
		} else if order.CheckoutMode == "redirect" {
			checkout.URL = "/api/payments/orders/" + url.PathEscape(order.ID) + "/checkout"
		}
	}
	return PaymentOrderView{
		ID: order.ID, UserID: order.UserID, MerchantOrderNo: order.MerchantOrderNo, ProductID: order.ProductID, ProductName: order.ProductName,
		ProviderID: order.ProviderID, AmountFen: order.AmountFen, Currency: order.Currency,
		CreditsMicrocredits: order.CreditsMicrocredits, Status: order.Status, ProviderStatus: order.ProviderStatus,
		ProviderTradeNo: providerTradeNo, Checkout: checkout, ExpiresAt: order.ExpiresAt,
		ProviderPaidAt: order.ProviderPaidAt, CreditedAt: order.CreditedAt, ClosedAt: order.ClosedAt,
		CreatedAt: order.CreatedAt, UpdatedAt: order.UpdatedAt,
	}
}

func (s *Service) AdminPaymentOrderPage(actor *model.User, status, keyword string, page, limit int) (*AdminPaymentOrderPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit = normalizeAdminPage(page, limit)
	orders, total, err := s.repo.AdminPaymentOrders(status, keyword, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	views := make([]PaymentOrderView, 0, len(orders))
	for _, order := range orders {
		views = append(views, paymentOrderView(order))
	}
	return &AdminPaymentOrderPage{Orders: views, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) AdminQueryPaymentOrder(ctx context.Context, actor *model.User, id string) (*PaymentOrderView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	order, err := s.repo.PaymentOrder(id)
	if err != nil {
		return nil, err
	}
	if order.Status == model.PaymentOrderCredited || order.Status == model.PaymentOrderClosed {
		view := paymentOrderView(*order)
		return &view, nil
	}
	if err := s.queryPaymentOrder(ctx, order); err != nil {
		return nil, err
	}
	order, err = s.repo.PaymentOrder(id)
	if err != nil {
		return nil, err
	}
	view := paymentOrderView(*order)
	return &view, nil
}

func (s *Service) AdminClosePaymentOrder(ctx context.Context, actor *model.User, id string) (*PaymentOrderView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	order, err := s.repo.PaymentOrder(id)
	if err != nil {
		return nil, err
	}
	if order.Status == model.PaymentOrderCredited || order.Status == model.PaymentOrderClosed {
		view := paymentOrderView(*order)
		return &view, nil
	}
	if err := s.closePaymentOrder(ctx, order); err != nil {
		return nil, err
	}
	order, err = s.repo.PaymentOrder(id)
	if err != nil {
		return nil, err
	}
	view := paymentOrderView(*order)
	return &view, nil
}

func (s *Service) startPaymentWorker(ctx context.Context) {
	s.runWorkerLoop(func(ctx context.Context) {
		s.drainPaymentNotifications()
		notificationTicker := time.NewTicker(15 * time.Second)
		defer notificationTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-notificationTicker.C:
				s.drainPaymentNotifications()
			}
		}
	})
	s.runWorkerLoop(func(ctx context.Context) {
		s.reconcileExpiredPaymentOrders(ctx)
		orderTicker := time.NewTicker(15 * time.Second)
		defer orderTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-orderTicker.C:
				s.reconcileExpiredPaymentOrders(ctx)
				s.queryPendingPaymentOrders(ctx)
			}
		}
	})
	s.runWorkerLoop(func(ctx context.Context) {
		s.maybeRunDailyPaymentReconciliation(ctx)
		reconciliationTicker := time.NewTicker(30 * time.Minute)
		defer reconciliationTicker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-reconciliationTicker.C:
				s.maybeRunDailyPaymentReconciliation(ctx)
			}
		}
	})
}

func (s *Service) drainPaymentNotifications() {
	items, err := s.repo.PendingPaymentNotifications(32)
	if err != nil {
		log.Printf("payment notification query failed: %v", err)
		return
	}
	for index := range items {
		item := &items[index]
		if err := s.processPaymentNotification(item); err != nil {
			delay := time.Duration(math.Pow(2, math.Min(float64(item.Attempts), 8))) * 5 * time.Second
			_ = s.repo.RetryPaymentNotification(item.ID, safePaymentError(err), time.Now().Add(delay))
		}
	}
}

func (s *Service) reconcileExpiredPaymentOrders(ctx context.Context) {
	orders, err := s.repo.ClaimExpiredPaymentOrders(32)
	if err != nil {
		log.Printf("expired payment order claim failed: %v", err)
		return
	}
	for index := range orders {
		order := &orders[index]
		operationContext, cancel := context.WithTimeout(ctx, 45*time.Second)
		err := s.closePaymentOrder(operationContext, order)
		cancel()
		if err != nil {
			_ = s.repo.RestoreClosingPaymentOrder(order.ID, safePaymentError(err))
		}
	}
}

func (s *Service) queryPendingPaymentOrders(ctx context.Context) {
	orders, err := s.repo.PaymentOrdersNeedingQuery(time.Now().Add(-30*time.Second), 32)
	if err != nil {
		log.Printf("pending payment order query failed: %v", err)
		return
	}
	for index := range orders {
		operationContext, cancel := context.WithTimeout(ctx, 20*time.Second)
		err := s.queryPaymentOrder(operationContext, &orders[index])
		cancel()
		if err != nil {
			log.Printf("payment order compensation query failed: order=%s error_type=%T", orders[index].ID, err)
		}
	}
}

func safePaymentError(err error) string {
	if err == nil {
		return ""
	}
	var providerErr *payment.ProviderError
	if errors.As(err, &providerErr) && providerErr.Code != "" {
		return truncateRunes(providerErr.Code, 1000)
	}
	return truncateRunes(fmt.Sprintf("%T", err), 1000)
}
