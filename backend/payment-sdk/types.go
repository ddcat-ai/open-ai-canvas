package paymentsdk

import (
	"context"
	"errors"
	"net/http"
	"time"
)

var (
	ErrOrderNotFound     = errors.New("payment provider order not found")
	ErrOrderNotPaid      = errors.New("payment provider order is not paid")
	ErrTradeBillNotFound = errors.New("payment provider trade bill not found")
)

type Config map[string]string

type Descriptor struct {
	ID                  string               `json:"id"`
	PluginID            string               `json:"pluginId"`
	PluginVersion       string               `json:"pluginVersion,omitempty"`
	Name                string               `json:"name"`
	Icon                string               `json:"icon"`
	CheckoutMode        string               `json:"checkoutMode"`
	IdentityFields      []string             `json:"identityFields,omitempty"`
	NotificationSuccess NotificationResponse `json:"notificationSuccess,omitempty"`
	NotificationFailure NotificationResponse `json:"notificationFailure,omitempty"`
}

type NotificationResponse struct {
	Status      int
	ContentType string
	Body        string
}

// CreateRequest 的 AmountFen / Currency 是渠道实收金额与结算货币：商品货币不同时宿主已按汇率换算。
// Method 是用户在渠道内选中的支付方式（如易支付的 alipay / wxpay），渠道没有声明支付方式时为空；
// 旧插件忽略该字段即可保持原行为。
type CreateRequest struct {
	MerchantOrderNo string
	Description     string
	AmountFen       int64
	Currency        string
	Method          string `json:",omitempty"`
	ExpiresAt       time.Time
	NotifyURL       string
	ReturnURL       string
}

type Checkout struct {
	Mode      string
	Value     string
	ExpiresAt time.Time
}

type QueryRequest struct{ MerchantOrderNo string }
type CloseRequest struct{ MerchantOrderNo string }

type Result struct {
	MerchantOrderNo string    `json:"merchantOrderNo"`
	ProviderTradeNo string    `json:"providerTradeNo,omitempty"`
	ProviderStatus  string    `json:"providerStatus"`
	AmountFen       int64     `json:"amountFen"`
	Currency        string    `json:"currency"`
	Paid            bool      `json:"paid"`
	Closed          bool      `json:"closed"`
	PaidAt          time.Time `json:"paidAt,omitempty"`
}

type Notification struct {
	EventID string `json:"eventId"`
	Result
}

type BillRecord struct {
	MerchantOrderNo string
	ProviderTradeNo string
	ProviderStatus  string
	AmountFen       int64
	Currency        string
	PaidAt          time.Time
}

type Provider interface {
	Descriptor() Descriptor
	ValidateConfig(Config) error
	CreateOrder(context.Context, Config, CreateRequest) (Checkout, error)
	QueryOrder(context.Context, Config, QueryRequest) (Result, error)
	CloseOrder(context.Context, Config, CloseRequest) (Result, error)
	VerifyNotification(context.Context, Config, http.Header, []byte) (Notification, error)
	DownloadTradeBill(context.Context, Config, time.Time) ([]BillRecord, error)
}

type ProviderError struct {
	Code      string
	Message   string
	Temporary bool
	Cause     error
}

func (e *ProviderError) Error() string {
	if e == nil {
		return ""
	}
	if e.Message != "" {
		return e.Message
	}
	return e.Code
}
func (e *ProviderError) Unwrap() error { return e.Cause }
