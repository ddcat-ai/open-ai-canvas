package model

import "time"

type TaskStatus string
type SessionStatus string
type UserRole string
type UserStatus string
type ChannelScope string
type ChannelInterfaceType string
type ApiCallStatus string
type ResourceStatus string
type BillingStatus string
type CreditLedgerType string
type RedeemCodeStatus string
type AnnouncementStatus string
type AnnouncementLevel string
type ProjectStatus string
type ProjectUnitKind string
type ProjectUnitStatus string

// AdminAuditEvent 只允许追加，用于还原管理员写操作，禁止作为可编辑业务状态使用。
type AdminAuditEvent struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	ActorUserID  string    `json:"actorUserId" gorm:"index;size:36"`
	Action       string    `json:"action" gorm:"index;size:80"`
	TargetType   string    `json:"targetType" gorm:"index;size:40"`
	TargetID     string    `json:"targetId" gorm:"index;size:160"`
	Summary      string    `json:"summary" gorm:"size:500"`
	MetadataJSON string    `json:"metadataJson" gorm:"type:text"`
	CreatedAt    time.Time `json:"createdAt" gorm:"index"`
}

const (
	TaskStatusQueued    TaskStatus = "queued"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusSucceeded TaskStatus = "succeeded"
	TaskStatusFailed    TaskStatus = "failed"
	TaskStatusCancelled TaskStatus = "cancelled"

	SessionStatusActive    SessionStatus = "active"
	SessionStatusCompleted SessionStatus = "completed"
	SessionStatusFailed    SessionStatus = "failed"

	UserRoleAdmin UserRole = "admin"
	UserRoleUser  UserRole = "user"

	UserStatusActive   UserStatus = "active"
	UserStatusDisabled UserStatus = "disabled"

	ChannelScopeSystem ChannelScope = "system"
	ChannelScopeUser   ChannelScope = "user"

	ChannelInterfaceChatCompletion ChannelInterfaceType = "chat-completion"
	ChannelInterfaceOpenAIResponse ChannelInterfaceType = "openai-response"
	ChannelInterfaceOpenAIImage    ChannelInterfaceType = "openai-image"
	ChannelInterfaceNewAPIVideo    ChannelInterfaceType = "newapi"
	ChannelInterfaceNewAPIChannel1 ChannelInterfaceType = "newapi-channel-1"
	ChannelInterfaceNewAPIChannel2 ChannelInterfaceType = "newapi-channel-2"
	ChannelInterfaceXAIVideo       ChannelInterfaceType = "xai-video"

	ApiCallStatusSucceeded ApiCallStatus = "succeeded"
	ApiCallStatusFailed    ApiCallStatus = "failed"

	ResourceStatusPending ResourceStatus = "pending"
	ResourceStatusReady   ResourceStatus = "ready"
	ResourceStatusFailed  ResourceStatus = "failed"
	ResourceStatusDeleted ResourceStatus = "deleted"

	BillingStatusReserved  BillingStatus = "reserved"
	BillingStatusRunning   BillingStatus = "running"
	BillingStatusSettled   BillingStatus = "settled"
	BillingStatusRefunded  BillingStatus = "refunded"
	BillingStatusUncertain BillingStatus = "uncertain"

	CreditLedgerRedeem       CreditLedgerType = "redeem"
	CreditLedgerAdminGrant   CreditLedgerType = "admin_grant"
	CreditLedgerReserve      CreditLedgerType = "reserve"
	CreditLedgerConsume      CreditLedgerType = "consume"
	CreditLedgerRefund       CreditLedgerType = "refund"
	CreditLedgerAdminAdjust  CreditLedgerType = "admin_adjustment"
	CreditLedgerSignupBonus  CreditLedgerType = "signup_bonus"
	CreditLedgerCheckinBonus CreditLedgerType = "checkin_bonus"

	RedeemCodeUnused   RedeemCodeStatus = "unused"
	RedeemCodeRedeemed RedeemCodeStatus = "redeemed"
	RedeemCodeDisabled RedeemCodeStatus = "disabled"

	AnnouncementStatusActive AnnouncementStatus = "active"
	AnnouncementStatusClosed AnnouncementStatus = "closed"

	AnnouncementLevelInfo     AnnouncementLevel = "info"
	AnnouncementLevelSuccess  AnnouncementLevel = "success"
	AnnouncementLevelWarning  AnnouncementLevel = "warning"
	AnnouncementLevelCritical AnnouncementLevel = "critical"

	ProjectStatusActive   ProjectStatus = "active"
	ProjectStatusArchived ProjectStatus = "archived"

	ProjectUnitKindChapter ProjectUnitKind = "chapter"
	ProjectUnitKindEpisode ProjectUnitKind = "episode"

	ProjectUnitStatusDraft     ProjectUnitStatus = "draft"
	ProjectUnitStatusReady     ProjectUnitStatus = "ready"
	ProjectUnitStatusCompleted ProjectUnitStatus = "completed"
)

