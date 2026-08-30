package model

import "time"

const (
	PaymentProviderWechatPay = "wechatpay"
	PaymentMethodNative      = "native"
	PaymentVerifyPublicKey   = "public_key"
	PaymentVerifyCertificate = "platform_certificate"
)

// PaymentChannel 保存不敏感、可变的运营配置。密钥和商户身份保存在不可变版本中。
type PaymentChannel struct {
	ID                 string    `json:"id" gorm:"primaryKey;size:36"`
	Code               string    `json:"code" gorm:"size:48;uniqueIndex"`
	Name               string    `json:"name" gorm:"size:120"`
	Provider           string    `json:"provider" gorm:"size:32;index"`
	PaymentMethod      string    `json:"paymentMethod" gorm:"size:24"`
	Enabled            bool      `json:"enabled" gorm:"index"`
	IsDefault          bool      `json:"isDefault" gorm:"index"`
	ActiveVersionID    string    `json:"activeVersionId,omitempty" gorm:"size:36;index"`
	NotifyBaseURL      string    `json:"notifyBaseUrl" gorm:"size:500"`
	OrderExpireMinutes int       `json:"orderExpireMinutes"`
	CreatedBy          string    `json:"createdBy" gorm:"size:36;index"`
	UpdatedBy          string    `json:"updatedBy" gorm:"size:36;index"`
	CreatedAt          time.Time `json:"createdAt" gorm:"index"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

// PaymentChannelVersion 是不可变的凭据快照。历史订单永远引用创建时使用的版本。
type PaymentChannelVersion struct {
	ID                       string                      `json:"id" gorm:"primaryKey;size:36"`
	ChannelID                string                      `json:"channelId" gorm:"size:36;index;uniqueIndex:idx_payment_channel_version,priority:1"`
	Version                  int                         `json:"version" gorm:"uniqueIndex:idx_payment_channel_version,priority:2"`
	AppID                    string                      `json:"appId" gorm:"size:64"`
	MerchantID               string                      `json:"merchantId" gorm:"size:32;index"`
	MerchantCertSerial       string                      `json:"merchantCertSerial" gorm:"size:128"`
	MerchantPrivateKeyCipher string                      `json:"-" gorm:"type:text"`
	APIv3KeyCipher           string                      `json:"-" gorm:"type:text"`
	VerifyMode               string                      `json:"verifyMode" gorm:"size:32"`
	WechatPayPublicKeyID     string                      `json:"wechatPayPublicKeyId,omitempty" gorm:"size:128"`
	WechatPayPublicKey       string                      `json:"-" gorm:"type:text"`
	ConfigFingerprint        string                      `json:"configFingerprint" gorm:"size:64"`
	Status                   PaymentChannelVersionStatus `json:"status" gorm:"size:24;index"`
	CreatedBy                string                      `json:"createdBy" gorm:"size:36;index"`
	CreatedAt                time.Time                   `json:"createdAt" gorm:"index"`
}

type CreditRechargeProduct struct {
	ID                  string    `json:"id" gorm:"primaryKey;size:36"`
	SKU                 string    `json:"sku" gorm:"size:48;uniqueIndex"`
	Name                string    `json:"name" gorm:"size:120"`
	Description         string    `json:"description,omitempty" gorm:"size:500"`
	AmountFen           int64     `json:"amountFen"`
	CreditsMicrocredits int64     `json:"creditsMicrocredits"`
	Enabled             bool      `json:"enabled" gorm:"index"`
	SortOrder           int       `json:"sortOrder" gorm:"index"`
	CreatedBy           string    `json:"createdBy" gorm:"size:36;index"`
	UpdatedBy           string    `json:"updatedBy" gorm:"size:36;index"`
	CreatedAt           time.Time `json:"createdAt" gorm:"index"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type PaymentOrder struct {
	ID                     string             `json:"id" gorm:"primaryKey;size:36"`
	OutTradeNo             string             `json:"outTradeNo" gorm:"size:32;uniqueIndex"`
	UserID                 string             `json:"userId" gorm:"size:36;index;uniqueIndex:idx_payment_user_idempotency,priority:1;index:idx_payment_user_created,priority:1"`
	IdempotencyKey         string             `json:"-" gorm:"size:160;uniqueIndex:idx_payment_user_idempotency,priority:2"`
	ChannelID              string             `json:"channelId" gorm:"size:36;index"`
	ChannelVersionID       string             `json:"channelVersionId" gorm:"size:36;index"`
	ProductID              string             `json:"productId" gorm:"size:36;index"`
	ProductNameSnapshot    string             `json:"productName" gorm:"size:120"`
	AmountFen              int64              `json:"amountFen"`
	CreditsMicrocredits    int64              `json:"creditsMicrocredits"`
	Currency               string             `json:"currency" gorm:"size:12"`
	ExpireMinutesSnapshot  int                `json:"expireMinutes"`
	ExpiresAt              time.Time          `json:"expiresAt" gorm:"index:idx_payment_status_expires,priority:2"`
	Status                 PaymentOrderStatus `json:"status" gorm:"size:24;index;index:idx_payment_status_expires,priority:1"`
	ProviderTradeState     string             `json:"providerTradeState,omitempty" gorm:"size:32;index"`
	ProviderTradeStateDesc string             `json:"providerTradeStateDesc,omitempty" gorm:"size:500"`
	TransactionID          *string            `json:"transactionId,omitempty" gorm:"size:64;uniqueIndex"`
	CodeURL                string             `json:"codeUrl,omitempty" gorm:"type:text"`
	ProviderRequestID      string             `json:"providerRequestId,omitempty" gorm:"size:160;index"`
	LastQueryAt            *time.Time         `json:"lastQueryAt,omitempty"`
	QueryAttempts          int                `json:"queryAttempts"`
	PaidAt                 *time.Time         `json:"paidAt,omitempty"`
	CreditedAt             *time.Time         `json:"creditedAt,omitempty"`
	ClosedAt               *time.Time         `json:"closedAt,omitempty"`
	LastErrorCode          string             `json:"lastErrorCode,omitempty" gorm:"size:120"`
	LastErrorMessage       string             `json:"lastErrorMessage,omitempty" gorm:"size:1000"`
	CreatedAt              time.Time          `json:"createdAt" gorm:"index;index:idx_payment_user_created,priority:2"`
	UpdatedAt              time.Time          `json:"updatedAt"`
}

// PaymentEvent 是支付回调的持久化 inbox。只保存到账必需字段，不保存付款人身份信息。
type PaymentEvent struct {
	ID                    string             `json:"id" gorm:"primaryKey;size:36"`
	Provider              string             `json:"provider" gorm:"size:32;index"`
	ProviderEventID       string             `json:"providerEventId" gorm:"size:64;uniqueIndex"`
	ChannelVersionID      string             `json:"channelVersionId" gorm:"size:36;index"`
	EventType             string             `json:"eventType" gorm:"size:80;index"`
	OrderID               string             `json:"orderId,omitempty" gorm:"size:36;index"`
	OutTradeNo            string             `json:"outTradeNo" gorm:"size:32;index"`
	TransactionID         string             `json:"transactionId,omitempty" gorm:"size:64;index"`
	AppID                 string             `json:"appId,omitempty" gorm:"size:64"`
	MerchantID            string             `json:"merchantId,omitempty" gorm:"size:32"`
	TradeState            string             `json:"tradeState,omitempty" gorm:"size:32"`
	TradeStateDescription string             `json:"tradeStateDescription,omitempty" gorm:"size:500"`
	AmountFen             int64              `json:"amountFen"`
	Currency              string             `json:"currency" gorm:"size:12"`
	SuccessTime           string             `json:"successTime,omitempty" gorm:"size:64"`
	ResourceDigest        string             `json:"resourceDigest" gorm:"size:64"`
	Status                PaymentEventStatus `json:"status" gorm:"size:24;index:idx_payment_event_status_received,priority:1"`
	Attempts              int                `json:"attempts"`
	LastError             string             `json:"lastError,omitempty" gorm:"size:1000"`
	LastAttemptAt         *time.Time         `json:"lastAttemptAt,omitempty" gorm:"index"`
	ReceivedAt            time.Time          `json:"receivedAt" gorm:"index;index:idx_payment_event_status_received,priority:2"`
	ProcessedAt           *time.Time         `json:"processedAt,omitempty"`
}

type PaymentReconciliationRun struct {
	ID                  string                      `json:"id" gorm:"primaryKey;size:36"`
	MerchantID          string                      `json:"merchantId" gorm:"size:32;uniqueIndex:idx_payment_reconciliation_scope,priority:1;index"`
	ChannelID           string                      `json:"channelId" gorm:"size:36;index"`
	ChannelVersionID    string                      `json:"channelVersionId" gorm:"size:36;index"`
	BillDate            string                      `json:"billDate" gorm:"size:10;uniqueIndex:idx_payment_reconciliation_scope,priority:2;index"`
	Status              PaymentReconciliationStatus `json:"status" gorm:"size:24;index"`
	BillHash            string                      `json:"billHash,omitempty" gorm:"size:64"`
	WechatOrderCount    int                         `json:"wechatOrderCount"`
	LocalOrderCount     int                         `json:"localOrderCount"`
	MatchedCount        int                         `json:"matchedCount"`
	DifferenceCount     int                         `json:"differenceCount"`
	ExternalRefundCount int                         `json:"externalRefundCount"`
	Attempts            int                         `json:"attempts"`
	LastError           string                      `json:"lastError,omitempty" gorm:"size:1000"`
	StartedAt           *time.Time                  `json:"startedAt,omitempty"`
	CompletedAt         *time.Time                  `json:"completedAt,omitempty"`
	CreatedBy           string                      `json:"createdBy,omitempty" gorm:"size:36;index"`
	CreatedAt           time.Time                   `json:"createdAt" gorm:"index"`
	UpdatedAt           time.Time                   `json:"updatedAt"`
}

type PaymentReconciliationDifference struct {
	ID              string    `json:"id" gorm:"primaryKey;size:36"`
	RunID           string    `json:"runId" gorm:"size:36;index;uniqueIndex:idx_payment_reconciliation_difference,priority:1"`
	Type            string    `json:"type" gorm:"size:48;index;uniqueIndex:idx_payment_reconciliation_difference,priority:2"`
	OutTradeNo      string    `json:"outTradeNo" gorm:"size:32;index;uniqueIndex:idx_payment_reconciliation_difference,priority:3"`
	PaymentOrderID  string    `json:"paymentOrderId,omitempty" gorm:"size:36;index"`
	TransactionID   string    `json:"transactionId,omitempty" gorm:"size:64;index"`
	WechatAmountFen int64     `json:"wechatAmountFen"`
	WechatRefundFen int64     `json:"wechatRefundFen"`
	LocalAmountFen  int64     `json:"localAmountFen"`
	LocalStatus     string    `json:"localStatus,omitempty" gorm:"size:24"`
	Description     string    `json:"description" gorm:"size:500"`
	CreatedAt       time.Time `json:"createdAt" gorm:"index"`
}
