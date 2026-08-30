package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"github.com/wechatpay-apiv3/wechatpay-go/core"
	"gorm.io/gorm"
)

const (
	paymentWorkerInterval = time.Second
	paymentQueryCooldown  = 5 * time.Second
)

type PublicRechargeProduct struct {
	ID                  string `json:"id"`
	SKU                 string `json:"sku"`
	Name                string `json:"name"`
	Description         string `json:"description,omitempty"`
	AmountFen           int64  `json:"amountFen"`
	CreditsMicrocredits int64  `json:"creditsMicrocredits"`
	SortOrder           int    `json:"sortOrder"`
}

type PublicPaymentChannel struct {
	ID            string `json:"id"`
	Code          string `json:"code"`
	Name          string `json:"name"`
	Provider      string `json:"provider"`
	PaymentMethod string `json:"paymentMethod"`
	IsDefault     bool   `json:"isDefault"`
}

type RechargeOrderPage struct {
	Orders     []model.PaymentOrder `json:"orders"`
	Total      int64                `json:"total"`
	Page       int                  `json:"page"`
	Limit      int                  `json:"limit"`
	ServerTime time.Time            `json:"serverTime"`
}

func (s *Service) RechargeProducts() ([]PublicRechargeProduct, error) {
	items, err := s.repo.ActiveRechargeProducts()
	if err != nil {
		return nil, err
	}
	result := make([]PublicRechargeProduct, 0, len(items))
	for _, item := range items {
		result = append(result, publicRechargeProduct(item))
	}
	return result, nil
}

func publicRechargeProduct(item model.CreditRechargeProduct) PublicRechargeProduct {
	return PublicRechargeProduct{
		ID: item.ID, SKU: item.SKU, Name: item.Name, Description: item.Description,
		AmountFen: item.AmountFen, CreditsMicrocredits: item.CreditsMicrocredits, SortOrder: item.SortOrder,
	}
}

func (s *Service) RechargePaymentChannels() ([]PublicPaymentChannel, error) {
	items, err := s.repo.ActivePaymentChannels()
	if err != nil {
		return nil, err
	}
	result := make([]PublicPaymentChannel, 0, len(items))
	for _, item := range items {
		if !supportedPaymentChannel(item) {
			continue
		}
		result = append(result, PublicPaymentChannel{
			ID: item.ID, Code: item.Code, Name: item.Name, Provider: item.Provider,
			PaymentMethod: item.PaymentMethod, IsDefault: item.IsDefault,
		})
	}
	return result, nil
}

func (s *Service) CreateRechargeOrder(ctx context.Context, user *model.User, productID string, channelID string, idempotencyKey string) (*model.PaymentOrder, error) {
	if user == nil || strings.TrimSpace(user.ID) == "" {
		return nil, Unauthorized("请先登录")
	}
	idempotencyKey = strings.TrimSpace(idempotencyKey)
	if idempotencyKey == "" || len(idempotencyKey) > 160 {
		return nil, BadAuthRequest("缺少有效的幂等键")
	}
	product, err := s.repo.RechargeProduct(strings.TrimSpace(productID), false)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("充值套餐不存在或已下架")
	}
	if err != nil {
		return nil, err
	}
	channelID = strings.TrimSpace(channelID)
	var channel *model.PaymentChannel
	if channelID == "" {
		channel, err = s.repo.ActivePaymentChannel()
	} else {
		channel, err = s.repo.ActivePaymentChannelByID(channelID)
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NewAppError(http.StatusServiceUnavailable, "支付渠道不存在、已停用或配置不可用")
	}
	if err != nil {
		return nil, err
	}
	if !supportedPaymentChannel(*channel) {
		return nil, NewAppError(http.StatusServiceUnavailable, "暂不支持该支付渠道")
	}
	version, err := s.repo.PaymentChannelVersion(channel.ActiveVersionID)
	if err != nil {
		return nil, err
	}
	if version.ChannelID != channel.ID || version.Status != model.PaymentChannelVersionActive {
		return nil, NewAppError(http.StatusServiceUnavailable, "支付渠道配置不可用")
	}

	now := time.Now()
	expireMinutes := normalizePaymentExpiry(channel.OrderExpireMinutes)
	order := &model.PaymentOrder{
		ID: newID(), OutTradeNo: newPaymentOutTradeNo(now), UserID: user.ID, IdempotencyKey: idempotencyKey,
		ChannelID: channel.ID, ChannelVersionID: version.ID, ProductID: product.ID,
		ProductNameSnapshot: product.Name, AmountFen: product.AmountFen, CreditsMicrocredits: product.CreditsMicrocredits,
		Currency: "CNY", ExpireMinutesSnapshot: expireMinutes, ExpiresAt: now.Add(time.Duration(expireMinutes) * time.Minute),
		Status: model.PaymentOrderCreated, CreatedAt: now, UpdatedAt: now,
	}
	order, created, err := s.repo.CreateOrGetPaymentOrder(order)
	if err != nil {
		return nil, err
	}
	if !created && (order.ProductID != product.ID || order.ChannelID != channel.ID) {
		return nil, &AppError{Status: http.StatusConflict, Message: "该幂等键已用于其他充值套餐或支付渠道"}
	}
	if !created && order.Status != model.PaymentOrderCreated {
		return order, nil
	}
	return s.createPaymentPrepay(ctx, order, channel, version)
}

