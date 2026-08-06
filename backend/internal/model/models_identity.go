package model

import "time"

type User struct {
	ID           string     `json:"id" gorm:"primaryKey;size:36"`
	Username     string     `json:"username" gorm:"uniqueIndex;size:80"`
	Email        string     `json:"email,omitempty" gorm:"size:160"`
	DisplayName  string     `json:"displayName" gorm:"size:80"`
	Role         UserRole   `json:"role" gorm:"index;size:24"`
	Status       UserStatus `json:"status" gorm:"index;size:24"`
	PasswordHash string     `json:"-"`
	LastLoginAt  *time.Time `json:"lastLoginAt"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}

type AuthSession struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	TokenHash string    `json:"-"`
	ExpiresAt time.Time `json:"expiresAt" gorm:"index"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type UserIdentity struct {
	ID               string    `json:"id" gorm:"primaryKey;size:36"`
	UserID           string    `json:"userId" gorm:"index;size:36"`
	Provider         string    `json:"provider" gorm:"size:32;uniqueIndex:idx_user_identity_provider_subject,priority:1"`
	Subject          string    `json:"subject" gorm:"size:160;uniqueIndex:idx_user_identity_provider_subject,priority:2"`
	ProviderUsername string    `json:"providerUsername" gorm:"size:160"`
	AvatarURL        string    `json:"avatarUrl"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type OAuthState struct {
	ID           string     `json:"id" gorm:"primaryKey;size:36"`
	Provider     string     `json:"provider" gorm:"index;size:32"`
	StateHash    string     `json:"-" gorm:"uniqueIndex;size:64"`
	CodeVerifier string     `json:"-" gorm:"size:160"`
	NextPath     string     `json:"nextPath"`
	ExpiresAt    time.Time  `json:"expiresAt" gorm:"index"`
	UsedAt       *time.Time `json:"usedAt" gorm:"index"`
	CreatedAt    time.Time  `json:"createdAt"`
}

type EmailVerificationCode struct {
	ID        string     `json:"id" gorm:"primaryKey;size:36"`
	Email     string     `json:"email" gorm:"index;size:160"`
	CodeHash  string     `json:"-" gorm:"size:64"`
	Purpose   string     `json:"purpose" gorm:"index;size:32"`
	ExpiresAt time.Time  `json:"expiresAt" gorm:"index"`
	UsedAt    *time.Time `json:"usedAt" gorm:"index"`
	CreatedAt time.Time  `json:"createdAt" gorm:"index"`
}
