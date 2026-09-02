package model

import "time"

type PaymentOrderStatus string
type PaymentNotificationStatus string
type PaymentReconciliationStatus string
type PaymentReconciliationResult string

const (
	PaymentOrderCreated      PaymentOrderStatus = "created"
	PaymentOrderPending      PaymentOrderStatus = "pending"
	PaymentOrderClosing      PaymentOrderStatus = "closing"
	PaymentOrderClosed       PaymentOrderStatus = "closed"
	PaymentOrderCredited     PaymentOrderStatus = "credited"
	PaymentOrderCreateFailed PaymentOrderStatus = "create_failed"

	PaymentNotificationPending   PaymentNotificationStatus = "pending"
	PaymentNotificationProcessed PaymentNotificationStatus = "processed"
	PaymentNotificationFailed    PaymentNotificationStatus = "failed"

	PaymentReconciliationRunning   PaymentReconciliationStatus = "running"
	PaymentReconciliationCompleted PaymentReconciliationStatus = "completed"
	PaymentReconciliationFailed    PaymentReconciliationStatus = "failed"

	PaymentReconciliationMatched               PaymentReconciliationResult = "matched"
	PaymentReconciliationRecovered             PaymentReconciliationResult = "recovered"
	PaymentReconciliationLocalOrderNotFound    PaymentReconciliationResult = "local_order_not_found"
	PaymentReconciliationProviderRecordMissing PaymentReconciliationResult = "provider_record_missing"
	PaymentReconciliationAmountMismatch        PaymentReconciliationResult = "amount_mismatch"
	PaymentReconciliationTradeNoMismatch       PaymentReconciliationResult = "trade_no_mismatch"
	PaymentReconciliationCreditFailed          PaymentReconciliationResult = "credit_failed"
)

