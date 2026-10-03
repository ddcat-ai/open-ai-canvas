package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/payment"
	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/repository"
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
	PayType           string `json:"payType"`
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
	Name                string                  `json:"name"`
	Description         string                  `json:"description"`
	AmountFen           int64                   `json:"amountFen"`
	CreditsMicrocredits int64                   `json:"creditsMicrocredits"`
	Enabled             bool                    `json:"enabled"`
	SortOrder           int                     `json:"sortOrder"`
	SaleStrategy        model.TopupSaleStrategy `json:"saleStrategy"`
	PeriodDays          int                     `json:"periodDays"`
	PeriodPurchaseLimit int                     `json:"periodPurchaseLimit"`
	StockTotal          int64                   `json:"stockTotal"`
	SaleStartAt         *time.Time              `json:"saleStartAt"`
	SaleEndAt           *time.Time              `json:"saleEndAt"`
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
	Orders []AdminPaymentOrderView `json:"orders"`
	Total  int64                   `json:"total"`
	Page   int                     `json:"page"`
	Limit  int                     `json:"pageSize"`
}

type AdminPaymentOrderUser struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
}

type AdminPaymentOrderView struct {
	PaymentOrderView
	PayType string                 `json:"payType"`
	User    *AdminPaymentOrderUser `json:"user"`
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
	order, created, err := s.repo.CreatePaymentOrderWithProductReservation(order)
	if errors.Is(err, repository.ErrTopupUnavailable) {
		return nil, NewAppError(http.StatusConflict, "充值商品当前不可购买")
	}
	if errors.Is(err, repository.ErrPaymentIdempotencyConflict) {
		return nil, NewAppError(http.StatusConflict, "支付幂等标识已用于不同的商品或支付渠道")
	}
	if err != nil {
		return nil, err
	}
	if !created {
		if order.ProductID != productID || order.ProviderID != providerID {
			return nil, NewAppError(http.StatusConflict, "支付幂等标识已用于不同的商品或支付渠道")
		}
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
		MerchantOrderNo: order.MerchantOrderNo, Description: order.ProductName, AmountFen: order.AmountFen,
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

func (s *Service) AdminPaymentOrderPage(actor *model.User, query PaymentOrderQuery, page, limit int) (*AdminPaymentOrderPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit = normalizeAdminPage(page, limit)
	filter, err := query.filter()
	if err != nil {
		return nil, err
	}
	orders, total, err := s.repo.AdminPaymentOrders(filter, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	userIDs := make([]string, 0, len(orders))
	for _, order := range orders {
		userIDs = append(userIDs, order.UserID)
	}
	users, err := s.repo.UsersByIDs(userIDs)
	if err != nil {
		return nil, err
	}
	views := make([]AdminPaymentOrderView, 0, len(orders))
	for _, order := range orders {
		view := AdminPaymentOrderView{PaymentOrderView: paymentOrderView(order)}
		payType, err := s.paymentOrderPayType(order)
		if err != nil {
			return nil, err
		}
		view.PayType = payType
		if user, ok := users[order.UserID]; ok {
			view.User = &AdminPaymentOrderUser{ID: user.ID, Username: user.Username, DisplayName: user.DisplayName, Email: user.Email}
		}
		views = append(views, view)
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
