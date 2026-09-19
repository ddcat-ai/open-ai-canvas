package model

import "time"

// CanvasTemplate stores template metadata. The immutable graph document lives in versions.
type CanvasTemplate struct {
	ID             string     `json:"id" gorm:"primaryKey;size:36"`
	OwnerID        string     `json:"ownerId" gorm:"index;size:36"`
	Title          string     `json:"title" gorm:"size:160"`
	Description    string     `json:"description" gorm:"size:500"`
	Category       string     `json:"category" gorm:"index;size:40"`
	TagsJSON       string     `json:"-" gorm:"type:text"`
	Status         string     `json:"status" gorm:"index;size:24"`
	Visibility     string     `json:"visibility" gorm:"index;size:24"`
	CurrentVersion int        `json:"currentVersion"`
	CreatedBy      string     `json:"createdBy" gorm:"index;size:36"`
	PublishedBy    string     `json:"publishedBy,omitempty" gorm:"index;size:36"`
	PublishedAt    *time.Time `json:"publishedAt,omitempty" gorm:"index"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type CanvasTemplateVersion struct {
	ID            string    `json:"id" gorm:"primaryKey;size:36"`
	TemplateID    string    `json:"templateId" gorm:"index;size:36;uniqueIndex:idx_canvas_template_version,priority:1"`
	Version       int       `json:"version" gorm:"uniqueIndex:idx_canvas_template_version,priority:2"`
	SchemaVersion int       `json:"schemaVersion"`
	DocumentJSON  string    `json:"-" gorm:"type:text"`
	CreatedBy     string    `json:"createdBy" gorm:"index;size:36"`
	CreatedAt     time.Time `json:"createdAt"`
}