func supportedPaymentChannel(channel model.PaymentChannel) bool {
	return channel.Provider == model.PaymentProviderWechatPay && channel.PaymentMethod == model.PaymentMethodNative
}

func (s *Service) createPaymentPrepay(ctx context.Context, order *model.PaymentOrder, channel *model.PaymentChannel, version *model.PaymentChannelVersion) (*model.PaymentOrder, error) {
	switch {
	case channel.Provider == model.PaymentProviderWechatPay && channel.PaymentMethod == model.PaymentMethodNative:
		return s.createWechatPrepay(ctx, order, channel, version)
	default:
		return nil, NewAppError(http.StatusServiceUnavailable, "暂不支持该支付渠道")
	}
}

func (s *Service) createWechatPrepay(ctx context.Context, order *model.PaymentOrder, channel *model.PaymentChannel, version *model.PaymentChannelVersion) (*model.PaymentOrder, error) {
	provider, err := s.paymentProvider(ctx, *version)
	if err != nil {
		_ = s.repo.MarkPaymentOrderException(order.ID, "CHANNEL_CONFIG_ERROR", "支付渠道配置不可用", time.Now())
		return nil, WrapAppError(http.StatusServiceUnavailable, "支付渠道配置不可用", err)
	}
	notifyURL := paymentNotifyURL(channel.NotifyBaseURL, version.ID)
	result, prepayErr := provider.Prepay(ctx, paymentPrepayRequest{
		AppID: version.AppID, MerchantID: version.MerchantID, Description: truncateRunes(order.ProductNameSnapshot, 127),
		OutTradeNo: order.OutTradeNo, NotifyURL: notifyURL, AmountFen: order.AmountFen, ExpiresAt: order.ExpiresAt,
	})
	if prepayErr == nil {
		if err := s.repo.MarkPaymentOrderPending(order.ID, result.CodeURL, result.RequestID, time.Now()); err != nil && !errors.Is(err, repository.ErrPaymentStateConflict) {
			return nil, err
		}
		return s.repo.PaymentOrder(order.ID)
	}

	// 预下单超时或返回不确定时，先查原单，绝不直接换单号重试。
	transaction, queryErr := provider.Query(ctx, order.OutTradeNo)
	if queryErr == nil {
		_ = s.repo.RecordPaymentOrderQuery(order.ID, transaction.TradeState, transaction.TradeStateDescription, time.Now())
		if transaction.TradeState == "SUCCESS" {
			if _, err := s.completePaymentTransaction(order, *version, transaction); err != nil {
				return nil, err
			}
			return s.repo.PaymentOrder(order.ID)
		}
		_ = s.repo.MarkPaymentOrderException(order.ID, paymentErrorCode(prepayErr), "预下单结果不确定，请重新发起充值", time.Now())
		return nil, WrapAppError(http.StatusBadGateway, "预下单结果不确定，请稍后重新发起充值", prepayErr)
	}
	if core.IsAPIError(queryErr, "ORDER_NOT_EXIST") {
		_ = s.repo.MarkPaymentOrderCreateFailed(order.ID, paymentErrorCode(prepayErr), "微信支付预下单失败", time.Now())
		return nil, WrapAppError(http.StatusBadGateway, "微信支付预下单失败，请稍后重试", prepayErr)
	}
	_ = s.repo.MarkPaymentOrderException(order.ID, paymentErrorCode(prepayErr), "预下单结果待确认", time.Now())
	return nil, WrapAppError(http.StatusBadGateway, "支付渠道响应不确定，系统将自动核对", prepayErr)
}

