package model

import "time"

const (
	PoseLibraryStatusPending = "pending"
	PoseLibraryStatusReady   = "ready"
	PoseLibraryStatusFailed  = "failed"
)

// PoseLibrarySource 是一个姿势数据来源（一次导入包）及其署名。
// BaseURL 只在把图片同步到本站时使用，用户浏览和选用都不再访问来源站点。
type PoseLibrarySource struct {
	Key         string    `json:"key" gorm:"primaryKey;size:64"`
	Name        string    `json:"name" gorm:"size:120;not null"`
	Attribution string    `json:"attribution" gorm:"size:300"`
	Homepage    string    `json:"homepage" gorm:"size:500"`
	BaseURL     string    `json:"baseUrl" gorm:"size:500"`
	CreatedBy   string    `json:"createdBy" gorm:"size:36"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// PoseLibraryItem 是姿势库里的一张参考图（某个姿势的一个视角）。
// 同一 GroupKey 的多张图是同一姿势的不同视角；图片文件保存在数据目录 pose-library/<ID>/ 下。
type PoseLibraryItem struct {
	ID          string     `json:"id" gorm:"primaryKey;size:36"`
	SourceKey   string     `json:"sourceKey" gorm:"size:64;not null;uniqueIndex:idx_pose_library_items_source_external,priority:1"`
	ExternalKey string     `json:"externalKey" gorm:"size:160;not null;uniqueIndex:idx_pose_library_items_source_external,priority:2"`
	GroupKey    string     `json:"groupKey" gorm:"size:240;not null;index"`
	Code        string     `json:"code" gorm:"size:40"`
	System      string     `json:"system" gorm:"size:80;not null;index:idx_pose_library_items_visible,priority:3"`
	Category    string     `json:"category" gorm:"size:80;not null"`
	Name        string     `json:"name" gorm:"size:160;not null"`
	Angle       string     `json:"angle" gorm:"size:20;not null"`
	SearchText  string     `json:"-" gorm:"size:1000"`
	SortOrder   int        `json:"sortOrder" gorm:"not null;default:0;index"`
	Enabled     bool       `json:"enabled" gorm:"not null;index:idx_pose_library_items_visible,priority:1"`
	Status      string     `json:"status" gorm:"size:16;not null;index:idx_pose_library_items_visible,priority:2"`
	Error       string     `json:"error,omitempty" gorm:"size:500"`
	RemoteThumb string     `json:"remoteThumb,omitempty" gorm:"size:800"`
	RemoteImage string     `json:"remoteImage,omitempty" gorm:"size:800"`
	ThumbFile   string     `json:"-" gorm:"size:200"`
	ThumbMime   string     `json:"-" gorm:"size:40"`
	ImageFile   string     `json:"-" gorm:"size:200"`
	ImageMime   string     `json:"imageMime,omitempty" gorm:"size:40"`
	ImageSHA256 string     `json:"-" gorm:"size:64"`
	ImageBytes  int64      `json:"imageBytes"`
	Width       int        `json:"width"`
	Height      int        `json:"height"`
	CreatedBy   string     `json:"createdBy" gorm:"size:36"`
	SyncedAt    *time.Time `json:"syncedAt,omitempty"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}
