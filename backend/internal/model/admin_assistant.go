package model

import "time"

// AssistantCredential stores only opaque token hashes. OAuth access tokens share
// a revocable grant; personal tokens have an empty GrantID.
type AssistantCredential struct {
	ID           string     `json:"id" gorm:"primaryKey;size:36"`
	UserID       string     `json:"userId" gorm:"index;size:36"`
	Name         string     `json:"name" gorm:"size:120"`
	TokenHash    string     `json:"-" gorm:"uniqueIndex;size:64"`
	ScopesJSON   string     `json:"-" gorm:"type:text"`
	ApprovalMode string     `json:"approvalMode" gorm:"size:30;default:request_approval"`
	GrantID      string     `json:"grantId,omitempty" gorm:"index;size:36"`
	CreatedAt    time.Time  `json:"createdAt"`
	ExpiresAt    time.Time  `json:"expiresAt" gorm:"index"`
	RevokedAt    *time.Time `json:"revokedAt"`
}

type AssistantOAuthClient struct {
	ID               string    `json:"client_id" gorm:"primaryKey;size:100"`
	Name             string    `json:"client_name" gorm:"size:120"`
	RedirectURIsJSON string    `json:"-" gorm:"type:text"`
	CreatedAt        time.Time `json:"-"`
}

func (AssistantOAuthClient) TableName() string { return "assistant_oauth_clients" }

type AssistantOAuthCode struct {
	ID           string    `gorm:"primaryKey;size:64"` // 仅保存授权码的 SHA256 摘要。
	ClientID     string    `gorm:"index;size:100"`
	UserID       string    `gorm:"size:36"`
	RedirectURI  string    `gorm:"type:text"`
	Resource     string    `gorm:"type:text"`
	Challenge    string    `gorm:"size:100"`
	ScopesJSON   string    `gorm:"type:text"`
	ApprovalMode string    `gorm:"size:30;default:request_approval"`
	ExpiresAt    time.Time `gorm:"index"`
	ConsumedAt   *time.Time
}

func (AssistantOAuthCode) TableName() string { return "assistant_oauth_codes" }

type AssistantGrant struct {
	ID           string     `json:"id" gorm:"primaryKey;size:36"`
	UserID       string     `json:"userId" gorm:"index;size:36"`
	ClientID     string     `json:"clientId" gorm:"size:100"`
	ScopesJSON   string     `json:"-" gorm:"type:text"`
	ApprovalMode string     `json:"approvalMode" gorm:"size:30;default:request_approval"`
	CreatedAt    time.Time  `json:"createdAt"`
	ExpiresAt    time.Time  `json:"expiresAt"`
	RevokedAt    *time.Time `json:"revokedAt"`
	RefreshHash  string     `json:"-" gorm:"uniqueIndex;size:64"`
}

// Used refresh hashes are retained to detect replay and revoke the whole grant.
type AssistantRefreshUse struct {
	Hash      string `gorm:"primaryKey;size:64"`
	GrantID   string `gorm:"index;size:36"`
	CreatedAt time.Time
}

type AssistantInvocation struct {
	ID             string     `json:"id" gorm:"primaryKey;size:36"`
	UserID         string     `json:"userId" gorm:"index;size:36"`
	CredentialID   string     `json:"credentialId" gorm:"uniqueIndex:assistant_call_key;size:36"`
	IdempotencyKey string     `json:"idempotencyKey" gorm:"uniqueIndex:assistant_call_key;size:160"`
	Operation      string     `json:"operation" gorm:"size:160"`
	ArgumentsHash  string     `json:"argumentsHash" gorm:"size:64"`
	PreviewJSON    string     `json:"previewJson" gorm:"type:text"`
	Status         string     `json:"status" gorm:"index;size:30"`
	Source         string     `json:"source" gorm:"size:20"`
	ResultJSON     string     `json:"-" gorm:"type:text"`
	CreatedAt      time.Time  `json:"createdAt" gorm:"index"`
	ExpiresAt      time.Time  `json:"expiresAt"`
	StartedAt      *time.Time `json:"startedAt"`
	CompletedAt    *time.Time `json:"completedAt"`
	DurationMS     int64      `json:"durationMs"`
}

type AssistantAttachment struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	CredentialID string    `json:"-" gorm:"index;size:36"`
	Name         string    `json:"name" gorm:"size:240"`
	MediaType    string    `json:"mediaType" gorm:"size:160"`
	Size         int64     `json:"size"`
	Data         []byte    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
	ExpiresAt    time.Time `json:"expiresAt" gorm:"index"`
}