func (s *Service) RechargeOrders(user *model.User, page int, limit int) (*RechargeOrderPage, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	page, limit = normalizeAdminPage(page, limit)
	items, total, err := s.repo.PaymentOrdersForUser(user.ID, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &RechargeOrderPage{Orders: items, Total: total, Page: page, Limit: limit, ServerTime: time.Now()}, nil
}

func (s *Service) RechargeOrder(user *model.User, id string) (*model.PaymentOrder, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	order, err := s.repo.PaymentOrderForUser(user.ID, strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("充值订单不存在")
	}
	return order, err
}

func (s *Service) SyncRechargeOrder(ctx context.Context, user *model.User, id string) (*model.PaymentOrder, error) {
	order, err := s.RechargeOrder(user, id)
	if err != nil {
		return nil, err
	}
	return s.syncPaymentOrder(ctx, order, false)
}

func (s *Service) CloseRechargeOrder(ctx context.Context, user *model.User, id string) (*model.PaymentOrder, error) {
	order, err := s.RechargeOrder(user, id)
	if err != nil {
		return nil, err
	}
	if order.Status == model.PaymentOrderSucceeded || order.Status == model.PaymentOrderClosed || order.Status == model.PaymentOrderFailed {
		return order, nil
	}
	if order.Status != model.PaymentOrderPending && order.Status != model.PaymentOrderClosing {
		return nil, BadAuthRequest("当前订单不能关闭")
	}
	if err := s.closePaymentOrder(ctx, order); err != nil {
		return nil, err
	}
	return s.repo.PaymentOrder(order.ID)
}

func (s *Service) syncPaymentOrder(ctx context.Context, order *model.PaymentOrder, force bool) (*model.PaymentOrder, error) {
	if order.Status == model.PaymentOrderSucceeded || order.Status == model.PaymentOrderClosed || order.Status == model.PaymentOrderFailed {
		return order, nil
	}
	if !force && order.LastQueryAt != nil && time.Since(*order.LastQueryAt) < paymentQueryCooldown {
		return order, nil
	}
	version, err := s.repo.PaymentChannelVersion(order.ChannelVersionID)
	if err != nil {
		return nil, err
	}
	provider, err := s.paymentProvider(ctx, *version)
	if err != nil {
		return nil, err
	}
	transaction, err := provider.Query(ctx, order.OutTradeNo)
	if err != nil {
		if core.IsAPIError(err, "ORDER_NOT_EXIST") {
			_ = s.repo.RecordPaymentOrderQuery(order.ID, "NOT_FOUND", "微信支付订单不存在", time.Now())
			return s.repo.PaymentOrder(order.ID)
		}
		_ = s.repo.RecordPaymentOrderQueryError(order.ID, paymentErrorCode(err), "微信支付查单失败", time.Now())
		return nil, WrapAppError(http.StatusBadGateway, "微信支付查单失败，请稍后重试", err)
	}
	if err := s.repo.RecordPaymentOrderQuery(order.ID, transaction.TradeState, transaction.TradeStateDescription, time.Now()); err != nil {
		return nil, err
	}
	switch transaction.TradeState {
	case "SUCCESS":
		if _, err := s.completePaymentTransaction(order, *version, transaction); err != nil {
			return nil, err
		}
	case "CLOSED", "REVOKED", "PAYERROR":
		if err := s.repo.MarkPaymentOrderClosed(order.ID, transaction.TradeState, time.Now()); err != nil {
			return nil, err
		}
	}
	return s.repo.PaymentOrder(order.ID)
}

func (s *Service) HandleWechatPaymentNotification(ctx context.Context, channelVersionID string, request *http.Request) error {
	version, err := s.repo.PaymentChannelVersion(strings.TrimSpace(channelVersionID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("支付渠道版本不存在")
	}
	if err != nil {
		return err
	}
	provider, err := s.paymentProvider(ctx, *version)
	if err != nil {
		return err
	}
	notification, err := provider.ParseNotification(ctx, request)
	if err != nil {
		return &AppError{Status: http.StatusBadRequest, Message: "微信支付通知验签失败", Cause: err}
	}
	transaction := notification.Transaction
	if notification.ProviderEventID == "" || transaction.OutTradeNo == "" {
		return BadAuthRequest("微信支付通知缺少必要字段")
	}
	now := time.Now()
	event := &model.PaymentEvent{
		ID: newID(), Provider: model.PaymentProviderWechatPay, ProviderEventID: notification.ProviderEventID,
		ChannelVersionID: version.ID, EventType: notification.EventType, OutTradeNo: transaction.OutTradeNo,
		TransactionID: transaction.TransactionID, AppID: transaction.AppID, MerchantID: transaction.MerchantID,
		TradeState: transaction.TradeState, TradeStateDescription: transaction.TradeStateDescription,
		AmountFen: transaction.AmountFen, Currency: transaction.Currency, SuccessTime: transaction.SuccessTime,
		ResourceDigest: notification.ResourceDigest, Status: model.PaymentEventPending, ReceivedAt: now,
	}
	_, err = s.repo.CreatePaymentEvent(event)
	return err
}

func (s *Service) processPaymentEvent(event model.PaymentEvent) error {
	order, err := s.repo.PaymentOrderByOutTradeNo(event.OutTradeNo)
	if err != nil {
		_ = s.repo.SavePaymentEventResult(event.ID, model.PaymentEventFailed, "", "找不到本地支付订单", time.Now())
		return err
	}
	version, err := s.repo.PaymentChannelVersion(event.ChannelVersionID)
	if err != nil {
		_ = s.repo.SavePaymentEventResult(event.ID, model.PaymentEventFailed, order.ID, "找不到支付渠道版本", time.Now())
		return err
	}
	transaction := paymentTransaction{
		AppID: event.AppID, MerchantID: event.MerchantID, OutTradeNo: event.OutTradeNo,
		TransactionID: event.TransactionID, TradeState: event.TradeState,
		TradeStateDescription: event.TradeStateDescription, AmountFen: event.AmountFen,
		Currency: event.Currency, SuccessTime: event.SuccessTime,
	}
	if err := validatePaymentTransaction(order, *version, transaction); err != nil {
		_ = s.repo.MarkPaymentOrderException(order.ID, "NOTIFY_MISMATCH", "支付通知与订单快照不一致", time.Now())
		_ = s.repo.SavePaymentEventResult(event.ID, model.PaymentEventFailed, order.ID, truncateRunes(err.Error(), 1000), time.Now())
		return err
	}
	if transaction.TradeState != "SUCCESS" {
		return s.repo.SavePaymentEventResult(event.ID, model.PaymentEventIgnored, order.ID, "非支付成功事件", time.Now())
	}
	if _, err := s.completePaymentTransaction(order, *version, transaction); err != nil {
		_ = s.repo.SavePaymentEventResult(event.ID, model.PaymentEventFailed, order.ID, truncateRunes(err.Error(), 1000), time.Now())
		return err
	}
	return s.repo.SavePaymentEventResult(event.ID, model.PaymentEventProcessed, order.ID, "", time.Now())
}

func (s *Service) completePaymentTransaction(order *model.PaymentOrder, version model.PaymentChannelVersion, transaction paymentTransaction) (bool, error) {
	if err := validatePaymentTransaction(order, version, transaction); err != nil {
		return false, err
	}
	paidAt := time.Now()
	if transaction.SuccessTime != "" {
		if parsed, err := time.Parse(time.RFC3339, transaction.SuccessTime); err == nil {
			paidAt = parsed
		}
	}
	referenceKey := fmt.Sprintf("wechatpay:%s:%s", version.MerchantID, transaction.TransactionID)
	_, credited, err := s.repo.CompletePaymentOrder(order.ID, transaction.TransactionID, referenceKey, paidAt, transaction.TradeState, transaction.TradeStateDescription)
	return credited, err
}

func validatePaymentTransaction(order *model.PaymentOrder, version model.PaymentChannelVersion, transaction paymentTransaction) error {
	if transaction.OutTradeNo != order.OutTradeNo || transaction.AppID != version.AppID || transaction.MerchantID != version.MerchantID {
		return errors.New("商户身份或订单号不匹配")
	}
	if transaction.TradeState == "SUCCESS" && strings.TrimSpace(transaction.TransactionID) == "" {
		return errors.New("支付成功通知缺少微信支付交易号")
	}
	if transaction.AmountFen != order.AmountFen || defaultString(transaction.Currency, "CNY") != order.Currency {
		return errors.New("支付金额或币种与订单快照不匹配")
	}
	return nil
}

func (s *Service) closePaymentOrder(ctx context.Context, order *model.PaymentOrder) error {
	if order.Status == model.PaymentOrderPending {
		claimed, err := s.repo.ClaimPaymentOrderClosing(order.ID, time.Now())
		if err != nil {
			return err
		}
		if !claimed {
			latest, loadErr := s.repo.PaymentOrder(order.ID)
			if loadErr != nil {
				return loadErr
			}
			if latest.Status != model.PaymentOrderClosing {
				return nil
			}
			order = latest
		}
	}
	version, err := s.repo.PaymentChannelVersion(order.ChannelVersionID)
	if err != nil {
		return err
	}
	provider, err := s.paymentProvider(ctx, *version)
	if err != nil {
		return err
	}
	transaction, queryErr := provider.Query(ctx, order.OutTradeNo)
	if queryErr == nil {
		_ = s.repo.RecordPaymentOrderQuery(order.ID, transaction.TradeState, transaction.TradeStateDescription, time.Now())
		switch transaction.TradeState {
		case "SUCCESS":
			_, err = s.completePaymentTransaction(order, *version, transaction)
			return err
		case "NOTPAY":
			// 查单明确未支付后才允许关单。
		case "CLOSED", "REVOKED", "PAYERROR":
			return s.repo.MarkPaymentOrderClosed(order.ID, transaction.TradeState, time.Now())
		default:
			return nil
		}
	} else if !core.IsAPIError(queryErr, "ORDER_NOT_EXIST") {
		_ = s.repo.RecordPaymentOrderQueryError(order.ID, paymentErrorCode(queryErr), "微信支付查单失败", time.Now())
		return queryErr
	} else {
		_ = s.repo.RecordPaymentOrderQueryError(order.ID, paymentErrorCode(queryErr), "微信支付订单不存在", time.Now())
		return s.repo.MarkPaymentOrderClosed(order.ID, "NOT_FOUND", time.Now())
	}
	if err := provider.Close(ctx, order.OutTradeNo); err != nil {
		return err
	}
	return s.repo.MarkPaymentOrderClosed(order.ID, "CLOSED", time.Now())
}

func (s *Service) paymentProvider(ctx context.Context, version model.PaymentChannelVersion) (paymentProvider, error) {
	s.paymentProviderMu.Lock()
	defer s.paymentProviderMu.Unlock()
	if s.paymentProviders == nil {
		s.paymentProviders = make(map[string]paymentProvider)
	}
	if provider := s.paymentProviders[version.ID]; provider != nil {
		return provider, nil
	}
	privateKey, err := s.decryptSettingSecret(version.MerchantPrivateKeyCipher)
	if err != nil {
		return nil, err
	}
	apiV3Key, err := s.decryptSettingSecret(version.APIv3KeyCipher)
	if err != nil {
		return nil, err
	}
	provider, err := newWechatPayProvider(ctx, version, privateKey, apiV3Key)
	if err != nil {
		return nil, err
	}
	s.paymentProviders[version.ID] = provider
	return provider, nil
}

func (s *Service) startPaymentWorker(ctx context.Context) {
	s.startPaymentReconciliationScheduler(ctx)
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(paymentWorkerInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runPaymentWorkerOnce(ctx)
			}
		}
	})
}

