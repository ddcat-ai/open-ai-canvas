package service

import (
	"infinite-canvas/backend/internal/protocol"
)

const (
	PaymentPluginWeChatNative = "official-payment-wechat-native"
	PaymentPluginAlipayPage   = "official-payment-alipay-page"
	PaymentProviderWeChat     = "wechat-native"
	PaymentProviderAlipay     = "alipay-page-pay"
)

func bundledPaymentPluginManifests() []protocol.Manifest {
	return []protocol.Manifest{
		paymentPluginManifest(
			PaymentPluginWeChatNative,
			PaymentProviderWeChat,
			"微信支付 Native",
			"微信支付",
			"微信支付 Native 扫码充值适配器。",
			"host:wechatpay-v3-native",
			"brand:wechat-pay",
			"qr_code",
			wechatPaymentConfiguration(),
		),
		paymentPluginManifest(
			PaymentPluginAlipayPage,
			PaymentProviderAlipay,
			"支付宝电脑网站支付",
			"支付宝",
			"支付宝 alipay.trade.page.pay 电脑网站充值适配器。",
			"host:alipay-page-pay",
			"brand:alipay",
			"redirect",
			alipayPaymentConfiguration(),
		),
	}
}

func paymentPluginManifest(pluginID, providerID, name, vendor, description, runtime, icon, checkoutMode string, configuration protocol.ManifestConfiguration) protocol.Manifest {
	return protocol.Manifest{
		APIVersion: "yingce.plugin/v1",
		Metadata: protocol.Metadata{
			ID: pluginID, Version: "1.0.0", Name: name, Vendor: vendor,
			Description: description, Enabled: false, Installable: true,
			Documentation: "# " + name + "\n\n系统宿主支付适配器。后端负责密钥、验签、查单、关单和对账。",
		},
		Surfaces:      []string{"wallet", "settings"},
		Runtime:       protocol.ManifestRuntime{Backend: runtime, Web: "host"},
		Permissions:   []string{"payment.create", "payment.query", "payment.close", "payment.reconcile"},
		Configuration: configuration,
		Contributes: protocol.ManifestContributions{PaymentProviders: []protocol.ManifestPaymentProvider{{
			ID: providerID, Label: name, Icon: icon, CheckoutMode: checkoutMode,
			IdentityFields:      paymentIdentityFields(providerID),
			NotificationSuccess: paymentNotificationSuccess(providerID), NotificationFailure: paymentNotificationFailure(providerID),
			ExpiryPolicy: protocol.ManifestPaymentExpiryPolicy{DefaultMinutes: 30, MinMinutes: 5, MaxMinutes: 1440},
		}}},
	}
}

func paymentIdentityFields(providerID string) []string {
	switch providerID {
	case PaymentProviderWeChat:
		return []string{"appId", "mchId"}
	case PaymentProviderAlipay:
		return []string{"appId", "sellerId"}
	default:
		return nil
	}
}

func paymentNotificationSuccess(providerID string) protocol.ManifestPaymentResponse {
	if providerID == PaymentProviderAlipay {
		return protocol.ManifestPaymentResponse{Status: 200, ContentType: "text/plain; charset=utf-8", Body: "success"}
	}
	return protocol.ManifestPaymentResponse{Status: 204}
}

func paymentNotificationFailure(providerID string) protocol.ManifestPaymentResponse {
	if providerID == PaymentProviderAlipay {
		return protocol.ManifestPaymentResponse{Status: 400, ContentType: "text/plain; charset=utf-8", Body: "failure"}
	}
	return protocol.ManifestPaymentResponse{Status: 400}
}

func wechatPaymentConfiguration() protocol.ManifestConfiguration {
	return protocol.ManifestConfiguration{Fields: []protocol.ManifestField{
		{Name: "publicBaseUrl", Type: "url", Label: "服务器公网地址", Required: true, Description: "用于生成微信支付回调地址，必须可被微信访问。"},
		{Name: "appId", Type: "string", Label: "AppID", Required: true},
		{Name: "mchId", Type: "string", Label: "商户号", Required: true},
		{Name: "merchantSerialNo", Type: "string", Label: "商户证书序列号", Required: true},
		{Name: "merchantPrivateKey", Type: "textarea", Label: "商户 API 私钥", Required: true, Secret: true},
		{Name: "apiV3Key", Type: "password", Label: "APIv3 密钥", Required: true, Secret: true},
		{Name: "wechatPayPublicKeyId", Type: "string", Label: "微信支付公钥 ID", Required: true},
		{Name: "wechatPayPublicKey", Type: "textarea", Label: "微信支付公钥", Required: true, Secret: true},
	}}
}

func alipayPaymentConfiguration() protocol.ManifestConfiguration {
	return protocol.ManifestConfiguration{Fields: []protocol.ManifestField{
		{Name: "publicBaseUrl", Type: "url", Label: "服务器公网地址", Required: true, Description: "用于生成支付宝异步通知和同步返回地址。"},
		{Name: "appId", Type: "string", Label: "应用 AppID", Required: true},
		{Name: "sellerId", Type: "string", Label: "支付宝商户 PID", Required: true},
		{Name: "merchantPrivateKey", Type: "textarea", Label: "应用私钥", Required: true, Secret: true},
		{Name: "alipayPublicKey", Type: "textarea", Label: "支付宝公钥", Required: true, Secret: true},
		{Name: "gateway", Type: "url", Label: "支付宝网关", Required: true, Default: "https://openapi.alipay.com/gateway.do"},
	}}
}
