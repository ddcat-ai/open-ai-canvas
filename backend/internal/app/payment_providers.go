// 支付渠道配置：渠道列表、管理员配置保存（密钥加密存储）、清单与到期策略。
//
// 渠道实现全部来自已校验的支付插件包；没有可用插件时渠道列表为空，下单失败关闭，
// 绝不回退到宿主内置实现。

package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/payment"
	"yingce/backend/internal/protocol"
)

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

// PaymentProviders 不再要求积分功能：关闭积分后存储空间商品仍可在线购买。
// 每个渠道附带结算货币和已启用的支付方式，用户端据此展示按钮并预估跨币种实付金额。
func (s *Service) PaymentProviders(actor *model.User) ([]PaymentProviderView, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	items := make([]PaymentProviderView, 0)
	for _, descriptor := range s.paymentRegistry.Descriptors() {
		view, config, err := s.paymentProviderView(descriptor)
		if err != nil {
			return nil, err
		}
		if !view.Enabled || !view.Configured || config == nil {
			continue
		}
		values, err := s.decryptPaymentConfig(config)
		if err != nil {
			return nil, err
		}
		options, err := s.paymentProviderOptions(descriptor.ID, values)
		if err != nil {
			// 保存时已严格校验；读到无效配置（如手工改库）时只隐藏该渠道，不影响其他渠道充值。
			continue
		}
		view.SettlementCurrency, view.Methods = options.SettlementCurrency, options.Methods
		items = append(items, view)
	}
	return items, nil
}

type paymentProviderOptions struct {
	SettlementCurrency string
	Methods            []PaymentMethodView
}

// paymentProviderOptions 解析渠道配置中宿主约定的两个字段：settlementCurrency（结算货币，缺省 CNY）
// 和清单 methodsField 指向的已启用支付方式列表。
func (s *Service) paymentProviderOptions(providerID string, values payment.Config) (paymentProviderOptions, error) {
	currency, err := paymentSettlementCurrency(values)
	if err != nil {
		return paymentProviderOptions{}, err
	}
	options := paymentProviderOptions{SettlementCurrency: currency}
	manifest, ok := s.paymentManifestForProvider(providerID)
	if !ok {
		return options, nil
	}
	contribution, ok := paymentProviderContribution(manifest, providerID)
	if !ok {
		return options, nil
	}
	options.Methods, err = paymentProviderMethods(contribution, values)
	return options, err
}

func paymentProviderContribution(manifest protocol.Manifest, providerID string) (protocol.ManifestPaymentProvider, bool) {
	for _, contribution := range manifest.Contributes.PaymentProviders {
		if contribution.ID == providerID {
			return contribution, true
		}
	}
	return protocol.ManifestPaymentProvider{}, false
}

func paymentSettlementCurrency(values payment.Config) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(values["settlementCurrency"])) {
	case "", model.PriceCurrencyCNY:
		return model.PriceCurrencyCNY, nil
	case model.PriceCurrencyUSD:
		return model.PriceCurrencyUSD, nil
	default:
		return "", BadAuthRequest("渠道结算货币只支持 CNY 或 USD")
	}
}

