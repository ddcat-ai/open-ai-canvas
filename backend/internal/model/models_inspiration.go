package model

import "time"

// InspirationFeedEntry 是从上游提示词库定时同步的灵感条目，即灵感大厅的「上新」。
// ID 与前端静态目录同形（"<来源>:<上游标识>"）：前端按 ID 去重，静态目录已有的条目以静态目录为准。
type InspirationFeedEntry struct {
	ID          string     `json:"id" gorm:"primaryKey;size:200"`
	SourceID    string     `json:"sourceId" gorm:"size:32;not null;index"`
	Mode        string     `json:"mode" gorm:"size:16;not null"`
	Title       string     `json:"title" gorm:"size:200;not null"`
	Description string     `json:"description" gorm:"size:200"`
	Image       string     `json:"image" gorm:"size:1000;not null"`
	Prompt      string     `json:"prompt" gorm:"type:text;not null"`
	Category    string     `json:"category" gorm:"size:80"`
	Tags        []string   `json:"tags" gorm:"serializer:json;type:text"`
	Credit      string     `json:"credit" gorm:"size:200"`
	SourceURL   string     `json:"sourceUrl" gorm:"size:1000"`
	ContentHash string     `json:"-" gorm:"size:64;not null"`
	PublishedAt *time.Time `json:"publishedAt,omitempty"`
	FirstSeenAt time.Time  `json:"firstSeenAt" gorm:"not null;index"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}
