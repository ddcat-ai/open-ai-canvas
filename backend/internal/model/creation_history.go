package model

import "time"

// History is independent of execution/approval state. Deleted rows are permanent tombstones.
type CreationConversation struct {
	UserID           string    `gorm:"primaryKey;size:64" json:"-"`
	ID               string    `gorm:"primaryKey;size:160" json:"id"`
	Title            string    `gorm:"size:480" json:"title"`
	CanvasID         string    `gorm:"size:160" json:"canvasId,omitempty"`
	Revision         int64     `json:"revision"`
	MetadataRevision int64     `json:"metadataRevision"`
	Deleted          bool      `json:"deleted"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type CreationConversationMessage struct {
	UserID         string `gorm:"primaryKey;size:64"`
	ConversationID string `gorm:"primaryKey;size:160"`
	ID             string `gorm:"primaryKey;size:160"`
	Revision       int64
	Deleted        bool
	Sequence       int64
	PayloadJSON    string `gorm:"type:text"`
	CreatedAt      time.Time
}

type CreationConversationResource struct {
	UserID         string `gorm:"primaryKey;size:64"`
	ConversationID string `gorm:"primaryKey;size:160"`
	MessageID      string `gorm:"primaryKey;size:160"`
	ResourceID     string `gorm:"primaryKey;size:160;index"`
}
