package model

import "time"

// EmailLog 记录每次系统邮件投递结果；不保存正文和验证码，失败原因已脱敏。
type EmailLog struct {
	ID         string    `json:"id" gorm:"primaryKey;size:36"`
	UserID     string    `json:"userId" gorm:"size:36;index"`
	Purpose    string    `json:"purpose" gorm:"size:32;index"`
	Recipient  string    `json:"recipient" gorm:"size:160;index"`
	Subject    string    `json:"subject" gorm:"size:200"`
	Status     string    `json:"status" gorm:"size:16;index"`
	Stage      string    `json:"stage" gorm:"size:32"`
	Reason     string    `json:"reason" gorm:"size:500"`
	SMTPHost   string    `json:"smtpHost" gorm:"size:160"`
	DurationMS int64     `json:"durationMs"`
	CreatedAt  time.Time `json:"createdAt" gorm:"index"`
}

// UserNotificationSetting 保存用户邮件订阅；LastConsumptionReportDate 用条件更新保证每天最多发一次。
type UserNotificationSetting struct {
	UserID                    string    `json:"userId" gorm:"primaryKey;size:36"`
	ConsumptionReportEnabled  bool      `json:"consumptionReportEnabled" gorm:"not null;default:false;index"`
	LastConsumptionReportDate string    `json:"-" gorm:"size:10;not null;default:''"`
	CreatedAt                 time.Time `json:"createdAt"`
	UpdatedAt                 time.Time `json:"updatedAt"`
}
