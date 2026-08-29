package model

import "time"

type UserDailyActivity struct {
	ID                string     `json:"id" gorm:"primaryKey;size:64"`
	Day               time.Time  `json:"day" gorm:"type:date;uniqueIndex:idx_user_daily_activity_day_user,priority:1;index"`
	UserID            string     `json:"userId" gorm:"size:36;uniqueIndex:idx_user_daily_activity_day_user,priority:2;index"`
	FirstActiveAt     *time.Time `json:"firstActiveAt"`
	LastActiveAt      *time.Time `json:"lastActiveAt"`
	LoginCount        int        `json:"loginCount"`
	TaskCount         int        `json:"taskCount"`
	AgentMessageCount int        `json:"agentMessageCount"`
	CanvasActive      bool       `json:"canvasActive"`
	AssetCount        int        `json:"assetCount"`
	ResourceCount     int        `json:"resourceCount"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
}

type SystemSetting struct {
	Key       string    `json:"key" gorm:"primaryKey;size:80"`
	ValueJSON string    `json:"valueJson" gorm:"type:text"`
	UpdatedBy string    `json:"updatedBy" gorm:"index;size:36"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ArkPrivateAssetBinding caches the approved Ark private-library asset for an
// immutable local Resource. Ark asset IDs are scoped to one Ark Project.
type ArkPrivateAssetBinding struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	UserID       string    `json:"userId" gorm:"index;size:36"`
	ResourceID   string    `json:"resourceId" gorm:"index;uniqueIndex:idx_ark_private_asset_binding_resource_project,priority:1;size:36"`
	ProjectName  string    `json:"projectName" gorm:"uniqueIndex:idx_ark_private_asset_binding_resource_project,priority:2;size:160"`
	AssetGroupID string    `json:"assetGroupId" gorm:"index;size:120"`
	ArkAssetID   string    `json:"arkAssetId" gorm:"index;size:120"`
	Status       string    `json:"status" gorm:"index;size:24"`
	Error        string    `json:"error" gorm:"type:text"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type UserOSSSetting struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36;index:idx_user_oss_settings_user_created,priority:1"`
	Enabled   bool      `json:"enabled" gorm:"index"`
	ValueJSON string    `json:"-" gorm:"type:text"`
	CreatedAt time.Time `json:"createdAt" gorm:"index:idx_user_oss_settings_user_created,priority:2"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// StorageLocation is an immutable object-storage address. Credentials may be
// rotated in place, while resources keep referring to the same location ID.
type StorageLocation struct {
	ID             string     `json:"id" gorm:"primaryKey;size:36"`
	Scope          string     `json:"scope" gorm:"size:16;index:idx_storage_locations_scope_owner_active,priority:1;uniqueIndex:idx_storage_locations_identity,priority:1"`
	OwnerID        string     `json:"ownerId" gorm:"size:36;index:idx_storage_locations_scope_owner_active,priority:2;uniqueIndex:idx_storage_locations_identity,priority:2"`
	Provider       string     `json:"provider" gorm:"size:24;index;uniqueIndex:idx_storage_locations_identity,priority:3"`
	LocationDigest string     `json:"-" gorm:"size:64;uniqueIndex:idx_storage_locations_identity,priority:4"`
	ValueJSON      string     `json:"-" gorm:"type:text"`
	TestedDigest   string     `json:"-" gorm:"size:64"`
	TestedAt       *time.Time `json:"testedAt,omitempty"`
	Active         bool       `json:"active" gorm:"index:idx_storage_locations_scope_owner_active,priority:3"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type UserDailyUploadUsage struct {
	ID        string    `json:"id" gorm:"primaryKey;size:64"`
	UserID    string    `json:"userId" gorm:"size:36;index;uniqueIndex:idx_user_daily_upload_day,priority:1"`
	Day       string    `json:"day" gorm:"size:10;index;uniqueIndex:idx_user_daily_upload_day,priority:2"`
	Bytes     int64     `json:"bytes"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Skill struct {
	ID                string     `json:"id" gorm:"primaryKey;size:36"`
	OwnerID           string     `json:"ownerId" gorm:"index;size:36"`
	AuthorName        string     `json:"authorName" gorm:"size:120;index"`
	AuthorAvatarURL   string     `json:"authorAvatarUrl" gorm:"size:1000"`
	Name              string     `json:"name" gorm:"size:80;index"`
	Description       string     `json:"description" gorm:"size:500"`
	Instruction       string     `json:"instruction" gorm:"type:text"`
	CurrentVersionID  string     `json:"currentVersionId" gorm:"size:36;index"`
	VersionLabel      string     `json:"versionLabel" gorm:"size:64"`
	ContentHash       string     `json:"contentHash" gorm:"size:64;index"`
	FileCount         int        `json:"fileCount"`
	TotalBytes        int64      `json:"totalBytes"`
	SourceType        string     `json:"sourceType" gorm:"size:24;index"`
	SourceURL         string     `json:"sourceUrl" gorm:"size:1000"`
	SourceRef         string     `json:"sourceRef" gorm:"size:255"`
	SourceSubdir      string     `json:"sourceSubdir" gorm:"size:1000"`
	SourceCommit      string     `json:"sourceCommit" gorm:"size:64"`
	SyncStatus        string     `json:"syncStatus" gorm:"size:24;index"`
	SyncError         string     `json:"syncError" gorm:"type:text"`
	AutoUpdate        bool       `json:"autoUpdate" gorm:"index"`
	LastCheckedAt     *time.Time `json:"lastCheckedAt"`
	LastSyncedAt      *time.Time `json:"lastSyncedAt"`
	Status            int        `json:"status" gorm:"index"`
	Source            int        `json:"source" gorm:"index"`
	Tag               string     `json:"tag" gorm:"size:32;index"`
	SortWeight        int        `json:"sortWeight" gorm:"index"`
	IsPrivate         bool       `json:"isPrivate" gorm:"index"`
	MarkdownURL       string     `json:"markdownUrl" gorm:"size:500"`
	ShowcaseMediaJSON string     `json:"-" gorm:"type:text"`
	ExtraInfo         string     `json:"extraInfo" gorm:"type:text"`
	InitialLikeCount  int64      `json:"initialLikeCount"`
	InitialAddedCount int64      `json:"initialAddedCount"`
	CreatedAt         time.Time  `json:"createdAt" gorm:"index"`
	UpdatedAt         time.Time  `json:"updatedAt" gorm:"index"`
}

type SkillVersion struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	SkillID      string    `json:"skillId" gorm:"size:36;index"`
	VersionLabel string    `json:"versionLabel" gorm:"size:64"`
	ContentHash  string    `json:"contentHash" gorm:"size:64;index"`
	EntryPath    string    `json:"entryPath" gorm:"size:1000"`
	PackageKey   string    `json:"packageKey" gorm:"size:1000"`
	FileCount    int       `json:"fileCount"`
	TotalBytes   int64     `json:"totalBytes"`
	SourceCommit string    `json:"sourceCommit" gorm:"size:64"`
	CreatedAt    time.Time `json:"createdAt" gorm:"index"`
}

type SkillFile struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	SkillVersionID string    `json:"skillVersionId" gorm:"size:36;index;uniqueIndex:idx_skill_version_file_path,priority:1"`
	Path           string    `json:"path" gorm:"size:1000;uniqueIndex:idx_skill_version_file_path,priority:2"`
	Kind           string    `json:"kind" gorm:"size:24;index"`
	MimeType       string    `json:"mimeType" gorm:"size:255"`
	Size           int64     `json:"size"`
	SHA256         string    `json:"sha256" gorm:"size:64"`
	CreatedAt      time.Time `json:"createdAt"`
}

type UserSkillState struct {
	ID                 string    `json:"id" gorm:"primaryKey;size:36"`
	UserID             string    `json:"userId" gorm:"index;size:36;uniqueIndex:idx_user_skill_state_user_skill,priority:1"`
	SkillID            string    `json:"skillId" gorm:"size:36;index;uniqueIndex:idx_user_skill_state_user_skill,priority:2"`
	InstalledVersionID string    `json:"installedVersionId" gorm:"size:36;index"`
	AutoUpdate         bool      `json:"autoUpdate"`
	Added              bool      `json:"added" gorm:"index"`
	Liked              bool      `json:"liked" gorm:"index"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}
