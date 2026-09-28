package model

import "time"

// CloudAgentGeminiCache records an official Gemini CachedContent resource.
// The upstream credential is never stored; CredentialHash is only an identity
// component used to prevent reusing a cache across different credentials.
type CloudAgentGeminiCache struct {
	ID             string    `gorm:"primaryKey;size:80"`
	UserID         string    `gorm:"index;uniqueIndex:idx_cloud_agent_gemini_cache_user_key;size:36;not null"`
	CacheKey       string    `gorm:"uniqueIndex:idx_cloud_agent_gemini_cache_user_key;size:64;not null"`
	BaseURL        string    `gorm:"size:500;not null"`
	Model          string    `gorm:"size:200;not null"`
	CredentialHash string    `gorm:"size:64;not null"`
	ResourceName   string    `gorm:"size:300;not null"`
	ExpireTime     time.Time `gorm:"index;not null"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
}
