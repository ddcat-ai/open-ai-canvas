package model

import "time"

// CloudAgentResourceLease pins immutable inputs while a prepared action waits
// for approval. Submitted tasks subsequently own their resource references.
type CloudAgentResourceLease struct {
	UserID     string    `gorm:"primaryKey;size:36"`
	RunID      string    `gorm:"index;size:80"`
	OwnerID    string    `gorm:"primaryKey;size:160"`
	ResourceID string    `gorm:"primaryKey;size:36;index"`
	ExpiresAt  time.Time `gorm:"index"`
}
