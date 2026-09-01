package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/payment"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const defaultRechargeOrderTTL = 15 * time.Minute

type CreditPackageRequest struct {
	Name              string `json:"name"`
	Description       string `json:"description"`
	Currency          string `json:"currency"`
	AmountFen         int64  `json:"amountFen"`
	BaseMicrocredits  int64  `json:"baseMicrocredits"`
	BonusMicrocredits int64  `json:"bonusMicrocredits"`
	Enabled           bool   `json:"enabled"`
	SortOrder         int    `json:"sortOrder"`
	ExpectedVersion   int64  `json:"expectedVersion"`
}

type PaymentChannelRequest struct {
	Provider    string `json:"provider"`
	Method      string `json:"method"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	SortOrder   int    `json:"sortOrder"`
}

type PaymentChannelConfigRequest struct {
	Config json.RawMessage `json:"config"`
}

type AdminPaymentChannel struct {
	model.PaymentChannel
	Configured          bool  `json:"configured"`
	ActiveConfigVersion int64 `json:"activeConfigVersion,omitempty"`
}

type RechargeCatalog struct {
	Packages []model.CreditPackage  `json:"packages"`
	Channels []PublicPaymentChannel `json:"channels"`
}

type PublicPaymentChannel struct {
	ID          string `json:"id"`
	Provider    string `json:"provider"`
	Method      string `json:"method"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	SortOrder   int    `json:"sortOrder"`
}

type CreateRechargeOrderRequest struct {
	PackageID      string `json:"packageId"`
	ChannelID      string `json:"channelId"`
	IdempotencyKey string `json:"idempotencyKey"`
	ClientIP       string `json:"-"`
}

type PublicRechargeOrder struct {
	ID                    string                          `json:"id"`
	PackageID             string                          `json:"packageId"`
	PackageName           string                          `json:"packageName"`
	Currency              string                          `json:"currency"`
	AmountFen             int64                           `json:"amountFen"`
	BaseMicrocredits      int64                           `json:"baseMicrocredits"`
	BonusMicrocredits     int64                           `json:"bonusMicrocredits"`
	TotalMicrocredits     int64                           `json:"totalMicrocredits"`
	ChannelID             string                          `json:"channelId"`
	ChannelName           string                          `json:"channelName"`
	Provider              string                          `json:"provider"`
	Method                string                          `json:"method"`
	Status                model.CreditRechargeOrderStatus `json:"status"`
	ProviderState         string                          `json:"providerState,omitempty"`
	ProviderTransactionID string                          `json:"providerTransactionId,omitempty"`
	PayPayload            map[string]any                  `json:"payPayload,omitempty"`
	ExpiresAt             *time.Time                      `json:"expiresAt,omitempty"`
	PaidAt                *time.Time                      `json:"paidAt,omitempty"`
	CreditedAt            *time.Time                      `json:"creditedAt,omitempty"`
	CreatedAt             time.Time                       `json:"createdAt"`
	UpdatedAt             time.Time                       `json:"updatedAt"`
}

type RechargeOrderPage struct {
	Orders []PublicRechargeOrder `json:"orders"`
	Total  int64                 `json:"total"`
	Page   int                   `json:"page"`
	Limit  int                   `json:"limit"`
}

type AdminRechargeOrderPage struct {
	Orders []model.CreditRechargeOrder `json:"orders"`
	Total  int64                       `json:"total"`
	Page   int                         `json:"page"`
	Limit  int                         `json:"limit"`
}

func (s *Service) PaymentProviderDescriptors(actor *model.User) ([]payment.Descriptor, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.payments().Descriptors(), nil
}

func (s *Service) RechargeCatalog(user *model.User) (*RechargeCatalog, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	if err := s.RequireFeature(FeatureCreditRecharge); err != nil {
		return nil, err
	}
	packages, err := s.repo.ListEnabledCreditPackages()
	if err != nil {
		return nil, err
	}
	channels, err := s.repo.ListEnabledPaymentChannels()
	if err != nil {
		return nil, err
	}
	publicChannels := make([]PublicPaymentChannel, 0, len(channels))
	for _, channel := range channels {
		if _, err := s.payments().Get(channel.Provider); err != nil {
			continue
		}
		publicChannels = append(publicChannels, publicPaymentChannel(channel))
	}
	return &RechargeCatalog{Packages: packages, Channels: publicChannels}, nil
}

