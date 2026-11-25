package model

import "time"

type UserNodeToolbarPreference struct {
	UserID             string `gorm:"primaryKey;size:36"`
	NodeType           string `gorm:"primaryKey;size:16"`
	PinnedEntryIDsJSON string `gorm:"type:text;not null"`
	CreatedAt          time.Time
	UpdatedAt          time.Time
}
