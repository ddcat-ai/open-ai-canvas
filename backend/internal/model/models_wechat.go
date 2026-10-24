package model

import "time"

const (
	WechatTicketActionLogin = "login"
	WechatTicketActionBind  = "bind"

	WechatTicketStatusPending   = "pending"
	WechatTicketStatusScanned   = "scanned"
	WechatTicketStatusConfirmed = "confirmed"
	WechatTicketStatusFailed    = "failed"
	WechatTicketStatusExpired   = "expired"
)

type WechatQRTicket struct {
	ID           string     `json:"id" gorm:"primaryKey;size:36"`
	Action       string     `json:"action" gorm:"size:24;index"` // "login" | "bind"
	UserID       string     `json:"userId,omitempty" gorm:"size:36;index"` // for action=="bind"
	Status       string     `json:"status" gorm:"size:24;index"` // "pending" | "scanned" | "confirmed" | "failed" | "expired"
	Code         string     `json:"code,omitempty" gorm:"size:16;index"` // 6-digit short manual code for review/manual test
	OpenID       string     `json:"openId,omitempty" gorm:"size:128;index"`
	UnionID      string     `json:"unionId,omitempty" gorm:"size:128;index"`
	SessionToken string     `json:"sessionToken,omitempty" gorm:"size:128"`
	ErrorMessage string     `json:"errorMessage,omitempty" gorm:"size:255"`
	QRImageData  string     `json:"qrImageData,omitempty" gorm:"type:text"` // Base64 data:image/png;base64,...
	ExpiresAt    time.Time  `json:"expiresAt" gorm:"index"`
	ConfirmedAt  *time.Time `json:"confirmedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
}
