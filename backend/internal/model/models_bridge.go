package model

import "time"

// ComfyBridge 是用户电脑上本地 Bridge 的持久化身份。Token 只在创建时返回明文，数据库只保存摘要。
type ComfyBridge struct {
	ID               string     `json:"id" gorm:"primaryKey;size:64"`
	UserID           string     `json:"userId" gorm:"index;size:36"`
	Name             string     `json:"name" gorm:"size:80"`
	TokenHash        string     `json:"-" gorm:"uniqueIndex;size:128"`
	Enabled          bool       `json:"enabled" gorm:"index"`
	LastSeenAt       *time.Time `json:"lastSeenAt,omitempty"`
	LastTaskAt       *time.Time `json:"lastTaskAt,omitempty"`
	CapabilitiesJSON string     `json:"-" gorm:"type:text"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

// ComfyBridgeRequest 是云端任务与本地 Bridge 之间的持久化交接记录。
// Payload 和 Result 只保存工作流执行协议，不包含 Bridge Token。
type ComfyBridgeRequest struct {
	ID          string     `json:"id" gorm:"primaryKey;size:64"`
	TaskID      string     `json:"taskId" gorm:"index;size:64"`
	UserID      string     `json:"userId" gorm:"index;size:36"`
	BridgeID    string     `json:"bridgeId" gorm:"index:idx_comfy_bridge_request_queue,priority:1;size:64"`
	Kind        string     `json:"kind" gorm:"size:32"`
	Status      string     `json:"status" gorm:"index:idx_comfy_bridge_request_queue,priority:2;size:24"`
	PayloadJSON string     `json:"-" gorm:"type:text"`
	ResultJSON  string     `json:"-" gorm:"type:text"`
	Error       string     `json:"error,omitempty" gorm:"type:text"`
	ClaimedAt   *time.Time `json:"claimedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	ExpiresAt   time.Time  `json:"expiresAt" gorm:"index"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}