func (s *Service) AdminCreditPackages(actor *model.User, includeArchived bool) ([]model.CreditPackage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.repo.ListCreditPackages(includeArchived)
}

func (s *Service) CreateCreditPackage(actor *model.User, request CreditPackageRequest) (*model.CreditPackage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	item, err := creditPackageFromRequest(request)
	if err != nil {
		return nil, err
	}
	item.CreatedBy, item.UpdatedBy = actor.ID, actor.ID
	if err := s.repo.CreateCreditPackage(item); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "credit_package.create", "credit_package", item.ID, "创建积分充值套餐", map[string]any{"name": item.Name, "amountFen": item.AmountFen, "totalMicrocredits": item.BaseMicrocredits + item.BonusMicrocredits}); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) UpdateCreditPackage(actor *model.User, id string, request CreditPackageRequest) (*model.CreditPackage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if request.ExpectedVersion <= 0 {
		return nil, BadAuthRequest("缺少有效的套餐版本")
	}
	item, err := creditPackageFromRequest(request)
	if err != nil {
		return nil, err
	}
	item.ID, item.UpdatedBy = strings.TrimSpace(id), actor.ID
	updated, err := s.repo.UpdateCreditPackage(*item, request.ExpectedVersion)
	if err != nil {
		return nil, err
	}
	if !updated {
		return nil, NewAppError(http.StatusConflict, "套餐已被其他管理员修改，请刷新后重试")
	}
	if err := s.appendAdminAudit(actor, "credit_package.update", "credit_package", item.ID, "更新积分充值套餐", map[string]any{"expectedVersion": request.ExpectedVersion}); err != nil {
		return nil, err
	}
	return s.repo.CreditPackage(item.ID)
}

func (s *Service) ArchiveCreditPackage(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	updated, err := s.repo.ArchiveCreditPackage(strings.TrimSpace(id), actor.ID)
	if err != nil {
		return err
	}
	if !updated {
		return NotFound("充值套餐不存在")
	}
	return s.appendAdminAudit(actor, "credit_package.archive", "credit_package", id, "归档积分充值套餐", nil)
}

func (s *Service) AdminPaymentChannels(actor *model.User, includeArchived bool) ([]AdminPaymentChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channels, err := s.repo.ListPaymentChannels(includeArchived)
	if err != nil {
		return nil, err
	}
	result := make([]AdminPaymentChannel, 0, len(channels))
	for _, channel := range channels {
		public := AdminPaymentChannel{PaymentChannel: channel, Configured: channel.ActiveConfigVersionID != ""}
		if public.Configured {
			if config, err := s.repo.PaymentChannelConfigVersion(channel.ActiveConfigVersionID); err == nil {
				public.ActiveConfigVersion = config.Version
			}
		}
		result = append(result, public)
	}
	return result, nil
}

