package model

import "time"

// CreditPackage is an administrator-defined recharge product. Recharge orders
// copy all financial fields so historical orders are not affected by edits.
type CreditPackage struct {
	ID                string     `json:"id" gorm:"primaryKey;size:36"`
	Name              string     `json:"name" gorm:"size:120;not null"`
	Description       string     `json:"description,omitempty" gorm:"size:500"`
	Currency          string     `json:"currency" gorm:"size:12;not null;default:CNY"`
	AmountFen         int64      `json:"amountFen" gorm:"not null"`
	BaseMicrocredits  int64      `json:"baseMicrocredits" gorm:"not null"`
	BonusMicrocredits int64      `json:"bonusMicrocredits" gorm:"not null;default:0"`
	Enabled           bool       `json:"enabled" gorm:"index;not null;default:false"`
	SortOrder         int        `json:"sortOrder" gorm:"index;not null;default:0"`
	Version           int64      `json:"version" gorm:"not null;default:1"`
	CreatedBy         string     `json:"createdBy" gorm:"size:36;index"`
	UpdatedBy         string     `json:"updatedBy" gorm:"size:36;index"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	ArchivedAt        *time.Time `json:"archivedAt,omitempty" gorm:"index"`
}

// PaymentChannel identifies one administrator-configured payment entry point.
// Secrets live in immutable PaymentChannelConfigVersion rows.
type PaymentChannel struct {
	ID                    string     `json:"id" gorm:"primaryKey;size:36"`
	Provider              string     `json:"provider" gorm:"size:48;index;not null"`
	Method                string     `json:"method" gorm:"size:48;index;not null"`
	Name                  string     `json:"name" gorm:"size:120;not null"`
	Description           string     `json:"description,omitempty" gorm:"size:500"`
	Enabled               bool       `json:"enabled" gorm:"index;not null;default:false"`
	SortOrder             int        `json:"sortOrder" gorm:"index;not null;default:0"`
	ActiveConfigVersionID string     `json:"activeConfigVersionId,omitempty" gorm:"size:36;index"`
	LastTestStatus        string     `json:"lastTestStatus,omitempty" gorm:"size:24"`
	LastTestError         string     `json:"lastTestError,omitempty" gorm:"size:1000"`
	LastTestConfigDigest  string     `json:"lastTestConfigDigest,omitempty" gorm:"size:80"`
	LastTestedAt          *time.Time `json:"lastTestedAt,omitempty"`
	CreatedBy             string     `json:"createdBy" gorm:"size:36;index"`
	UpdatedBy             string     `json:"updatedBy" gorm:"size:36;index"`
	CreatedAt             time.Time  `json:"createdAt"`
	UpdatedAt             time.Time  `json:"updatedAt"`
	ArchivedAt            *time.Time `json:"archivedAt,omitempty" gorm:"index"`
}

type PaymentChannelConfigVersion struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	ChannelID    string    `json:"channelId" gorm:"size:36;index;uniqueIndex:idx_payment_channel_config_version,priority:1"`
	Version      int64     `json:"version" gorm:"uniqueIndex:idx_payment_channel_config_version,priority:2"`
	ConfigCipher string    `json:"-" gorm:"type:text;not null"`
	ConfigDigest string    `json:"configDigest" gorm:"size:80;not null"`
	CreatedBy    string    `json:"createdBy" gorm:"size:36;index"`
	CreatedAt    time.Time `json:"createdAt" gorm:"index"`
}

// CreditRechargeOrder is an immutable financial snapshot plus a small payment
// state machine. There is intentionally no refund state or refund amount.
type CreditRechargeOrder struct {
	ID                    string                    `json:"id" gorm:"primaryKey;size:36"`
	UserID                string                    `json:"userId" gorm:"size:36;index;uniqueIndex:idx_recharge_user_idempotency,priority:1"`
	IdempotencyKey        string                    `json:"idempotencyKey" gorm:"size:160;uniqueIndex:idx_recharge_user_idempotency,priority:2"`
	PackageID             string                    `json:"packageId" gorm:"size:36;index"`
	PackageVersion        int64                     `json:"packageVersion"`
	PackageName           string                    `json:"packageName" gorm:"size:120"`
	Currency              string                    `json:"currency" gorm:"size:12"`
	AmountFen             int64                     `json:"amountFen"`
	BaseMicrocredits      int64                     `json:"baseMicrocredits"`
	BonusMicrocredits     int64                     `json:"bonusMicrocredits"`
	TotalMicrocredits     int64                     `json:"totalMicrocredits"`
	ChannelID             string                    `json:"channelId" gorm:"size:36;index"`
	ChannelName           string                    `json:"channelName" gorm:"size:120"`
	Provider              string                    `json:"provider" gorm:"size:48;index;uniqueIndex:idx_recharge_provider_transaction,priority:1"`
	Method                string                    `json:"method" gorm:"size:48;index"`
	ConfigVersionID       string                    `json:"configVersionId" gorm:"size:36;index"`
	Status                CreditRechargeOrderStatus `json:"status" gorm:"size:32;index"`
	ProviderState         string                    `json:"providerState,omitempty" gorm:"size:48;index"`
	ProviderTransactionID *string                   `json:"providerTransactionId,omitempty" gorm:"size:160;uniqueIndex:idx_recharge_provider_transaction,priority:2"`
	PrepayID              string                    `json:"prepayId,omitempty" gorm:"size:160"`
	PayPayloadCipher      string                    `json:"-" gorm:"type:text"`
	FailureCode           string                    `json:"failureCode,omitempty" gorm:"size:80"`
	FailureMessage        string                    `json:"failureMessage,omitempty" gorm:"size:1000"`
	ExpiresAt             *time.Time                `json:"expiresAt,omitempty" gorm:"index"`
	PaidAt                *time.Time                `json:"paidAt,omitempty" gorm:"index"`
	CreditedAt            *time.Time                `json:"creditedAt,omitempty" gorm:"index"`
	ClosedAt              *time.Time                `json:"closedAt,omitempty" gorm:"index"`
	LedgerEntryID         *string                   `json:"ledgerEntryId,omitempty" gorm:"size:36;uniqueIndex"`
	LastQueryAt           *time.Time                `json:"lastQueryAt,omitempty"`
	QueryAttempts         int                       `json:"queryAttempts"`
	NextQueryAt           *time.Time                `json:"nextQueryAt,omitempty" gorm:"index"`
	LastReconciledAt      *time.Time                `json:"lastReconciledAt,omitempty" gorm:"index"`
	CreatedAt             time.Time                 `json:"createdAt" gorm:"index"`
	UpdatedAt             time.Time                 `json:"updatedAt"`
}

type PaymentNotificationEvent struct {
	ID              string                    `json:"id" gorm:"primaryKey;size:36"`
	Provider        string                    `json:"provider" gorm:"size:48;index;uniqueIndex:idx_payment_notification_event,priority:1"`
	EventID         string                    `json:"eventId" gorm:"size:160;uniqueIndex:idx_payment_notification_event,priority:2"`
	ChannelID       string                    `json:"channelId" gorm:"size:36;index"`
	ConfigVersionID string                    `json:"configVersionId" gorm:"size:36;index"`
	OrderID         string                    `json:"orderId,omitempty" gorm:"size:36;index"`
	ResourceType    string                    `json:"resourceType,omitempty" gorm:"size:80"`
	Summary         string                    `json:"summary,omitempty" gorm:"size:500"`
	RawBodyCipher   string                    `json:"-" gorm:"type:text"`
	HeadersJSON     string                    `json:"-" gorm:"type:text"`
	Status          PaymentNotificationStatus `json:"status" gorm:"size:24;index"`
	Error           string                    `json:"error,omitempty" gorm:"size:1000"`
	ReceivedAt      time.Time                 `json:"receivedAt" gorm:"index"`
	ProcessedAt     *time.Time                `json:"processedAt,omitempty"`
}

type PaymentReconciliationRun struct {
	ID                 string                      `json:"id" gorm:"primaryKey;size:36"`
	ChannelID          string                      `json:"channelId" gorm:"size:36;index"`
	Provider           string                      `json:"provider" gorm:"size:48;index"`
	TradeDate          string                      `json:"tradeDate" gorm:"size:10;index"`
	Status             PaymentReconciliationStatus `json:"status" gorm:"size:24;index"`
	ProviderOrderCount int64                       `json:"providerOrderCount"`
	ProviderAmountFen  int64                       `json:"providerAmountFen"`
	LocalOrderCount    int64                       `json:"localOrderCount"`
	LocalAmountFen     int64                       `json:"localAmountFen"`
	AnomalyCount       int64                       `json:"anomalyCount"`
	StatementDigest    string                      `json:"statementDigest,omitempty" gorm:"size:80"`
	Error              string                      `json:"error,omitempty" gorm:"size:1000"`
	RequestedBy        string                      `json:"requestedBy" gorm:"size:36;index"`
	StartedAt          *time.Time                  `json:"startedAt,omitempty"`
	CompletedAt        *time.Time                  `json:"completedAt,omitempty"`
	CreatedAt          time.Time                   `json:"createdAt" gorm:"index"`
}

type PaymentReconciliationAnomaly struct {
	ID                    string     `json:"id" gorm:"primaryKey;size:36"`
	RunID                 string     `json:"runId" gorm:"size:36;index"`
	OrderID               string     `json:"orderId,omitempty" gorm:"size:36;index"`
	Type                  string     `json:"type" gorm:"size:48;index"`
	ProviderTransactionID string     `json:"providerTransactionId,omitempty" gorm:"size:160;index"`
	ExpectedAmountFen     int64      `json:"expectedAmountFen"`
	ActualAmountFen       int64      `json:"actualAmountFen"`
	Detail                string     `json:"detail,omitempty" gorm:"size:1000"`
	Resolved              bool       `json:"resolved" gorm:"index;not null;default:false"`
	ResolvedBy            string     `json:"resolvedBy,omitempty" gorm:"size:36;index"`
	ResolutionNote        string     `json:"resolutionNote,omitempty" gorm:"size:500"`
	ResolvedAt            *time.Time `json:"resolvedAt,omitempty"`
	CreatedAt             time.Time  `json:"createdAt" gorm:"index"`
}
