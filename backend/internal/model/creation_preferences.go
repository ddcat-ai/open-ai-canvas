package model

import "time"

type CreationPreferences struct {
	UserID    string `gorm:"primaryKey;size:36"`
	ValueJSON string `gorm:"type:text"`
	UpdatedAt time.Time
}
