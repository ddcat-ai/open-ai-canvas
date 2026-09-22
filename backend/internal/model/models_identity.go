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
	// 手机号，**E.164**（`+8613800138000`，给将来国际号码留路）。
	// 空串 = 未绑定。唯一性由**代码查重**保证（`UserByPhone`），与 `Email` 同一套做法 ——
	// ⚠️ **别加库级 `uniqueIndex`**：未绑定存的是空串而不是 NULL，多个空串会互相撞唯一约束。
	Phone string `json:"phone,omitempty" gorm:"index;size:32"`
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
	ID            string     `json:"id" gorm:"primaryKey;size:36"`
	Provider      string     `json:"provider" gorm:"index;size:32"`
	StateHash     string     `json:"-" gorm:"uniqueIndex;size:64"`
	CodeVerifier  string     `json:"-" gorm:"size:160"`
	NextPath      string     `json:"nextPath"`
	AcceptedTerms bool       `json:"acceptedTerms" gorm:"not null;default:false"`
	ExpiresAt     time.Time  `json:"expiresAt" gorm:"index"`
	UsedAt        *time.Time `json:"usedAt" gorm:"index"`
	CreatedAt     time.Time  `json:"createdAt"`
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

// PhoneVerificationCode 手机验证码（阿里云短信）。
//
// 与 `EmailVerificationCode` **逐字段同形**，只是把 Email 换成 Phone —— 刻意保持一致，
// 这样两条链（邮件/短信）的仓储方法、冷却、事务消费都能一一对照着看。
// `Phone` 存**归一化后的 E.164**（`+8613800138000`），与 `User.Phone` 同一口径。
type PhoneVerificationCode struct {
	ID        string     `json:"id" gorm:"primaryKey;size:36"`
	Phone     string     `json:"phone" gorm:"index;size:32"`
	CodeHash  string     `json:"-" gorm:"size:64"`
	Purpose   string     `json:"purpose" gorm:"index;size:32"`
	ExpiresAt time.Time  `json:"expiresAt" gorm:"index"`
	UsedAt    *time.Time `json:"usedAt" gorm:"index"`
	CreatedAt time.Time  `json:"createdAt" gorm:"index"`
}
