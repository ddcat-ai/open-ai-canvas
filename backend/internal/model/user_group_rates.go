package model

import "time"

// Overrides refer to existing model display group IDs, not a second membership system.
type UserGroupRates struct {
	UserID    string    `json:"userId" gorm:"primaryKey;size:36"`
	RatesJSON string    `json:"-" gorm:"type:text;not null"`
	Version   int64     `json:"version" gorm:"not null"`
	UpdatedAt time.Time `json:"updatedAt"`
}
