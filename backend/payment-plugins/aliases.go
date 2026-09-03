package paymentplugins

import paymentsdk "infinite-canvas/backend/payment-sdk"

type Config = paymentsdk.Config
type Descriptor = paymentsdk.Descriptor
type NotificationResponse = paymentsdk.NotificationResponse
type CreateRequest = paymentsdk.CreateRequest
type Checkout = paymentsdk.Checkout
type QueryRequest = paymentsdk.QueryRequest
type CloseRequest = paymentsdk.CloseRequest
type Result = paymentsdk.Result
type Notification = paymentsdk.Notification
type BillRecord = paymentsdk.BillRecord
type Provider = paymentsdk.Provider
type ProviderError = paymentsdk.ProviderError

var (
	ErrOrderNotFound     = paymentsdk.ErrOrderNotFound
	ErrOrderNotPaid      = paymentsdk.ErrOrderNotPaid
	ErrTradeBillNotFound = paymentsdk.ErrTradeBillNotFound
)

const (
	ProviderWeChatNative = "wechat-native"
	ProviderAlipayPage   = "alipay-page-pay"
	PluginWeChatNative   = "official-payment-wechat-native"
	PluginAlipayPage     = "official-payment-alipay-page"
)
