package model

import "time"

// APIKey grants model-call access only; it is never an AuthSession.
type APIKey struct {
	ID        string     `json:"id" gorm:"primaryKey;size:36"`
	UserID    string     `json:"-" gorm:"index;size:36;not null"`
	Name      string     `json:"name" gorm:"size:80;not null"`
	Prefix    string     `json:"prefix" gorm:"size:16;not null"`
	TokenHash string     `json:"-" gorm:"uniqueIndex;size:64;not null"`
	ExpiresAt *time.Time `json:"expiresAt"`
	RevokedAt *time.Time `json:"revokedAt"`
	CreatedAt time.Time  `json:"createdAt"`
}
