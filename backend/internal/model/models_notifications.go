package model

import (
	"gorm.io/gorm"
	"time"
)

type SMSChannel struct {
	ID            string         `json:"id" gorm:"primaryKey;size:36"`
	Name          string         `json:"name" gorm:"size:80"`
	Provider      string         `json:"provider" gorm:"size:32;index"`
	Enabled       bool           `json:"enabled"`
	Priority      int            `json:"priority"`
	DailyLimit    int            `json:"dailyLimit"`
	SignName      string         `json:"signName" gorm:"size:80"`
	AppID         string         `json:"appId" gorm:"size:80"`
	Credentials   string         `json:"-"`
	TemplatesJSON string         `json:"-"`
	Version       int            `json:"version"`
	CreatedAt     time.Time      `json:"createdAt"`
	UpdatedAt     time.Time      `json:"updatedAt"`
	DeletedAt     gorm.DeletedAt `json:"-" gorm:"index"`
}

// SMSRecord contains no code, template parameters, raw response or full phone.
type SMSRecord struct {
	ID          string    `json:"id" gorm:"primaryKey;size:36"`
	ChannelID   string    `json:"channelId" gorm:"size:36;index"`
	ChannelName string    `json:"channelName" gorm:"size:80"`
	Provider    string    `json:"provider" gorm:"size:32"`
	Purpose     string    `json:"purpose" gorm:"size:24;index"`
	MaskedPhone string    `json:"maskedPhone" gorm:"size:32"`
	TargetHash  string    `json:"-" gorm:"size:64;index"`
	State       string    `json:"state" gorm:"size:24;index"`
	RequestID   string    `json:"requestId" gorm:"size:160"`
	MessageID   string    `json:"messageId" gorm:"size:160"`
	ErrorCode   string    `json:"errorCode" gorm:"size:160"`
	DurationMS  int64     `json:"durationMs"`
	CreatedAt   time.Time `json:"createdAt" gorm:"index"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// Verification tickets are immutable, short-lived and purpose/target bound.
// Only code HMACs and the hash of the high-entropy client ticket are persisted.
type AuthVerification struct {
	ID         string `gorm:"primaryKey;size:36"`
	TokenHash  string `gorm:"size:64"`
	Purpose    string `gorm:"size:24"`
	Method     string `gorm:"size:24"`
	UserID     string `gorm:"size:36"`
	Email      string `gorm:"size:160"`
	Phone      string `gorm:"size:24"`
	EmailHash  string `gorm:"size:64"`
	PhoneHash  string `gorm:"size:64"`
	PolicyHash string `gorm:"size:64"`
	Ready      bool
	Attempts   int
	ExpiresAt  time.Time `gorm:"index"`
	UsedAt     *time.Time
	CreatedAt  time.Time
}

// Fixed window quotas and per-recipient cooldowns are shared by all instances.
type NotificationQuota struct {
	Key       string `gorm:"primaryKey;size:180"`
	Count     int
	NextAt    time.Time
	ExpiresAt time.Time `gorm:"index"`
}