type User struct {
	ID           string     `json:"id" gorm:"primaryKey;size:36"`
	Username     string     `json:"username" gorm:"uniqueIndex;size:80"`
	Email        string     `json:"email,omitempty" gorm:"size:160"`
	DisplayName  string     `json:"displayName" gorm:"size:80"`
	Role         UserRole   `json:"role" gorm:"index;size:24"`
	Status       UserStatus `json:"status" gorm:"index;size:24"`
	PasswordHash string     `json:"-"`
	LastLoginAt  *time.Time `json:"lastLoginAt"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type AuthSession struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	TokenHash string    `json:"-"`
	ExpiresAt time.Time `json:"expiresAt" gorm:"index"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type UserIdentity struct {
	ID               string    `json:"id" gorm:"primaryKey;size:36"`
	UserID           string    `json:"userId" gorm:"index;size:36"`
	Provider         string    `json:"provider" gorm:"size:32;uniqueIndex:idx_user_identity_provider_subject,priority:1"`
	Subject          string    `json:"subject" gorm:"size:160;uniqueIndex:idx_user_identity_provider_subject,priority:2"`
	ProviderUsername string    `json:"providerUsername" gorm:"size:160"`
	AvatarURL        string    `json:"avatarUrl"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type OAuthState struct {
	ID           string     `json:"id" gorm:"primaryKey;size:36"`
	Provider     string     `json:"provider" gorm:"index;size:32"`
	StateHash    string     `json:"-" gorm:"uniqueIndex;size:64"`
	CodeVerifier string     `json:"-" gorm:"size:160"`
	NextPath     string     `json:"nextPath"`
	ExpiresAt    time.Time  `json:"expiresAt" gorm:"index"`
	UsedAt       *time.Time `json:"usedAt" gorm:"index"`
	CreatedAt    time.Time  `json:"createdAt"`
}

type EmailVerificationCode struct {
	ID        string     `json:"id" gorm:"primaryKey;size:36"`
	Email     string     `json:"email" gorm:"index;size:160"`
	CodeHash  string     `json:"-" gorm:"size:64"`
	Purpose   string     `json:"purpose" gorm:"index;size:32"`
	ExpiresAt time.Time  `json:"expiresAt" gorm:"index"`
	UsedAt    *time.Time `json:"usedAt" gorm:"index"`
	CreatedAt time.Time  `json:"createdAt" gorm:"index"`
}

type ModelChannel struct {
	ID               string               `json:"id" gorm:"primaryKey;size:36"`
	UserID           string               `json:"userId" gorm:"index;size:36"`
	Scope            ChannelScope         `json:"scope" gorm:"index;size:24"`
	Enabled          bool                 `json:"enabled" gorm:"index"`
	Name             string               `json:"name" gorm:"size:80"`
	BaseURL          string               `json:"baseUrl"`
	APIKey           string               `json:"-"`
	APIFormat        string               `json:"apiFormat" gorm:"size:24"`
	InterfaceType    ChannelInterfaceType `json:"interfaceType" gorm:"size:32"`
	ConcurrencyLimit int                  `json:"concurrencyLimit"`
	ModelsJSON       string               `json:"modelsJson" gorm:"type:text"`
	CreatedAt        time.Time            `json:"createdAt"`
	UpdatedAt        time.Time            `json:"updatedAt"`
}

type ChannelModel struct {
	ID                    string    `json:"id" gorm:"primaryKey;size:36"`
	ChannelID             string    `json:"channelId" gorm:"size:36;index;uniqueIndex:idx_channel_model_key,priority:1"`
	ModelKey              string    `json:"modelKey" gorm:"size:120;uniqueIndex:idx_channel_model_key,priority:2"`
	DisplayName           string    `json:"displayName" gorm:"size:160"`
	Capability            string    `json:"capability" gorm:"size:32;index"`
	BillingMode           string    `json:"billingMode" gorm:"size:32"`
	UnitPriceMicrocredits int64     `json:"unitPriceMicrocredits"`
	PriceConfigured       bool      `json:"priceConfigured" gorm:"index"`
	Enabled               bool      `json:"enabled" gorm:"index"`
	PriceVersion          int64     `json:"priceVersion"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type ApiCallLog struct {
	ID                  string        `json:"id" gorm:"primaryKey;size:36"`
	UserID              string        `json:"userId" gorm:"index;size:36;index:idx_api_logs_user_created,priority:1"`
	ChannelID           string        `json:"channelId" gorm:"index;size:36;index:idx_api_logs_channel_created,priority:1"`
	ChannelName         string        `json:"channelName" gorm:"-"`
	TaskID              string        `json:"taskId,omitempty" gorm:"index;size:36"`
	BillingOrderID      string        `json:"billingOrderId,omitempty" gorm:"index;size:36"`
	Source              string        `json:"source" gorm:"index;size:64"`
	Capability          string        `json:"capability" gorm:"index;size:32"`
	Operation           string        `json:"operation" gorm:"size:64"`
	RequestKind         string        `json:"requestKind" gorm:"index;size:24"`
	Billable            bool          `json:"billable" gorm:"index"`
	APIFormat           string        `json:"apiFormat" gorm:"size:24"`
	Method              string        `json:"method" gorm:"size:16"`
	Path                string        `json:"path"`
	Model               string        `json:"model" gorm:"size:120;index:idx_api_logs_model_created,priority:1"`
	Status              ApiCallStatus `json:"status" gorm:"index;size:24;index:idx_api_logs_status_created,priority:1"`
	StatusCode          int           `json:"statusCode"`
	DurationMs          int64         `json:"durationMs"`
	InputTokens         int64         `json:"inputTokens"`
	OutputTokens        int64         `json:"outputTokens"`
	CachedTokens        int64         `json:"cachedTokens"`
	UsageAvailable      bool          `json:"usageAvailable"`
	MediaCount          int           `json:"mediaCount"`
	VideoSeconds        int           `json:"videoSeconds"`
	ProviderRequestID   string        `json:"providerRequestId" gorm:"size:160"`
	EstimatedCostMicros int64         `json:"estimatedCostMicros"`
	CostAvailable       bool          `json:"costAvailable"`
	Currency            string        `json:"currency" gorm:"size:12"`
	ErrorCode           string        `json:"errorCode,omitempty" gorm:"index;size:80"`
	Error               string        `json:"error"`
	ConcurrencyLimit    int           `json:"concurrencyLimit"`
	UpstreamURL         string        `json:"upstreamUrl"`
	CreatedAt           time.Time     `json:"createdAt" gorm:"index;index:idx_api_logs_user_created,priority:2;index:idx_api_logs_channel_created,priority:2;index:idx_api_logs_model_created,priority:2;index:idx_api_logs_status_created,priority:2"`
}

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
	ID                    string        `json:"id" gorm:"primaryKey;size:36"`
	UserID                string        `json:"userId" gorm:"size:36;index;uniqueIndex:idx_billing_user_idempotency,priority:1"`
	IdempotencyKey        string        `json:"idempotencyKey" gorm:"size:160;uniqueIndex:idx_billing_user_idempotency,priority:2"`
	TaskID                string        `json:"taskId,omitempty" gorm:"index;size:36"`
	ChannelID             string        `json:"channelId" gorm:"index;size:36"`
	ChannelModelID        string        `json:"channelModelId" gorm:"index;size:36"`
	Model                 string        `json:"model" gorm:"index;size:120"`
	Capability            string        `json:"capability" gorm:"index;size:32"`
	Scene                 string        `json:"scene" gorm:"index;size:80"`
	BillingMode           string        `json:"billingMode" gorm:"size:32"`
	PriceVersion          int64         `json:"priceVersion"`
	UnitPriceMicrocredits int64         `json:"unitPriceMicrocredits"`
	MultiplierBasisPoints int64         `json:"multiplierBasisPoints"`
	Quantity              int64         `json:"quantity"`
	AmountMicrocredits    int64         `json:"amountMicrocredits"`
	Status                BillingStatus `json:"status" gorm:"index;size:24"`
	ProviderRequestID     string        `json:"providerRequestId,omitempty" gorm:"index;size:160"`
	Error                 string        `json:"error,omitempty" gorm:"size:1000"`
	ResolvedBy            string        `json:"resolvedBy,omitempty" gorm:"index;size:36"`
	ResolutionNote        string        `json:"resolutionNote,omitempty" gorm:"size:500"`
	StartedAt             *time.Time    `json:"startedAt"`
	SettledAt             *time.Time    `json:"settledAt"`
	RefundedAt            *time.Time    `json:"refundedAt"`
	CreatedAt             time.Time     `json:"createdAt" gorm:"index"`
	UpdatedAt             time.Time     `json:"updatedAt"`
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

type UserDailyActivity struct {
	ID                string     `json:"id" gorm:"primaryKey;size:64"`
	Day               time.Time  `json:"day" gorm:"type:date;uniqueIndex:idx_user_daily_activity_day_user,priority:1;index"`
	UserID            string     `json:"userId" gorm:"size:36;uniqueIndex:idx_user_daily_activity_day_user,priority:2;index"`
	FirstActiveAt     *time.Time `json:"firstActiveAt"`
	LastActiveAt      *time.Time `json:"lastActiveAt"`
	LoginCount        int        `json:"loginCount"`
	TaskCount         int        `json:"taskCount"`
	AgentMessageCount int        `json:"agentMessageCount"`
	CanvasActive      bool       `json:"canvasActive"`
	AssetCount        int        `json:"assetCount"`
	ResourceCount     int        `json:"resourceCount"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type SystemSetting struct {
	Key       string    `json:"key" gorm:"primaryKey;size:80"`
	ValueJSON string    `json:"valueJson" gorm:"type:text"`
	UpdatedBy string    `json:"updatedBy" gorm:"index;size:36"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type UserOSSSetting struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36;index:idx_user_oss_settings_user_created,priority:1"`
	Enabled   bool      `json:"enabled" gorm:"index"`
	ValueJSON string    `json:"-" gorm:"type:text"`
	CreatedAt time.Time `json:"createdAt" gorm:"index:idx_user_oss_settings_user_created,priority:2"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type UserDailyUploadUsage struct {
	ID        string    `json:"id" gorm:"primaryKey;size:64"`
	UserID    string    `json:"userId" gorm:"size:36;index;uniqueIndex:idx_user_daily_upload_day,priority:1"`
	Day       string    `json:"day" gorm:"size:10;index;uniqueIndex:idx_user_daily_upload_day,priority:2"`
	Bytes     int64     `json:"bytes"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type UserSkillState struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36;uniqueIndex:idx_user_skill_state_user_dir,priority:1"`
	SkillDir  string    `json:"skillDir" gorm:"size:180;index;uniqueIndex:idx_user_skill_state_user_dir,priority:2"`
	Activated bool      `json:"activated" gorm:"index"`
	Liked     bool      `json:"liked" gorm:"index"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Resource struct {
	ID       string         `json:"id" gorm:"primaryKey;size:36"`
	UserID   string         `json:"userId" gorm:"index;size:36;index:idx_resources_user_created,priority:1"`
	Kind     string         `json:"kind" gorm:"index;size:24"`
	Status   ResourceStatus `json:"status" gorm:"index;size:24"`
	Provider string         `json:"provider" gorm:"size:24"`
	Endpoint string         `json:"endpoint"`
	Bucket   string         `json:"bucket" gorm:"size:160"`
	// 用户 OSS 每次修改都会生成新版本，资源固定引用创建时的版本，避免历史资源因换密钥失效。
	StorageSettingID string    `json:"-" gorm:"index;size:36"`
	ObjectKey        string    `json:"objectKey" gorm:"index"`
	PublicURL        string    `json:"publicUrl"`
	MimeType         string    `json:"mimeType" gorm:"size:120"`
	Size             int64     `json:"size"`
	Width            int       `json:"width"`
	Height           int       `json:"height"`
	DurationMs       int64     `json:"durationMs"`
	ETag             string    `json:"etag" gorm:"size:160"`
	Error            string    `json:"error"`
	CreatedAt        time.Time `json:"createdAt" gorm:"index:idx_resources_user_created,priority:2"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type Asset struct {
	ID          string    `json:"id" gorm:"primaryKey;size:36"`
	UserID      string    `json:"userId" gorm:"index;size:36;index:idx_assets_user_updated,priority:1"`
	Kind        string    `json:"kind" gorm:"index;size:24"`
	Title       string    `json:"title" gorm:"size:240"`
	PayloadJSON string    `json:"payloadJson" gorm:"type:text"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt" gorm:"index:idx_assets_user_updated,priority:2"`
}

// Project 是短剧领域聚合根；CanvasProject 仍代表可游离的画布文档。
type Project struct {
	ID          string        `json:"id" gorm:"primaryKey;size:36"`
	UserID      string        `json:"userId" gorm:"index;size:36;uniqueIndex:idx_projects_user_name,priority:1"`
	Name        string        `json:"name" gorm:"size:240;uniqueIndex:idx_projects_user_name,priority:2"`
	Type        string        `json:"type" gorm:"size:32;index"`
	AspectRatio string        `json:"aspectRatio" gorm:"size:16"`
	SourceType  string        `json:"sourceType" gorm:"size:32"`
	Description string        `json:"description" gorm:"type:text"`
	Status      ProjectStatus `json:"status" gorm:"index;size:24"`
	Revision    int64         `json:"revision"`
	CreatedAt   time.Time     `json:"createdAt"`
	UpdatedAt   time.Time     `json:"updatedAt" gorm:"index"`
}

type ProjectUnit struct {
	ID         string            `json:"id" gorm:"primaryKey;size:36"`
	ProjectID  string            `json:"projectId" gorm:"index;size:36"`
	ParentID   string            `json:"parentId,omitempty" gorm:"index;size:36"`
	Kind       ProjectUnitKind   `json:"kind" gorm:"index;size:24"`
	Title      string            `json:"title" gorm:"size:240"`
	SourceText string            `json:"sourceText" gorm:"type:text"`
	Status     ProjectUnitStatus `json:"status" gorm:"index;size:24"`
	Position   int               `json:"position"`
	CreatedAt  time.Time         `json:"createdAt"`
	UpdatedAt  time.Time         `json:"updatedAt"`
}

type CanvasUnitLink struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID string    `json:"projectId" gorm:"index;size:36;uniqueIndex:idx_canvas_unit_links_unique,priority:1"`
	CanvasID  string    `json:"canvasId" gorm:"index;size:80;uniqueIndex:idx_canvas_unit_links_unique,priority:2"`
	UnitID    string    `json:"unitId" gorm:"index;size:36;uniqueIndex:idx_canvas_unit_links_unique,priority:3"`
	Role      string    `json:"role" gorm:"size:32"`
	CreatedAt time.Time `json:"createdAt"`
}

type CanvasProject struct {
	ID          string    `json:"id" gorm:"primaryKey;size:80"`
	UserID      string    `json:"userId" gorm:"index;size:36;index:idx_canvas_projects_user_updated,priority:1"`
	ProjectID   string    `json:"projectId,omitempty" gorm:"index;size:36"`
	Title       string    `json:"title" gorm:"size:240"`
	PayloadJSON string    `json:"payloadJson" gorm:"type:text"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt" gorm:"index:idx_canvas_projects_user_updated,priority:2"`
}

type CanvasShare struct {
	ID          string     `json:"id" gorm:"primaryKey;size:36"`
	UserID      string     `json:"userId" gorm:"index;size:36;uniqueIndex:idx_canvas_share_owner_project,priority:1"`
	ProjectID   string     `json:"projectId" gorm:"index;size:80;uniqueIndex:idx_canvas_share_owner_project,priority:2"`
	TokenHash   string     `json:"-" gorm:"uniqueIndex;size:64"`
	TokenCipher string     `json:"-" gorm:"type:text"`
	Enabled     bool       `json:"enabled" gorm:"index"`
	ExpiresAt   *time.Time `json:"expiresAt" gorm:"index"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type StoryboardPromptTemplate struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	Name      string    `json:"name" gorm:"size:120"`
	Content   string    `json:"content" gorm:"type:text"`
	Enabled   bool      `json:"enabled" gorm:"index"`
	CreatedBy string    `json:"createdBy" gorm:"index;size:36"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Announcement struct {
	ID          string             `json:"id" gorm:"primaryKey;size:36"`
	Title       string             `json:"title" gorm:"size:120"`
	Content     string             `json:"content" gorm:"type:text"`
	Level       AnnouncementLevel  `json:"level" gorm:"index;size:24"`
	Status      AnnouncementStatus `json:"status" gorm:"index;size:24;index:idx_announcements_status_published,priority:1"`
	CreatedBy   string             `json:"createdBy" gorm:"index;size:36"`
	PublishedAt time.Time          `json:"publishedAt" gorm:"index:idx_announcements_status_published,priority:2"`
	ClosedAt    *time.Time         `json:"closedAt"`
	CreatedAt   time.Time          `json:"createdAt"`
	UpdatedAt   time.Time          `json:"updatedAt"`
}

type UserAnnouncementRead struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	UserID         string    `json:"userId" gorm:"index;size:36;uniqueIndex:idx_user_announcement_read,priority:1"`
	AnnouncementID string    `json:"announcementId" gorm:"index;size:36;uniqueIndex:idx_user_announcement_read,priority:2"`
	ReadAt         time.Time `json:"readAt"`
}

type Task struct {
	ID                string     `json:"id" gorm:"primaryKey;size:36"`
	UserID            string     `json:"userId" gorm:"index;size:36;index:idx_tasks_user_created,priority:1"`
	SessionID         string     `json:"sessionId" gorm:"index;size:36"`
	ProjectID         string     `json:"projectId" gorm:"index;size:80"`
	Type              string     `json:"type" gorm:"index;size:64"`
	Status            TaskStatus `json:"status" gorm:"index;size:24;index:idx_tasks_status_created,priority:1;index:idx_tasks_claim,priority:1"`
	Stage             string     `json:"stage" gorm:"size:80"`
	Progress          int        `json:"progress"`
	Prompt            string     `json:"prompt"`
	Operation         string     `json:"operation" gorm:"size:64"`
	Provider          string     `json:"provider" gorm:"size:64"`
	Model             string     `json:"model" gorm:"size:120"`
	BillingOrderID    string     `json:"billingOrderId,omitempty" gorm:"index;size:36"`
	ProviderRequestID string     `json:"providerRequestId,omitempty" gorm:"index;size:160"`
	PollStage         string     `json:"pollStage,omitempty" gorm:"size:32"`
	NextPollAt        *time.Time `json:"nextPollAt,omitempty" gorm:"index"`
	LeaseOwner        string     `json:"-" gorm:"index;size:120"`
	LeaseExpiresAt    *time.Time `json:"-" gorm:"index;index:idx_tasks_claim,priority:2"`
	InputJSON         string     `json:"inputJson" gorm:"type:text"`
	ResultJSON        string     `json:"resultJson" gorm:"type:text"`
	Error             string     `json:"error"`
	Attempts          int        `json:"attempts"`
	StartedAt         *time.Time `json:"startedAt"`
	CompletedAt       *time.Time `json:"completedAt"`
	CreatedAt         time.Time  `json:"createdAt" gorm:"index:idx_tasks_user_created,priority:2;index:idx_tasks_status_created,priority:2;index:idx_tasks_claim,priority:3"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type Session struct {
	ID                 string        `json:"id" gorm:"primaryKey;size:36"`
	UserID             string        `json:"userId" gorm:"index;size:36"`
	ProjectID          string        `json:"projectId" gorm:"index;size:80"`
	Status             SessionStatus `json:"status" gorm:"index;size:24"`
	Prompt             string        `json:"prompt"`
	CanvasSnapshotJSON string        `json:"canvasSnapshotJson" gorm:"type:text"`
	CanvasOpsJSON      string        `json:"canvasOpsJson" gorm:"type:text"`
	CreatedAt          time.Time     `json:"createdAt"`
	UpdatedAt          time.Time     `json:"updatedAt"`
}

type Message struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	SessionID string    `json:"sessionId" gorm:"index;size:36"`
	Role      string    `json:"role" gorm:"size:24"`
	Content   string    `json:"content"`
	Payload   string    `json:"payload" gorm:"type:text"`
	CreatedAt time.Time `json:"createdAt"`
}

type TaskLog struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	TaskID    string    `json:"taskId" gorm:"index;size:36"`
	Level     string    `json:"level" gorm:"size:24"`
	Message   string    `json:"message"`
	Payload   string    `json:"payload" gorm:"type:text"`
	CreatedAt time.Time `json:"createdAt"`
}

type SessionFile struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	SessionID string    `json:"sessionId" gorm:"index;size:36"`
	FileName  string    `json:"fileName"`
	MimeType  string    `json:"mimeType"`
	Path      string    `json:"-"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

type Result struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	TaskID    string    `json:"taskId" gorm:"index;size:36"`
	SessionID string    `json:"sessionId" gorm:"index;size:36"`
	Kind      string    `json:"kind" gorm:"size:64"`
	URL       string    `json:"url"`
	Payload   string    `json:"payload" gorm:"type:text"`
	CreatedAt time.Time `json:"createdAt"`
}