func (s *Service) CreatePaymentChannel(actor *model.User, request PaymentChannelRequest) (*model.PaymentChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	providerCode := strings.ToLower(strings.TrimSpace(request.Provider))
	provider, err := s.payments().Get(providerCode)
	if err != nil {
		return nil, BadAuthRequest("不支持的支付服务商")
	}
	method := strings.ToLower(strings.TrimSpace(request.Method))
	if !slices.Contains(provider.Descriptor().Methods, method) {
		return nil, BadAuthRequest("支付服务商不支持该支付方式")
	}
	name := truncateRunes(strings.TrimSpace(request.Name), 120)
	if name == "" {
		return nil, BadAuthRequest("请填写支付渠道名称")
	}
	item := &model.PaymentChannel{
		Provider: providerCode, Method: method, Name: name, Description: truncateRunes(strings.TrimSpace(request.Description), 500),
		Enabled: false, SortOrder: request.SortOrder, CreatedBy: actor.ID, UpdatedBy: actor.ID,
	}
	if err := s.repo.CreatePaymentChannel(item); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "payment_channel.create", "payment_channel", item.ID, "创建支付渠道", map[string]any{"provider": item.Provider, "method": item.Method}); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) UpdatePaymentChannel(actor *model.User, id string, request PaymentChannelRequest) (*model.PaymentChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.PaymentChannel(strings.TrimSpace(id))
	if err != nil {
		return nil, mapPaymentNotFound(err, "支付渠道不存在")
	}
	name := truncateRunes(strings.TrimSpace(request.Name), 120)
	if name == "" {
		return nil, BadAuthRequest("请填写支付渠道名称")
	}
	if request.Enabled {
		if channel.ActiveConfigVersionID == "" {
			return nil, BadAuthRequest("请先保存并测试支付渠道配置")
		}
		config, err := s.repo.PaymentChannelConfigVersion(channel.ActiveConfigVersionID)
		if err != nil {
			return nil, err
		}
		if channel.LastTestStatus != "passed" || channel.LastTestConfigDigest != config.ConfigDigest {
			return nil, BadAuthRequest("当前配置尚未通过测试，不能启用")
		}
	}
	channel.Name, channel.Description, channel.Enabled = name, truncateRunes(strings.TrimSpace(request.Description), 500), request.Enabled
	channel.SortOrder, channel.UpdatedBy = request.SortOrder, actor.ID
	updated, err := s.repo.UpdatePaymentChannel(*channel)
	if err != nil {
		return nil, err
	}
	if !updated {
		return nil, NotFound("支付渠道不存在")
	}
	if err := s.appendAdminAudit(actor, "payment_channel.update", "payment_channel", channel.ID, "更新支付渠道", map[string]any{"enabled": request.Enabled}); err != nil {
		return nil, err
	}
	return s.repo.PaymentChannel(channel.ID)
}

func (s *Service) SavePaymentChannelConfig(actor *model.User, channelID string, request PaymentChannelConfigRequest) (*model.PaymentChannelConfigVersion, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.PaymentChannel(strings.TrimSpace(channelID))
	if err != nil {
		return nil, mapPaymentNotFound(err, "支付渠道不存在")
	}
	provider, err := s.payments().Get(channel.Provider)
	if err != nil {
		return nil, BadAuthRequest("支付服务商不可用")
	}
	canonical, digest, err := canonicalPaymentConfig(request.Config)
	if err != nil {
		return nil, err
	}
	if err := provider.ValidateConfig(context.Background(), canonical); err != nil {
		return nil, BadAuthRequest("支付渠道配置无效：" + err.Error())
	}
	ciphertext, err := s.encryptSettingSecret(string(canonical))
	if err != nil {
		return nil, err
	}
	version, err := s.repo.CreatePaymentChannelConfigVersion(channel.ID, ciphertext, digest, actor.ID)
	if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "payment_channel.config.create", "payment_channel", channel.ID, "保存支付渠道配置版本", map[string]any{"version": version.Version, "digest": digest}); err != nil {
		return nil, err
	}
	return version, nil
}

func (s *Service) TestPaymentChannel(ctx context.Context, actor *model.User, channelID string) (*model.PaymentChannel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.repo.PaymentChannel(strings.TrimSpace(channelID))
	if err != nil {
		return nil, mapPaymentNotFound(err, "支付渠道不存在")
	}
	if channel.ActiveConfigVersionID == "" {
		return nil, BadAuthRequest("支付渠道尚未保存配置")
	}
	provider, err := s.payments().Get(channel.Provider)
	if err != nil {
		return nil, BadAuthRequest("支付服务商不可用")
	}
	config, raw, err := s.paymentConfig(channel.ActiveConfigVersionID)
	if err != nil {
		return nil, err
	}
	testError := ""
	status := "passed"
	if err := provider.ValidateConfig(ctx, raw); err != nil {
		status, testError = "failed", truncateRunes(err.Error(), 1000)
	} else if err := provider.TestConnection(ctx, raw); err != nil {
		status, testError = "failed", truncateRunes(err.Error(), 1000)
	}
	if err := s.repo.SetPaymentChannelTestResult(channel.ID, status, testError, config.ConfigDigest, actor.ID); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "payment_channel.test", "payment_channel", channel.ID, "测试支付渠道配置", map[string]any{"status": status, "digest": config.ConfigDigest}); err != nil {
		return nil, err
	}
	updated, err := s.repo.PaymentChannel(channel.ID)
	if err != nil {
		return nil, err
	}
	if status != "passed" {
		return updated, BadAuthRequest("支付渠道配置测试失败")
	}
	return updated, nil
}

