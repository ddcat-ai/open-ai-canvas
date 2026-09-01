package payment

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

var ErrProviderNotFound = errors.New("payment provider not found")

type ConfigField struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Kind        string `json:"kind"`
	Required    bool   `json:"required"`
	Secret      bool   `json:"secret"`
	Placeholder string `json:"placeholder,omitempty"`
}

type Descriptor struct {
	Code         string        `json:"code"`
	Name         string        `json:"name"`
	Methods      []string      `json:"methods"`
	ConfigFields []ConfigField `json:"configFields"`
}

type CreatePaymentRequest struct {
	OrderID     string
	Description string
	AmountFen   int64
	Currency    string
	NotifyURL   string
	ExpiresAt   time.Time
	ClientIP    string
}

type CreatePaymentResult struct {
	PrepayID   string         `json:"prepayId,omitempty"`
	PayPayload map[string]any `json:"payPayload"`
	ExpiresAt  time.Time      `json:"expiresAt"`
}

type PaymentStatus struct {
	OrderID               string    `json:"orderId"`
	State                 string    `json:"state"`
	StateDescription      string    `json:"stateDescription,omitempty"`
	ProviderTransactionID string    `json:"providerTransactionId,omitempty"`
	AmountFen             int64     `json:"amountFen,omitempty"`
	Currency              string    `json:"currency,omitempty"`
	PaidAt                time.Time `json:"paidAt,omitempty"`
}

func (s PaymentStatus) Paid() bool { return strings.EqualFold(s.State, "SUCCESS") }

type PaymentNotification struct {
	EventID               string
	EventType             string
	ResourceType          string
	Summary               string
	OrderID               string
	State                 string
	ProviderTransactionID string
	AmountFen             int64
	Currency              string
	PaidAt                time.Time
}

type TradeBill struct {
	TradeDate   string
	Content     []byte
	Digest      string
	ContentType string
}

type Provider interface {
	Descriptor() Descriptor
	ValidateConfig(ctx context.Context, config json.RawMessage) error
	TestConnection(ctx context.Context, config json.RawMessage) error
	CreatePayment(ctx context.Context, config json.RawMessage, request CreatePaymentRequest) (*CreatePaymentResult, error)
	QueryPayment(ctx context.Context, config json.RawMessage, orderID string) (*PaymentStatus, error)
	ClosePayment(ctx context.Context, config json.RawMessage, orderID string) error
	ParseNotification(ctx context.Context, config json.RawMessage, request *http.Request) (*PaymentNotification, error)
	DownloadTradeBill(ctx context.Context, config json.RawMessage, tradeDate string) (*TradeBill, error)
}

type ProviderError struct {
	Code      string
	Retryable bool
	Uncertain bool
	Err       error
}

func (e *ProviderError) Error() string {
	if e.Err == nil {
		return e.Code
	}
	return fmt.Sprintf("%s: %v", e.Code, e.Err)
}

func (e *ProviderError) Unwrap() error { return e.Err }

type Registry struct {
	providers map[string]Provider
}

func NewRegistry(providers ...Provider) *Registry {
	r := &Registry{providers: make(map[string]Provider, len(providers))}
	for _, provider := range providers {
		r.Register(provider)
	}
	return r
}

func (r *Registry) Register(provider Provider) {
	if provider == nil {
		return
	}
	code := strings.ToLower(strings.TrimSpace(provider.Descriptor().Code))
	if code != "" {
		r.providers[code] = provider
	}
}

func (r *Registry) Get(code string) (Provider, error) {
	provider, ok := r.providers[strings.ToLower(strings.TrimSpace(code))]
	if !ok {
		return nil, ErrProviderNotFound
	}
	return provider, nil
}

func (r *Registry) Descriptors() []Descriptor {
	items := make([]Descriptor, 0, len(r.providers))
	for _, provider := range r.providers {
		items = append(items, provider.Descriptor())
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Code < items[j].Code })
	return items
}
