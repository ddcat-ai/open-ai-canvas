package model

import "time"

// UserAvatar keeps the bounded image payload out of ordinary user queries.
type UserAvatar struct {
	UserID    string    `gorm:"primaryKey;size:36" json:"userId"`
	Data      []byte    `gorm:"not null" json:"-"`
	UpdatedAt time.Time `json:"updatedAt"`
}