func (s *Service) ArchivePaymentChannel(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	updated, err := s.repo.ArchivePaymentChannel(strings.TrimSpace(id), actor.ID)
	if err != nil {
		return err
	}
	if !updated {
		return NotFound("支付渠道不存在")
	}
	return s.appendAdminAudit(actor, "payment_channel.archive", "payment_channel", id, "归档支付渠道", nil)
}

func (s *Service) CreateRechargeOrder(ctx context.Context, user *model.User, request CreateRechargeOrderRequest) (*PublicRechargeOrder, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	if err := s.RequireFeature(FeatureCreditRecharge); err != nil {
		return nil, err
	}
	idempotencyKey := strings.TrimSpace(request.IdempotencyKey)
	if idempotencyKey == "" || len(idempotencyKey) > 160 {
		return nil, BadAuthRequest("请提供有效的幂等键")
	}
	packageItem, err := s.repo.CreditPackage(strings.TrimSpace(request.PackageID))
	if err != nil || !packageItem.Enabled {
		return nil, BadAuthRequest("充值套餐不可用")
	}
	channel, err := s.repo.PaymentChannel(strings.TrimSpace(request.ChannelID))
	if err != nil || !channel.Enabled || channel.ActiveConfigVersionID == "" {
		return nil, BadAuthRequest("支付渠道不可用")
	}
	provider, err := s.payments().Get(channel.Provider)
	if err != nil {
		return nil, NewAppError(http.StatusServiceUnavailable, "支付渠道暂不可用")
	}
	configVersion, rawConfig, err := s.paymentConfig(channel.ActiveConfigVersionID)
	if err != nil {
		return nil, WrapAppError(http.StatusServiceUnavailable, "支付渠道配置不可用", err)
	}
	now := time.Now().UTC()
	item := &model.CreditRechargeOrder{
		ID: newRechargeOrderID(), UserID: user.ID, IdempotencyKey: idempotencyKey, PackageID: packageItem.ID, PackageVersion: packageItem.Version,
		PackageName: packageItem.Name, Currency: packageItem.Currency, AmountFen: packageItem.AmountFen,
		BaseMicrocredits: packageItem.BaseMicrocredits, BonusMicrocredits: packageItem.BonusMicrocredits,
		TotalMicrocredits: packageItem.BaseMicrocredits + packageItem.BonusMicrocredits,
		ChannelID:         channel.ID, ChannelName: channel.Name, Provider: channel.Provider, Method: channel.Method,
		ConfigVersionID: configVersion.ID, Status: model.CreditRechargeOrderCreated,
		ExpiresAt: timePointer(now.Add(defaultRechargeOrderTTL)),
	}
	order, created, err := s.repo.CreateRechargeOrder(item)
	if err != nil {
		return nil, err
	}
	if !created && (order.PackageID != item.PackageID || order.ChannelID != item.ChannelID) {
		return nil, NewAppError(http.StatusConflict, "该幂等键已用于另一笔充值订单")
	}
	if !created && order.Status != model.CreditRechargeOrderCreated && order.Status != model.CreditRechargeOrderPrepayUncertain {
		return s.publicRechargeOrder(order, true)
	}
	claimed, err := s.repo.ClaimRechargePrepay(order.ID)
	if err != nil {
		return nil, err
	}
	if !claimed {
		current, err := s.repo.UserRechargeOrder(user.ID, order.ID)
		if err != nil {
			return nil, err
		}
		return s.publicRechargeOrder(current, true)
	}
	notifyBaseURL, err := paymentConfigString(rawConfig, "notifyBaseUrl")
	if err != nil {
		_ = s.repo.FailRechargePrepay(order.ID, false, "INVALID_NOTIFY_URL", "payment notify URL is missing")
		return nil, WrapAppError(http.StatusServiceUnavailable, "支付渠道回调地址未正确配置", err)
	}
	notifyURL := strings.TrimRight(notifyBaseURL, "/") + "/api/payments/notifications/" + channel.Provider + "/" + channel.ID + "/" + configVersion.ID
	expiresAt := now.Add(defaultRechargeOrderTTL)
	result, err := provider.CreatePayment(ctx, rawConfig, payment.CreatePaymentRequest{
		OrderID: order.ID, Description: packageItem.Name, AmountFen: order.AmountFen, Currency: order.Currency,
		NotifyURL: notifyURL, ExpiresAt: expiresAt, ClientIP: request.ClientIP,
	})
	if err != nil {
		uncertain := false
		var providerError *payment.ProviderError
		if errors.As(err, &providerError) {
			uncertain = providerError.Uncertain
		}
		_ = s.repo.FailRechargePrepay(order.ID, uncertain, "PREPAY_FAILED", truncateRunes(err.Error(), 1000))
		return nil, WrapAppError(http.StatusBadGateway, "创建支付订单失败，请稍后重试", err)
	}
	payloadJSON, err := json.Marshal(result.PayPayload)
	if err != nil {
		return nil, err
	}
	payloadCipher, err := s.encryptSettingSecret(string(payloadJSON))
	if err != nil {
		return nil, err
	}
	if result.ExpiresAt.IsZero() {
		result.ExpiresAt = expiresAt
	}
	completed, err := s.repo.CompleteRechargePrepay(order.ID, result.PrepayID, payloadCipher, result.ExpiresAt)
	if err != nil {
		return nil, err
	}
	if !completed {
		// A verified callback can credit the order before the prepay response is
		// persisted. Return the authoritative state instead of surfacing a false
		// conflict after a successful payment.
		current, loadErr := s.repo.UserRechargeOrder(user.ID, order.ID)
		if loadErr != nil {
			return nil, loadErr
		}
		return s.publicRechargeOrder(current, true)
	}
	order, err = s.repo.UserRechargeOrder(user.ID, order.ID)
	if err != nil {
		return nil, err
	}
	return s.publicRechargeOrder(order, true)
}

