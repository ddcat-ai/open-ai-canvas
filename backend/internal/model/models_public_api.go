package model

import "time"

const (
	PublicAPIKeyStatusActive  = "active"
	PublicAPIKeyStatusRevoked = "revoked"
)

// PublicAPIKey is a platform-issued credential. The raw secret is never stored.
type PublicAPIKey struct {
	ID                 string     `json:"id" gorm:"primaryKey;size:36"`
	UserID             string     `json:"userId" gorm:"index;size:36"`
	Name               string     `json:"name" gorm:"size:120"`
	Prefix             string     `json:"prefix" gorm:"size:32"`
	Hash               string     `json:"-" gorm:"uniqueIndex;size:64"`
	Status             string     `json:"status" gorm:"index;size:24"`
	ScopesJSON         string     `json:"-" gorm:"type:text"`
	ModelAllowlistJSON string     `json:"-" gorm:"type:text"`
	ExpiresAt          *time.Time `json:"expiresAt,omitempty"`
	LastUsedAt         *time.Time `json:"lastUsedAt,omitempty"`
	RevokedAt          *time.Time `json:"revokedAt,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

// PublicGenerationRequest binds an external idempotency key to an internal task.
// It also limits task polling to the key that created the task.
type PublicGenerationRequest struct {
	ID               string    `json:"id" gorm:"primaryKey;size:36"`
	UserID           string    `json:"userId" gorm:"index;size:36"`
	APIKeyID         string    `json:"apiKeyId" gorm:"index;size:36;uniqueIndex:idx_public_generation_idempotency,priority:1"`
	Endpoint         string    `json:"endpoint" gorm:"size:80;uniqueIndex:idx_public_generation_idempotency,priority:2"`
	IdempotencyHash  string    `json:"-" gorm:"size:64;uniqueIndex:idx_public_generation_idempotency,priority:3"`
	RequestHash      string    `json:"-" gorm:"size:64"`
	CreationSubmitID string    `json:"-" gorm:"size:36;index"`
	TaskID           string    `json:"taskId" gorm:"size:36;uniqueIndex"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}