func (s *Service) runPaymentWorkerOnce(ctx context.Context) {
	events, err := s.repo.PendingPaymentEvents(time.Now().Add(-30*time.Second), 20)
	if err == nil {
		for _, event := range events {
			_ = s.processPaymentEvent(event)
		}
	}
	now := time.Now()
	orders, err := s.repo.ExpiredPaymentOrders(now, now.Add(-30*time.Second), 20)
	if err == nil {
		for index := range orders {
			if orders[index].LastQueryAt != nil && now.Sub(*orders[index].LastQueryAt) < 30*time.Second {
				continue
			}
			_ = s.closePaymentOrder(ctx, &orders[index])
		}
	}
	recoverable, err := s.repo.RecoverablePaymentOrders(now.Add(-30*time.Second), now.Add(-30*time.Second), 10)
	if err == nil {
		for index := range recoverable {
			if recoverable[index].LastQueryAt != nil && now.Sub(*recoverable[index].LastQueryAt) < 30*time.Second {
				continue
			}
			_, _ = s.syncPaymentOrder(ctx, &recoverable[index], true)
		}
	}
}

func newPaymentOutTradeNo(now time.Time) string {
	var random [8]byte
	if _, err := rand.Read(random[:]); err != nil {
		return "WP" + now.Format("20060102150405") + fmt.Sprintf("%016x", now.UnixNano())[:16]
	}
	return "WP" + now.Format("20060102150405") + hex.EncodeToString(random[:])
}

func normalizePaymentExpiry(value int) int {
	if value < 5 || value > 120 {
		return 15
	}
	return value
}

func paymentNotifyURL(baseURL string, versionID string) string {
	return strings.TrimRight(strings.TrimSpace(baseURL), "/") + "/api/payment-notify/wechat/" + versionID
}

func paymentErrorCode(err error) string {
	var apiErr *core.APIError
	if errors.As(err, &apiErr) && strings.TrimSpace(apiErr.Code) != "" {
		return truncateRunes(apiErr.Code, 120)
	}
	return "WECHATPAY_ERROR"
}