func (s *Service) UserRechargeOrder(user *model.User, id string) (*PublicRechargeOrder, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	order, err := s.repo.UserRechargeOrder(user.ID, strings.TrimSpace(id))
	if err != nil {
		return nil, mapPaymentNotFound(err, "充值订单不存在")
	}
	return s.publicRechargeOrder(order, true)
}

func (s *Service) UserRechargeOrders(user *model.User, page int, limit int) (*RechargeOrderPage, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	page, limit = normalizePaymentPage(page, limit)
	items, total, err := s.repo.ListUserRechargeOrders(user.ID, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	public := make([]PublicRechargeOrder, 0, len(items))
	for index := range items {
		item, err := s.publicRechargeOrder(&items[index], false)
		if err != nil {
			return nil, err
		}
		public = append(public, *item)
	}
	return &RechargeOrderPage{Orders: public, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) SyncRechargeOrder(ctx context.Context, user *model.User, id string) (*PublicRechargeOrder, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	order, err := s.repo.UserRechargeOrder(user.ID, strings.TrimSpace(id))
	if err != nil {
		return nil, mapPaymentNotFound(err, "充值订单不存在")
	}
	if order.Status == model.CreditRechargeOrderCredited || order.Status == model.CreditRechargeOrderClosed || order.Status == model.CreditRechargeOrderFailed {
		return s.publicRechargeOrder(order, false)
	}
	if err := s.syncRechargeOrder(ctx, order); err != nil {
		return nil, err
	}
	order, err = s.repo.UserRechargeOrder(user.ID, order.ID)
	if err != nil {
		return nil, err
	}
	return s.publicRechargeOrder(order, true)
}

func (s *Service) CloseRechargeOrder(ctx context.Context, user *model.User, id string) (*PublicRechargeOrder, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	order, err := s.repo.UserRechargeOrder(user.ID, strings.TrimSpace(id))
	if err != nil {
		return nil, mapPaymentNotFound(err, "充值订单不存在")
	}
	if order.Status == model.CreditRechargeOrderCredited || order.Status == model.CreditRechargeOrderPaid {
		return nil, NewAppError(http.StatusConflict, "已支付订单不能关闭")
	}
	if order.Status == model.CreditRechargeOrderClosed || order.Status == model.CreditRechargeOrderFailed {
		return s.publicRechargeOrder(order, false)
	}
	provider, err := s.payments().Get(order.Provider)
	if err != nil {
		return nil, WrapAppError(http.StatusServiceUnavailable, "支付渠道不可用", err)
	}
	_, rawConfig, err := s.paymentConfig(order.ConfigVersionID)
	if err != nil {
		return nil, err
	}
	if err := provider.ClosePayment(ctx, rawConfig, order.ID); err != nil {
		return nil, WrapAppError(http.StatusBadGateway, "关闭支付订单失败，请稍后重试", err)
	}
	closed, err := s.repo.CloseRechargeOrder(order.ID, "CLOSED")
	if err != nil {
		return nil, err
	}
	if !closed {
		return nil, NewAppError(http.StatusConflict, "充值订单状态已变化，请刷新订单")
	}
	order, err = s.repo.UserRechargeOrder(user.ID, order.ID)
	if err != nil {
		return nil, err
	}
	return s.publicRechargeOrder(order, false)
}

func (s *Service) HandlePaymentNotification(ctx context.Context, providerCode string, channelID string, configVersionID string, headers http.Header, body []byte) error {
	channel, err := s.repo.PaymentChannelIncludingArchived(strings.TrimSpace(channelID))
	if err != nil {
		return mapPaymentNotFound(err, "支付渠道不存在")
	}
	if channel.Provider != strings.ToLower(strings.TrimSpace(providerCode)) {
		return BadAuthRequest("支付回调渠道不匹配")
	}
	config, rawConfig, err := s.paymentConfig(configVersionID)
	if err != nil {
		return err
	}
	if config.ChannelID != channel.ID {
		return BadAuthRequest("支付回调配置版本不匹配")
	}
	provider, err := s.payments().Get(channel.Provider)
	if err != nil {
		return NewAppError(http.StatusServiceUnavailable, "支付服务商不可用")
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://callback.local/", bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpRequest.Header = headers.Clone()
	notification, err := provider.ParseNotification(ctx, rawConfig, httpRequest)
	if err != nil {
		return NewAppError(http.StatusUnauthorized, "支付通知验签失败")
	}
	rawCipher, err := s.encryptSettingSecret(string(body))
	if err != nil {
		return err
	}
	headerJSON, _ := json.Marshal(paymentNotificationAuditHeaders(headers))
	event, created, err := s.repo.CreatePaymentNotificationEvent(&model.PaymentNotificationEvent{
		Provider: channel.Provider, EventID: notification.EventID, ChannelID: channel.ID, ConfigVersionID: config.ID,
		OrderID: notification.OrderID, ResourceType: notification.ResourceType, Summary: truncateRunes(notification.Summary, 500),
		RawBodyCipher: rawCipher, HeadersJSON: string(headerJSON), Status: model.PaymentNotificationPending, ReceivedAt: time.Now().UTC(),
	})
	if err != nil {
		return err
	}
	if !created && slices.Contains([]model.PaymentNotificationStatus{model.PaymentNotificationProcessed, model.PaymentNotificationRejected, model.PaymentNotificationDuplicate}, event.Status) {
		return nil
	}
	if !strings.EqualFold(notification.State, "SUCCESS") {
		return s.repo.FailPaymentNotificationEvent(event.ID, model.PaymentNotificationProcessed, "")
	}
	order, err := s.repo.RechargeOrder(notification.OrderID)
	if err != nil {
		_ = s.repo.FailPaymentNotificationEvent(event.ID, model.PaymentNotificationFailed, "order not found")
		return mapPaymentNotFound(err, "充值订单不存在")
	}
	if order.ChannelID != channel.ID || order.Provider != channel.Provider || order.ConfigVersionID != config.ID {
		_ = s.repo.FailPaymentNotificationEvent(event.ID, model.PaymentNotificationRejected, "order channel snapshot mismatch")
		return nil
	}
	_, err = s.repo.ConfirmRechargePaid(order.ID, notification.ProviderTransactionID, notification.AmountFen, notification.Currency, notification.PaidAt, event.ID)
	if errors.Is(err, repository.ErrRechargePaymentMismatch) {
		_ = s.repo.MarkRechargeReviewRequired(order.ID, "PAYMENT_MISMATCH", "支付通知金额、币种或交易号与订单快照不一致")
		_ = s.repo.FailPaymentNotificationEvent(event.ID, model.PaymentNotificationRejected, "payment snapshot mismatch")
		return nil
	}
	if err != nil {
		_ = s.repo.FailPaymentNotificationEvent(event.ID, model.PaymentNotificationFailed, "credit transaction failed")
		return WrapAppError(http.StatusInternalServerError, "支付通知处理失败", err)
	}
	return nil
}

func (s *Service) AdminRechargeOrders(actor *model.User, status string, userID string, channelID string, page int, limit int) (*AdminRechargeOrderPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit = normalizePaymentPage(page, limit)
	items, total, err := s.repo.ListRechargeOrders(status, userID, channelID, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &AdminRechargeOrderPage{Orders: items, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) syncRechargeOrder(ctx context.Context, order *model.CreditRechargeOrder) error {
	provider, err := s.payments().Get(order.Provider)
	if err != nil {
		return WrapAppError(http.StatusServiceUnavailable, "支付渠道不可用", err)
	}
	_, rawConfig, err := s.paymentConfig(order.ConfigVersionID)
	if err != nil {
		return err
	}
	status, err := provider.QueryPayment(ctx, rawConfig, order.ID)
	if err != nil {
		return WrapAppError(http.StatusBadGateway, "查询支付状态失败，请稍后重试", err)
	}
	if status.OrderID != "" && status.OrderID != order.ID {
		return WrapAppError(http.StatusBadGateway, "支付服务商返回了错误的订单号", repository.ErrRechargePaymentMismatch)
	}
	var nextQueryAt *time.Time
	if !status.Paid() && !slices.Contains([]string{"CLOSED", "REVOKED", "PAYERROR"}, strings.ToUpper(status.State)) {
		nextQueryAt = timePointer(time.Now().UTC().Add(time.Minute))
	}
	if err := s.repo.MarkRechargeQuery(order.ID, status.State, nextQueryAt); err != nil {
		return err
	}
	if status.Paid() {
		_, err := s.repo.ConfirmRechargePaid(order.ID, status.ProviderTransactionID, status.AmountFen, status.Currency, status.PaidAt, "")
		if errors.Is(err, repository.ErrRechargePaymentMismatch) {
			_ = s.repo.MarkRechargeReviewRequired(order.ID, "PAYMENT_MISMATCH", "主动查单金额、币种或交易号与订单快照不一致")
			return NewAppError(http.StatusConflict, "支付结果与订单不一致，已转入人工核对")
		}
		return err
	}
	if slices.Contains([]string{"CLOSED", "REVOKED", "PAYERROR"}, strings.ToUpper(status.State)) {
		_, err = s.repo.CloseRechargeOrder(order.ID, status.State)
	}
	return err
}

func (s *Service) paymentConfig(id string) (*model.PaymentChannelConfigVersion, json.RawMessage, error) {
	config, err := s.repo.PaymentChannelConfigVersion(strings.TrimSpace(id))
	if err != nil {
		return nil, nil, mapPaymentNotFound(err, "支付渠道配置版本不存在")
	}
	plaintext, err := s.decryptSettingSecret(config.ConfigCipher)
	if err != nil {
		return nil, nil, err
	}
	return config, json.RawMessage(plaintext), nil
}

func (s *Service) publicRechargeOrder(order *model.CreditRechargeOrder, includePayload bool) (*PublicRechargeOrder, error) {
	result := &PublicRechargeOrder{
		ID: order.ID, PackageID: order.PackageID, PackageName: order.PackageName, Currency: order.Currency,
		AmountFen: order.AmountFen, BaseMicrocredits: order.BaseMicrocredits, BonusMicrocredits: order.BonusMicrocredits,
		TotalMicrocredits: order.TotalMicrocredits, ChannelID: order.ChannelID, ChannelName: order.ChannelName,
		Provider: order.Provider, Method: order.Method, Status: order.Status, ProviderState: order.ProviderState,
		ExpiresAt: order.ExpiresAt, PaidAt: order.PaidAt, CreditedAt: order.CreditedAt, CreatedAt: order.CreatedAt, UpdatedAt: order.UpdatedAt,
	}
	if order.ProviderTransactionID != nil {
		result.ProviderTransactionID = *order.ProviderTransactionID
	}
	if includePayload && order.PayPayloadCipher != "" && order.Status == model.CreditRechargeOrderAwaitingPayment {
		plaintext, err := s.decryptSettingSecret(order.PayPayloadCipher)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(plaintext), &result.PayPayload); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func creditPackageFromRequest(request CreditPackageRequest) (*model.CreditPackage, error) {
	name := truncateRunes(strings.TrimSpace(request.Name), 120)
	if name == "" {
		return nil, BadAuthRequest("请填写套餐名称")
	}
	currency := strings.ToUpper(strings.TrimSpace(request.Currency))
	if currency == "" {
		currency = "CNY"
	}
	if currency != "CNY" {
		return nil, BadAuthRequest("当前仅支持人民币套餐")
	}
	if request.AmountFen <= 0 || request.BaseMicrocredits <= 0 || request.BonusMicrocredits < 0 {
		return nil, BadAuthRequest("套餐金额和积分数量必须有效")
	}
	if request.BaseMicrocredits > 9_000_000_000_000_000 || request.BonusMicrocredits > 9_000_000_000_000_000-request.BaseMicrocredits {
		return nil, BadAuthRequest("套餐积分数量超出允许范围")
	}
	return &model.CreditPackage{
		Name: name, Description: truncateRunes(strings.TrimSpace(request.Description), 500), Currency: currency,
		AmountFen: request.AmountFen, BaseMicrocredits: request.BaseMicrocredits, BonusMicrocredits: request.BonusMicrocredits,
		Enabled: request.Enabled, SortOrder: request.SortOrder, Version: 1,
	}, nil
}

func canonicalPaymentConfig(raw json.RawMessage) (json.RawMessage, string, error) {
	if len(raw) == 0 {
		return nil, "", BadAuthRequest("请填写支付渠道配置")
	}
	var value map[string]any
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil || value == nil {
		return nil, "", BadAuthRequest("支付渠道配置格式无效")
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return nil, "", err
	}
	digestBytes := sha256.Sum256(canonical)
	return canonical, "sha256:" + hex.EncodeToString(digestBytes[:]), nil
}

func paymentConfigString(raw json.RawMessage, key string) (string, error) {
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	result, _ := value[key].(string)
	result = strings.TrimSpace(result)
	if result == "" {
		return "", fmt.Errorf("payment config field %s is missing", key)
	}
	return result, nil
}

func paymentNotificationAuditHeaders(headers http.Header) map[string]string {
	result := make(map[string]string)
	for _, key := range []string{"Wechatpay-Timestamp", "Wechatpay-Nonce", "Wechatpay-Serial", "Wechatpay-Signature", "Wechatpay-Signature-Type"} {
		if value := headers.Get(key); value != "" {
			result[key] = value
		}
	}
	return result
}

func publicPaymentChannel(channel model.PaymentChannel) PublicPaymentChannel {
	return PublicPaymentChannel{ID: channel.ID, Provider: channel.Provider, Method: channel.Method, Name: channel.Name, Description: channel.Description, SortOrder: channel.SortOrder}
}

func mapPaymentNotFound(err error, message string) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound(message)
	}
	return err
}

func normalizePaymentPage(page int, limit int) (int, int) {
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	return page, limit
}

func timePointer(value time.Time) *time.Time { return &value }

func newRechargeOrderID() string {
	raw := strings.ReplaceAll(newID(), "-", "")
	if len(raw) > 31 {
		raw = raw[:31]
	}
	return "R" + raw
}
