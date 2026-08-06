package model

import (
	"time"
)

type TaskStatus string
type ProviderCancelStatus string
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
type AssetCategory string
type AssetVersionStatus string
type WorkflowStatus string
type WorkflowStepStatus string

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

	ChannelInterfaceChatCompletion        ChannelInterfaceType = "chat-completion"
	ChannelInterfaceOpenAIResponse        ChannelInterfaceType = "openai-response"
	ChannelInterfaceOpenAIImage           ChannelInterfaceType = "openai-image"
	ChannelInterfaceVolcengineArkImage    ChannelInterfaceType = "volcengine-ark-image"
	ChannelInterfaceVolcengineJiMengImage ChannelInterfaceType = "volcengine-jimeng-image"
	ChannelInterfaceOpenAIAudio           ChannelInterfaceType = "openai-audio"
	ChannelInterfaceAsyncAudio            ChannelInterfaceType = "async-audio"
	ChannelInterfaceNewAPIVideo           ChannelInterfaceType = "newapi"
	ChannelInterfaceNewAPIChannel1        ChannelInterfaceType = "newapi-channel-1"
	ChannelInterfaceNewAPIChannel2        ChannelInterfaceType = "newapi-channel-2"
	ChannelInterfaceXAIVideo              ChannelInterfaceType = "xai-video"
	ChannelInterfaceVolcengineArkVideo    ChannelInterfaceType = "volcengine-ark-video"
	ChannelInterfaceVolcengineJiMengVideo ChannelInterfaceType = "volcengine-jimeng-video"
	ChannelInterfaceGeminiVeo             ChannelInterfaceType = "gemini-veo"

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

	ProviderCancelStatusRequested ProviderCancelStatus = "requested"
	ProviderCancelStatusConfirmed ProviderCancelStatus = "confirmed"
	ProviderCancelStatusUncertain ProviderCancelStatus = "uncertain"

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

	AssetCategoryCharacter   AssetCategory = "character"
	AssetCategoryEnvironment AssetCategory = "environment"
	AssetCategoryWardrobe    AssetCategory = "wardrobe"
	AssetCategoryProp        AssetCategory = "prop"
	AssetCategoryWeapon      AssetCategory = "weapon"
	AssetCategoryStyle       AssetCategory = "style"
	AssetCategoryOther       AssetCategory = "other"

	AssetVersionStatusDraft     AssetVersionStatus = "draft"
	AssetVersionStatusReview    AssetVersionStatus = "review"
	AssetVersionStatusConfirmed AssetVersionStatus = "confirmed"
	AssetVersionStatusArchived  AssetVersionStatus = "archived"

	WorkflowStatusActive    WorkflowStatus = "active"
	WorkflowStatusCompleted WorkflowStatus = "completed"
	WorkflowStatusFailed    WorkflowStatus = "failed"

	WorkflowStepStatusPending   WorkflowStepStatus = "pending"
	WorkflowStepStatusReady     WorkflowStepStatus = "ready"
	WorkflowStepStatusRunning   WorkflowStepStatus = "running"
	WorkflowStepStatusReview    WorkflowStepStatus = "review"
	WorkflowStepStatusCompleted WorkflowStepStatus = "completed"
	WorkflowStepStatusFailed    WorkflowStepStatus = "failed"
	WorkflowStepStatusSkipped   WorkflowStepStatus = "skipped"
)