// paymentProviderMethods 按清单目录和配置得到已启用的支付方式。配置值为逗号或换行分隔的
// id 或 id:名称；目录内的方式沿用目录名称与图标，目录外的方式使用配置中的名称。
// 配置值为空时返回空列表，由插件使用自己的默认方式，保持旧配置可用。
func paymentProviderMethods(contribution protocol.ManifestPaymentProvider, values payment.Config) ([]PaymentMethodView, error) {
	catalog := make(map[string]protocol.ManifestPaymentMethod, len(contribution.Methods))
	for _, method := range contribution.Methods {
		catalog[method.ID] = method
	}
	field := strings.TrimSpace(contribution.MethodsField)
	if field == "" {
		methods := make([]PaymentMethodView, 0, len(contribution.Methods))
		for _, method := range contribution.Methods {
			methods = append(methods, PaymentMethodView{ID: method.ID, Name: method.Label, Icon: method.Icon})
		}
		return methods, nil
	}
	raw := strings.NewReplacer("\n", ",", "\r", ",", "，", ",").Replace(values[field])
	methods := make([]PaymentMethodView, 0)
	seen := make(map[string]struct{})
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		id, label, _ := strings.Cut(entry, ":")
		id, label = strings.ToLower(strings.TrimSpace(id)), strings.TrimSpace(label)
		if !protocol.ValidPaymentMethodID(id) {
			return nil, BadAuthRequest("支付方式 " + entry + " 无效：ID 只能包含小写字母、数字、- 或 _，最长 32 位")
		}
		if len([]rune(label)) > 40 {
			return nil, BadAuthRequest("支付方式 " + id + " 的名称不能超过 40 个字符")
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		method := PaymentMethodView{ID: id, Name: label}
		if known, ok := catalog[id]; ok {
			method.Name = firstNonEmpty(label, known.Label)
			method.Icon = known.Icon
		}
		method.Name = firstNonEmpty(method.Name, id)
		methods = append(methods, method)
	}
	if len(methods) > 20 {
		return nil, BadAuthRequest("同一渠道最多启用 20 种支付方式")
	}
	return methods, nil
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
		manifest, _ := s.paymentManifestForProvider(descriptor.ID)
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
	manifest, ok := s.paymentManifestForProvider(descriptor.ID)
	if !ok {
		return nil, BadAuthRequest("支付插件清单不存在")
	}
	policy, ok := paymentExpiryPolicy(manifest, descriptor.ID)
	if !ok {
		return nil, BadAuthRequest("支付插件清单不存在")
	}
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
	if _, err := s.paymentProviderOptions(descriptor.ID, values); err != nil {
		return nil, err
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
	if manifest, ok := s.paymentManifestForProvider(descriptor.ID); ok {
		if policy, found := paymentExpiryPolicy(manifest, descriptor.ID); found {
			view.CloseAfterMinutes = policy.DefaultMinutes
		}
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

func (s *Service) paymentManifestForProvider(providerID string) (protocol.Manifest, bool) {
	providerID = strings.TrimSpace(providerID)
	if providerID == "" {
		return protocol.Manifest{}, false
	}
	if s != nil {
		for _, plugin := range s.Plugins() {
			for _, contribution := range plugin.Manifest.Contributes.PaymentProviders {
				if contribution.ID == providerID {
					return protocolManifestFromPluginView(plugin), true
				}
			}
		}
	}
	return bundledPaymentManifestForProvider(providerID)
}

func bundledPaymentManifestForProvider(providerID string) (protocol.Manifest, bool) {
	for _, manifest := range bundledPaymentPluginManifests() {
		for _, contribution := range manifest.Contributes.PaymentProviders {
			if contribution.ID == providerID {
				return manifest, true
			}
		}
	}
	return protocol.Manifest{}, false
}

func protocolManifestFromPluginView(plugin PluginView) protocol.Manifest {
	return protocol.Manifest{
		APIVersion: plugin.Manifest.APIVersion,
		Metadata: protocol.Metadata{
			ID: plugin.Manifest.ID, Version: plugin.Manifest.Version, Name: plugin.Manifest.Name,
			Vendor: plugin.Manifest.Author, Description: plugin.Manifest.Description,
			Documentation: plugin.Manifest.Documentation,
		},
		Surfaces:      plugin.Manifest.Surfaces,
		Runtime:       plugin.Manifest.Runtime,
		Permissions:   plugin.Manifest.Permissions,
		Configuration: plugin.Manifest.Configuration,
		Contributes:   plugin.Manifest.Contributes,
	}
}

func paymentExpiryPolicy(manifest protocol.Manifest, providerID string) (protocol.ManifestPaymentExpiryPolicy, bool) {
	for _, contribution := range manifest.Contributes.PaymentProviders {
		if contribution.ID == providerID {
			return contribution.ExpiryPolicy, true
		}
	}
	if len(manifest.Contributes.PaymentProviders) == 1 {
		return manifest.Contributes.PaymentProviders[0].ExpiryPolicy, true
	}
	return protocol.ManifestPaymentExpiryPolicy{}, false
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
