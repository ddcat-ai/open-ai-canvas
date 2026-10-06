package model

import "time"

// UploadReservation survives process restarts; expiry, not process ownership,
// bounds its lifetime. Day records the UTC quota bucket charged at admission.
type UploadReservation struct {
	ID        string    `gorm:"primaryKey;size:64"`
	UserID    string    `gorm:"index;size:64;not null"`
	Size      int64     `gorm:"not null"`
	Day       string    `gorm:"size:10;not null"`
	ExpiresAt time.Time `gorm:"index;not null"`
}
