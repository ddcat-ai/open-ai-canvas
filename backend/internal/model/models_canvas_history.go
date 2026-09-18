package model

import "time"

// CanvasSnapshot stores document structure only; media stays in Resource storage.
type CanvasSnapshot struct {
	ID               string    `json:"id" gorm:"primaryKey;size:36"`
	CanvasID         string    `json:"canvasId" gorm:"size:80;not null;uniqueIndex:idx_canvas_snapshot_revision,priority:1;index:idx_canvas_snapshot_created,priority:1"`
	UserID           string    `json:"-" gorm:"size:36;not null;index"`
	Revision         int64     `json:"revision" gorm:"not null;uniqueIndex:idx_canvas_snapshot_revision,priority:2"`
	Title            string    `json:"title" gorm:"size:240"`
	NodeCount        int       `json:"nodeCount"`
	ConnectionCount  int       `json:"connectionCount"`
	PayloadBytes     int       `json:"payloadBytes"`
	PayloadJSON      string    `json:"-" gorm:"type:text;not null"`
	Reason           string    `json:"reason" gorm:"size:24"`
	ContentUpdatedAt time.Time `json:"contentUpdatedAt"`
	CreatedAt        time.Time `json:"createdAt" gorm:"not null;index:idx_canvas_snapshot_created,priority:2"`
}

type CanvasSnapshotResource struct {
	SnapshotID string    `json:"-" gorm:"primaryKey;size:36"`
	ResourceID string    `json:"-" gorm:"primaryKey;size:36;index"`
	Resource   *Resource `json:"-" gorm:"foreignKey:ResourceID;constraint:OnDelete:RESTRICT"`
}
