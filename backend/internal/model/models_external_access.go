package model

import "time"

// UserAPIKey stores only a hash. MCP grants remain as audit records after revocation.
type UserAPIKey struct {
	ID         string     `json:"id" gorm:"primaryKey;size:36"`
	UserID     string     `json:"-" gorm:"index;size:36"`
	Name       string     `json:"name" gorm:"size:100"`
	Kind       string     `json:"kind" gorm:"size:16"`
	TokenHash  string     `json:"-" gorm:"uniqueIndex;size:64"`
	Prefix     string     `json:"prefix" gorm:"size:16"`
	ClientID   string     `json:"-" gorm:"size:160"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
}

type MCPClient struct {
	ID               string    `json:"-" gorm:"primaryKey;size:36"`
	ClientID         string    `json:"clientId" gorm:"uniqueIndex;size:160"`
	Name             string    `json:"name" gorm:"size:100"`
	RedirectURIsJSON string    `json:"-" gorm:"type:text"`
	CreatedAt        time.Time `json:"-"`
}

type MCPAuthorizationCode struct {
	ID            string     `json:"-" gorm:"primaryKey;size:36"`
	CodeHash      string     `json:"-" gorm:"uniqueIndex;size:64"`
	UserID        string     `json:"-" gorm:"size:36"`
	ClientID      string     `json:"-" gorm:"size:160"`
	RedirectURI   string     `json:"-" gorm:"size:2048"`
	CodeChallenge string     `json:"-" gorm:"size:128"`
	Resource      string     `json:"-" gorm:"size:2048"`
	ExpiresAt     time.Time  `json:"-" gorm:"index"`
	UsedAt        *time.Time `json:"-"`
	CreatedAt     time.Time  `json:"-"`
}
