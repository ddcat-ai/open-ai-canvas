package model

import (
	"fmt"
	"time"
)

const RuntimePolicySettingKey = "runtime_policy"

const (
	DefaultAgentHistoryMB int64 = 256
	MaxAgentHistoryMB     int64 = 999_999
)

type AgentHistoryQuota struct {
	AgentHistoryMB int64 `json:"agentHistoryMB"`
}

func (quota AgentHistoryQuota) LimitBytes() (int64, error) {
	if quota.AgentHistoryMB < 1 || quota.AgentHistoryMB > MaxAgentHistoryMB {
		return 0, fmt.Errorf("Agent 历史容量必须是 1-%d MiB 的整数", MaxAgentHistoryMB)
	}
	return quota.AgentHistoryMB << 20, nil
}

// AgentStorageUsage accounts for the payloads stored outside ordinary tasks.
// The first write initializes existing data under the same per-user quota lock.
type AgentStorageUsage struct {
	UserID      string `gorm:"primaryKey;size:36"`
	StoredBytes int64  `gorm:"not null;default:0"`
	UpdatedAt   time.Time
}
