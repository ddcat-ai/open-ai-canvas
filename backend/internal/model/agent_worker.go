package model

import "time"

// AgentWorker is a provisioned service identity. A nonempty UserID confines
// claims to that tenant; an empty UserID is an explicitly global worker.
// P2 keeps identities in process env; P3 adds the backing table (v83).
type AgentWorker struct {
	ID         string     `gorm:"primaryKey;size:80" json:"id"`
	SecretHash string     `gorm:"size:64;not null" json:"-"`
	UserID     string     `gorm:"size:36;index" json:"userId"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}
