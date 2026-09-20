package model

import "time"

const CanvasMediaResource = "resource"
const CanvasMediaAsset = "asset"

// CanvasMediaGrant records an authorized publication into a canvas. A grant
// never replaces the reader's current canvas membership check.
type CanvasMediaGrant struct {
	CanvasID  string    `gorm:"primaryKey;size:80"`
	Kind      string    `gorm:"primaryKey;size:16;index:idx_canvas_media_object,priority:1"`
	ObjectID  string    `gorm:"primaryKey;size:80;index:idx_canvas_media_object,priority:2"`
	Current   bool      `gorm:"not null"`
	GrantedBy string    `gorm:"size:36;not null"`
	CreatedAt time.Time `gorm:"not null"`
}
