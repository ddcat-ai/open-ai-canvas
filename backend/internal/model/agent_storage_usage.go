package model

import "time"

// AgentStorageUsage accounts for the payloads stored outside ordinary tasks.
// The first write initializes existing data under the same per-user quota lock.
type AgentStorageUsage struct {
	UserID      string `gorm:"primaryKey;size:36"`
	StoredBytes int64  `gorm:"not null;default:0"`
	UpdatedAt   time.Time
}
