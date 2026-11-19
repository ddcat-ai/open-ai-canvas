package model

import "time"

const (
	CommunityWorkPending   = "pending"
	CommunityWorkPublished = "published"
	CommunityWorkRejected  = "rejected"
	CommunityWorkWithdrawn = "withdrawn"
	CommunityWorkUnlisted  = "unlisted"
)

// CommunityWork freezes the exact content submitted for review; later canvas edits
// do not change a published work. Media stays in the owner's existing resources.
type CommunityWork struct {
	ID                string    `json:"id" gorm:"primaryKey;size:80"`
	UserID            string    `json:"-" gorm:"size:36;not null;index"`
	Author            string    `json:"author" gorm:"size:80;not null"`
	Title             string    `json:"title" gorm:"size:120;not null"`
	Description       string    `json:"description" gorm:"type:text"`
	Category          string    `json:"category" gorm:"size:24;index"`
	TagsJSON          string    `json:"-" gorm:"type:text;not null"`
	Kind              string    `json:"kind" gorm:"size:16;not null"`
	MediaResourceID   string    `json:"mediaResourceId" gorm:"size:36;not null"`
	CoverResourceID   string    `json:"coverResourceId" gorm:"size:36;not null"`
	ProjectID         string    `json:"-" gorm:"size:80"`
	SnapshotJSON      string    `json:"-" gorm:"type:text;not null"`
	Status            string    `json:"status" gorm:"size:24;not null;index:idx_community_public,priority:1"`
	Featured          bool      `json:"featured" gorm:"not null;default:false;index:idx_community_public,priority:2"`
	ReviewReason      string    `json:"reviewReason,omitempty" gorm:"size:500"`
	RightsConfirmedAt time.Time `json:"-"`
	ActiveKey         *string   `json:"-" gorm:"size:160;uniqueIndex"`
	Revision          int64     `json:"-" gorm:"not null;default:1"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt" gorm:"index:idx_community_public,priority:3"`
}

// References protect submitted media and every resource in the frozen canvas.
// Database foreign keys also close the race between submission and deletion.
type CommunityWorkResource struct {
	WorkID     string        `json:"-" gorm:"primaryKey;size:80"`
	ResourceID string        `json:"-" gorm:"primaryKey;size:36;index"`
	UserID     string        `json:"-" gorm:"size:36;not null;index"`
	Work       CommunityWork `json:"-" gorm:"foreignKey:WorkID;references:ID;constraint:OnDelete:CASCADE"`
	Resource   Resource      `json:"-" gorm:"foreignKey:ResourceID;references:ID;constraint:OnDelete:RESTRICT"`
}

type CommunityWorkReview struct {
	ID        string `json:"-" gorm:"primaryKey;size:36"`
	WorkID    string `json:"-" gorm:"size:80;not null;index"`
	ActorID   string `json:"-" gorm:"size:36;not null"`
	Action    string `json:"-" gorm:"size:24;not null"`
	Reason    string `json:"-" gorm:"size:500"`
	CreatedAt time.Time
}

type CommunityWorkLike struct {
	WorkID    string        `gorm:"primaryKey;size:80"`
	UserID    string        `gorm:"primaryKey;size:36"`
	Work      CommunityWork `gorm:"foreignKey:WorkID;references:ID;constraint:OnDelete:CASCADE"`
	CreatedAt time.Time
}
