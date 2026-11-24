package model

import "time"

// MCP catalog entries contain parameter definitions, never installed credentials.
type MCPServerTemplate struct {
	ID         string `gorm:"primaryKey;size:36"`
	Definition string `gorm:"type:text;not null"`
	Published  bool   `gorm:"index;not null;default:false"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type MCPConnection struct {
	ID                   string `gorm:"primaryKey;size:36"`
	UserID               string `gorm:"size:36;index;not null"`
	Scope                string `gorm:"size:16;index;not null"`
	TemplateID           string `gorm:"size:36;index"`
	Name                 string `gorm:"size:100;not null"`
	Transport            string `gorm:"size:24;not null"`
	ServerURL            string `gorm:"type:text;not null"`
	ParametersCiphertext string `gorm:"type:text;not null" json:"-"`
	Enabled              bool   `gorm:"index;not null;default:false"`
	ToolsJSON            string `gorm:"type:text;not null;default:'[]'"`
	ToolsSummaryJSON     string `gorm:"type:text;not null;default:'[]'"`
	AllowedToolsJSON     string `gorm:"type:text;not null;default:'[]'"`
	AllowedUserIDsJSON   string `gorm:"type:text;not null;default:'[]'"`
	ToolPoliciesJSON     string `gorm:"type:text;not null;default:'{}'"`
	Revision             int64  `gorm:"not null;default:1"`
	LastTestAt           *time.Time
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

// Platform credentials are usable only by explicitly granted users. Management
// permissions do not imply permission to execute with a platform credential.
type MCPConnectionGrant struct {
	ConnectionID string `gorm:"primaryKey;size:36"`
	UserID       string `gorm:"primaryKey;size:36;index"`
}

type MCPStorageUsage struct {
	UserID string `gorm:"primaryKey;size:36"`
	Bytes  int64  `gorm:"not null;default:0"`
}

// A receipt is claimed before external IO. An interrupted call is never
// automatically reissued: the remote server may already have performed it.
type MCPToolExecution struct {
	ID           string `gorm:"primaryKey;size:64"`
	UserID       string `gorm:"size:36;index;not null"`
	RunID        string `gorm:"size:80;index;not null"`
	ConnectionID string `gorm:"size:36;index;not null"`
	Fingerprint  string `gorm:"size:64;not null"`
	Status       string `gorm:"size:20;not null"`
	ResultJSON   string `gorm:"type:text"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
