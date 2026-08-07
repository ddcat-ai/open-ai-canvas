package model

import "time"

type CreditAccount struct {
	UserID                string    `json:"userId" gorm:"primaryKey;size:36"`
	AvailableMicrocredits int64     `json:"availableMicrocredits"`
	ReservedMicrocredits  int64     `json:"reservedMicrocredits"`
	Version               int64     `json:"version"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type CreditLedgerEntry struct {
	ID                         string           `json:"id" gorm:"primaryKey;size:36"`
	UserID                     string           `json:"userId" gorm:"size:36;index;index:idx_credit_ledger_user_created,priority:1"`
	Type                       CreditLedgerType `json:"type" gorm:"size:32;index"`
	AmountMicrocredits         int64            `json:"amountMicrocredits"`
	AvailableDeltaMicrocredits int64            `json:"availableDeltaMicrocredits"`
	ReservedDeltaMicrocredits  int64            `json:"reservedDeltaMicrocredits"`
	AvailableAfterMicrocredits int64            `json:"availableAfterMicrocredits"`
	ReservedAfterMicrocredits  int64            `json:"reservedAfterMicrocredits"`
	BillingOrderID             string           `json:"billingOrderId,omitempty" gorm:"index;size:36"`
	RedeemCodeID               string           `json:"redeemCodeId,omitempty" gorm:"index;size:36"`
	ActorUserID                string           `json:"actorUserId,omitempty" gorm:"index;size:36"`
	Model                      string           `json:"model,omitempty" gorm:"size:120;index"`
	ChannelID                  string           `json:"channelId,omitempty" gorm:"size:36;index"`
	Scene                      string           `json:"scene,omitempty" gorm:"size:80;index"`
	Note                       string           `json:"note,omitempty" gorm:"size:500"`
	ReferenceKey               *string          `json:"referenceKey,omitempty" gorm:"size:180;uniqueIndex"`
	CreatedAt                  time.Time        `json:"createdAt" gorm:"index:idx_credit_ledger_user_created,priority:2"`
}

type BillingOrder struct {
	ID                           string        `json:"id" gorm:"primaryKey;size:36"`
	UserID                       string        `json:"userId" gorm:"size:36;index;uniqueIndex:idx_billing_user_idempotency,priority:1"`
	IdempotencyKey               string        `json:"idempotencyKey" gorm:"size:160;uniqueIndex:idx_billing_user_idempotency,priority:2"`
	TaskID                       string        `json:"taskId,omitempty" gorm:"index;size:36"`
	ChannelID                    string        `json:"channelId" gorm:"index;size:36"`
	ChannelModelID               string        `json:"channelModelId" gorm:"index;size:36"`
	Model                        string        `json:"model" gorm:"index;size:120"`
	Capability                   string        `json:"capability" gorm:"index;size:32"`
	Scene                        string        `json:"scene" gorm:"index;size:80"`
	BillingMode                  string        `json:"billingMode" gorm:"size:32"`
	PriceVersion                 int64         `json:"priceVersion"`
	UnitPriceMicrocredits        int64         `json:"unitPriceMicrocredits"`
	MultiplierBasisPoints        int64         `json:"multiplierBasisPoints"`
	Quantity                     int64         `json:"quantity"`
	AmountMicrocredits           int64         `json:"amountMicrocredits"`
	ReservedAmountMicrocredits   int64         `json:"reservedAmountMicrocredits"`
	ActualAmountMicrocredits     int64         `json:"actualAmountMicrocredits"`
	RefundedAmountMicrocredits   int64         `json:"refundedAmountMicrocredits"`
	InputTokenPriceMicrocredits  int64         `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits int64         `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits int64         `json:"cachedTokenPriceMicrocredits"`
	InputTokens                  int64         `json:"inputTokens"`
	OutputTokens                 int64         `json:"outputTokens"`
	CachedTokens                 int64         `json:"cachedTokens"`
	UsageAvailable               bool          `json:"usageAvailable"`
	Status                       BillingStatus `json:"status" gorm:"index;size:24"`
	ProviderRequestID            string        `json:"providerRequestId,omitempty" gorm:"index;size:160"`
	Error                        string        `json:"error,omitempty" gorm:"size:1000"`
	ResolvedBy                   string        `json:"resolvedBy,omitempty" gorm:"index;size:36"`
	ResolutionNote               string        `json:"resolutionNote,omitempty" gorm:"size:500"`
	StartedAt                    *time.Time    `json:"startedAt"`
	SettledAt                    *time.Time    `json:"settledAt"`
	RefundedAt                   *time.Time    `json:"refundedAt"`
	CreatedAt                    time.Time     `json:"createdAt" gorm:"index"`
	UpdatedAt                    time.Time     `json:"updatedAt"`
}

type RedeemBatch struct {
	ID                 string     `json:"id" gorm:"primaryKey;size:36"`
	AmountMicrocredits int64      `json:"amountMicrocredits"`
	Count              int        `json:"count"`
	Note               string     `json:"note" gorm:"size:500"`
	CreatedBy          string     `json:"createdBy" gorm:"index;size:36"`
	CodesCipher        string     `json:"-" gorm:"type:text"`
	ExpiresAt          *time.Time `json:"expiresAt" gorm:"index"`
	CreatedAt          time.Time  `json:"createdAt" gorm:"index"`
	AvailableCount     int64      `json:"availableCount" gorm:"->;-:migration"`
	RedeemedCount      int64      `json:"redeemedCount" gorm:"->;-:migration"`
	DisabledCount      int64      `json:"disabledCount" gorm:"->;-:migration"`
	ExpiredCount       int64      `json:"expiredCount" gorm:"->;-:migration"`
}

type RedeemCode struct {
	ID                 string           `json:"id" gorm:"primaryKey;size:36"`
	BatchID            string           `json:"batchId" gorm:"index;size:36;index:idx_redeem_codes_batch_status,priority:1;index:idx_redeem_codes_batch_created,priority:1"`
	CodeHash           string           `json:"-" gorm:"uniqueIndex;size:64"`
	CodeSuffix         string           `json:"codeSuffix" gorm:"size:4"`
	AmountMicrocredits int64            `json:"amountMicrocredits"`
	Status             RedeemCodeStatus `json:"status" gorm:"index;size:24;index:idx_redeem_codes_batch_status,priority:2"`
	RedeemedBy         string           `json:"redeemedBy,omitempty" gorm:"index;size:36"`
	RedeemedAt         *time.Time       `json:"redeemedAt"`
	RedeemedIP         string           `json:"redeemedIp,omitempty" gorm:"size:64"`
	ExpiresAt          *time.Time       `json:"expiresAt" gorm:"index"`
	CreatedAt          time.Time        `json:"createdAt" gorm:"index:idx_redeem_codes_batch_created,priority:2"`
	UpdatedAt          time.Time        `json:"updatedAt"`
}

type ModelPricing struct {
	ID                     string    `json:"id" gorm:"primaryKey;size:36"`
	ChannelID              string    `json:"channelId" gorm:"size:36;uniqueIndex:idx_model_pricing_scope,priority:1"`
	Model                  string    `json:"model" gorm:"size:120;uniqueIndex:idx_model_pricing_scope,priority:2"`
	Capability             string    `json:"capability" gorm:"size:32;uniqueIndex:idx_model_pricing_scope,priority:3"`
	Currency               string    `json:"currency" gorm:"size:12"`
	InputPerMillionMicros  int64     `json:"inputPerMillionMicros"`
	OutputPerMillionMicros int64     `json:"outputPerMillionMicros"`
	CachedPerMillionMicros int64     `json:"cachedPerMillionMicros"`
	PerRequestMicros       int64     `json:"perRequestMicros"`
	PerMediaMicros         int64     `json:"perMediaMicros"`
	PerVideoSecondMicros   int64     `json:"perVideoSecondMicros"`
	CreatedAt              time.Time `json:"createdAt"`
	UpdatedAt              time.Time `json:"updatedAt"`
}
