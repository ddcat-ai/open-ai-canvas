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
