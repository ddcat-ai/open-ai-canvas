package service

import (
	"context"
	"net/http"
	"time"
)

type paymentPrepayRequest struct {
	AppID       string
	MerchantID  string
	Description string
	OutTradeNo  string
	NotifyURL   string
	AmountFen   int64
	ExpiresAt   time.Time
}

type paymentPrepayResult struct {
	CodeURL   string
	RequestID string
}

type paymentTransaction struct {
	AppID                 string
	MerchantID            string
	OutTradeNo            string
	TransactionID         string
	TradeState            string
	TradeStateDescription string
	AmountFen             int64
	Currency              string
	SuccessTime           string
}

type paymentNotification struct {
	ProviderEventID string
	EventType       string
	ResourceDigest  string
	Transaction     paymentTransaction
}

type paymentProvider interface {
	Prepay(context.Context, paymentPrepayRequest) (paymentPrepayResult, error)
	Query(context.Context, string) (paymentTransaction, error)
	Close(context.Context, string) error
	ParseNotification(context.Context, *http.Request) (paymentNotification, error)
	DownloadTradeBill(context.Context, string) ([]byte, string, error)
}