// TopupProduct is the server-owned price and credit snapshot source. Clients
// select a product ID and can never submit their own payable amount or credits.
type TopupProduct struct {
	ID                  string    `json:"id" gorm:"primaryKey;size:36"`
	Name                string    `json:"name" gorm:"size:120"`
	Description         string    `json:"description,omitempty" gorm:"size:500"`
	AmountFen           int64     `json:"amountFen" gorm:"index"`
	CreditsMicrocredits int64     `json:"creditsMicrocredits"`
	Enabled             bool      `json:"enabled" gorm:"index"`
	SortOrder           int       `json:"sortOrder" gorm:"index"`
	CreatedBy           string    `json:"createdBy" gorm:"index;size:36"`
	UpdatedBy           string    `json:"updatedBy" gorm:"index;size:36"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

// PaymentProviderConfig is immutable and versioned. Payment orders pin one
// version so key rotation cannot make an older callback unverifiable.
type PaymentProviderConfig struct {
	ID                string    `json:"id" gorm:"primaryKey;size:36"`
	ProviderID        string    `json:"providerId" gorm:"size:80;index;uniqueIndex:idx_payment_provider_version,priority:1"`
	PluginID          string    `json:"pluginId" gorm:"size:120;index"`
	PluginVersion     string    `json:"pluginVersion" gorm:"size:40"`
	Version           int64     `json:"version" gorm:"uniqueIndex:idx_payment_provider_version,priority:2"`
	Enabled           bool      `json:"enabled" gorm:"index"`
	CloseAfterMinutes int       `json:"closeAfterMinutes"`
	ConfigCipher      string    `json:"-" gorm:"type:text"`
	ConfigDigest      string    `json:"configDigest" gorm:"size:64"`
	CreatedBy         string    `json:"createdBy" gorm:"index;size:36"`
	CreatedAt         time.Time `json:"createdAt" gorm:"index"`
}

type PaymentOrder struct {
	ID                    string             `json:"id" gorm:"primaryKey;size:36"`
	UserID                string             `json:"userId" gorm:"size:36;index;uniqueIndex:idx_payment_user_idempotency,priority:1"`
	IdempotencyKey        string             `json:"idempotencyKey" gorm:"size:120;uniqueIndex:idx_payment_user_idempotency,priority:2"`
	MerchantOrderNo       string             `json:"merchantOrderNo" gorm:"size:32;uniqueIndex"`
	ProductID             string             `json:"productId" gorm:"size:36;index"`
	ProductName           string             `json:"productName" gorm:"size:120"`
	ProviderID            string             `json:"providerId" gorm:"size:80;index;uniqueIndex:idx_payment_provider_trade,priority:1"`
	PluginID              string             `json:"pluginId" gorm:"size:120;index"`
	PluginVersion         string             `json:"pluginVersion" gorm:"size:40"`
	ProviderConfigID      string             `json:"providerConfigId" gorm:"size:36;index"`
	ProviderConfigVersion int64              `json:"providerConfigVersion"`
	AmountFen             int64              `json:"amountFen"`
	Currency              string             `json:"currency" gorm:"size:8"`
	CreditsMicrocredits   int64              `json:"creditsMicrocredits"`
	Status                PaymentOrderStatus `json:"status" gorm:"size:24;index;index:idx_payment_order_status_expiry,priority:1"`
	ProviderTradeNo       *string            `json:"providerTradeNo,omitempty" gorm:"size:96;uniqueIndex:idx_payment_provider_trade,priority:2"`
	ProviderStatus        string             `json:"providerStatus,omitempty" gorm:"size:40;index"`
	CheckoutMode          string             `json:"checkoutMode,omitempty" gorm:"size:24"`
	CheckoutValue         string             `json:"-" gorm:"type:text"`
	CheckoutExpiresAt     *time.Time         `json:"checkoutExpiresAt,omitempty"`
	ExpiresAt             time.Time          `json:"expiresAt" gorm:"index:idx_payment_order_status_expiry,priority:2"`
	ProviderPaidAt        *time.Time         `json:"providerPaidAt,omitempty" gorm:"index"`
	CreditedAt            *time.Time         `json:"creditedAt,omitempty" gorm:"index"`
	ClosedAt              *time.Time         `json:"closedAt,omitempty" gorm:"index"`
	LastQueriedAt         *time.Time         `json:"lastQueriedAt,omitempty"`
	LastError             string             `json:"lastError,omitempty" gorm:"size:1000"`
	CreatedAt             time.Time          `json:"createdAt" gorm:"index"`
	UpdatedAt             time.Time          `json:"updatedAt"`
}

// PaymentNotification is a durable, verified inbox. NormalizedJSON contains
// only the provider-neutral evidence required by the asynchronous credit job.
type PaymentNotification struct {
	ID               string                    `json:"id" gorm:"primaryKey;size:36"`
	ProviderID       string                    `json:"providerId" gorm:"size:80;index;uniqueIndex:idx_payment_provider_event,priority:1"`
	ProviderEventID  string                    `json:"providerEventId" gorm:"size:160;uniqueIndex:idx_payment_provider_event,priority:2"`
	ProviderConfigID string                    `json:"providerConfigId" gorm:"size:36;index"`
	MerchantOrderNo  string                    `json:"merchantOrderNo,omitempty" gorm:"size:32;index"`
	PaymentOrderID   string                    `json:"paymentOrderId,omitempty" gorm:"size:36;index"`
	PayloadDigest    string                    `json:"payloadDigest" gorm:"size:64"`
	PayloadCipher    string                    `json:"-" gorm:"type:text"`
	NormalizedJSON   string                    `json:"-" gorm:"type:text"`
	Status           PaymentNotificationStatus `json:"status" gorm:"size:24;index"`
	Attempts         int                       `json:"attempts"`
	LastError        string                    `json:"lastError,omitempty" gorm:"size:1000"`
	NextAttemptAt    time.Time                 `json:"nextAttemptAt" gorm:"index"`
	ProcessedAt      *time.Time                `json:"processedAt,omitempty"`
	CreatedAt        time.Time                 `json:"createdAt" gorm:"index"`
	UpdatedAt        time.Time                 `json:"updatedAt"`
}

type PaymentReconciliationRun struct {
	ID             string                      `json:"id" gorm:"primaryKey;size:36"`
	ProviderID     string                      `json:"providerId" gorm:"size:80;index;uniqueIndex:idx_payment_reconciliation_date,priority:1"`
	ConfigID       string                      `json:"configId" gorm:"size:36;index"`
	BillDate       string                      `json:"billDate" gorm:"size:10;index;uniqueIndex:idx_payment_reconciliation_date,priority:2"`
	Status         PaymentReconciliationStatus `json:"status" gorm:"size:24;index"`
	TotalItems     int                         `json:"totalItems"`
	MatchItems     int                         `json:"matchItems"`
	RecoveredItems int                         `json:"recoveredItems"`
	ErrorItems     int                         `json:"errorItems"`
	Error          string                      `json:"error,omitempty" gorm:"size:1000"`
	StartedBy      string                      `json:"startedBy,omitempty" gorm:"size:36;index"`
	StartedAt      time.Time                   `json:"startedAt"`
	CompletedAt    *time.Time                  `json:"completedAt,omitempty"`
	CreatedAt      time.Time                   `json:"createdAt"`
	UpdatedAt      time.Time                   `json:"updatedAt"`
}

type PaymentReconciliationItem struct {
	ID              string                      `json:"id" gorm:"primaryKey;size:36"`
	RunID           string                      `json:"runId" gorm:"size:36;index"`
	ProviderID      string                      `json:"providerId" gorm:"size:80;index"`
	PaymentOrderID  string                      `json:"paymentOrderId,omitempty" gorm:"size:36;index"`
	MerchantOrderNo string                      `json:"merchantOrderNo" gorm:"size:32;index"`
	ProviderTradeNo string                      `json:"providerTradeNo,omitempty" gorm:"size:96;index"`
	AmountFen       int64                       `json:"amountFen"`
	Currency        string                      `json:"currency" gorm:"size:8"`
	Result          PaymentReconciliationResult `json:"result" gorm:"size:48;index"`
	Resolved        bool                        `json:"resolved" gorm:"index"`
	Detail          string                      `json:"detail,omitempty" gorm:"size:1000"`
	CreatedAt       time.Time                   `json:"createdAt"`
}
