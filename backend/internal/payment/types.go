package payment

import (
	"infinite-canvas/backend/internal/protocol"
	paymentsdk "infinite-canvas/backend/payment-sdk"
)

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

func DescriptorFromManifest(manifest protocol.Manifest, provider protocol.ManifestPaymentProvider) Descriptor {
	return Descriptor{
		ID: provider.ID, PluginID: manifest.Metadata.ID, PluginVersion: manifest.Metadata.Version, Name: provider.Label,
		Icon: provider.Icon, CheckoutMode: provider.CheckoutMode,
		IdentityFields:      append([]string(nil), provider.IdentityFields...),
		NotificationSuccess: NotificationResponse{Status: provider.NotificationSuccess.Status, ContentType: provider.NotificationSuccess.ContentType, Body: provider.NotificationSuccess.Body},
		NotificationFailure: NotificationResponse{Status: provider.NotificationFailure.Status, ContentType: provider.NotificationFailure.ContentType, Body: provider.NotificationFailure.Body},
	}
}
