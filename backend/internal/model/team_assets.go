package model

import "time"

const (
	TeamAssetPending = "pending"
	TeamAssetReady   = "ready"
	TeamAssetFailed  = "failed"
)

type TeamAssetPublication struct {
	ID               string  `json:"id" gorm:"primaryKey;size:36"`
	TeamID           string  `json:"teamId" gorm:"size:36;not null;index;uniqueIndex:idx_team_asset_publication_key,priority:1"`
	PublishedBy      string  `json:"-" gorm:"size:36;not null"`
	BatchKey         string  `json:"-" gorm:"size:128;not null;index"`
	IdempotencyKey   string  `json:"-" gorm:"size:128;not null;uniqueIndex:idx_team_asset_publication_key,priority:2"`
	RequestHash      string  `json:"-" gorm:"size:64;not null"`
	SourceAssetID    string  `json:"sourceAssetId" gorm:"size:80;not null;index"`
	SourceResourceID *string `json:"-" gorm:"size:36;index"`
	// The temporary FK serializes source deletion with publication on SQLite and PostgreSQL.
	SourceResource *Resource `json:"-" gorm:"foreignKey:SourceResourceID;constraint:OnDelete:RESTRICT"`
	AssetID        string    `json:"assetId,omitempty" gorm:"size:36"`
	VersionID      string    `json:"versionId,omitempty" gorm:"size:36"`
	Status         string    `json:"status" gorm:"size:16;not null;index"`
	ReservedBytes  int64     `json:"-" gorm:"not null"`
	Error          string    `json:"error,omitempty" gorm:"type:text"`
	ExpiresAt      time.Time `json:"-" gorm:"not null;index"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}
