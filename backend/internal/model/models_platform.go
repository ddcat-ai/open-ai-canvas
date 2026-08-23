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

type UserDailyUploadUsage struct {
	ID        string    `json:"id" gorm:"primaryKey;size:64"`
	UserID    string    `json:"userId" gorm:"size:36;index;uniqueIndex:idx_user_daily_upload_day,priority:1"`
	Day       string    `json:"day" gorm:"size:10;index;uniqueIndex:idx_user_daily_upload_day,priority:2"`
	Bytes     int64     `json:"bytes"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Skill struct {
	ID                string    `json:"id" gorm:"primaryKey;size:36"`
	OwnerID           string    `json:"ownerId" gorm:"index;size:36"`
	AuthorName        string    `json:"authorName" gorm:"size:120;index"`
	AuthorAvatarURL   string    `json:"authorAvatarUrl" gorm:"size:1000"`
	Name              string    `json:"name" gorm:"size:80;index"`
	Description       string    `json:"description" gorm:"size:500"`
	Instruction       string    `json:"instruction" gorm:"type:text"`
	Status            int       `json:"status" gorm:"index"`
	Source            int       `json:"source" gorm:"index"`
	Tag               string    `json:"tag" gorm:"size:32;index"`
	SortWeight        int       `json:"sortWeight" gorm:"index"`
	IsPrivate         bool      `json:"isPrivate" gorm:"index"`
	MarkdownURL       string    `json:"markdownUrl" gorm:"size:500"`
	ShowcaseMediaJSON string    `json:"-" gorm:"type:text"`
	ExtraInfo         string    `json:"extraInfo" gorm:"type:text"`
	InitialLikeCount  int64     `json:"initialLikeCount"`
	InitialAddedCount int64     `json:"initialAddedCount"`
	CreatedAt         time.Time `json:"createdAt" gorm:"index"`
	UpdatedAt         time.Time `json:"updatedAt" gorm:"index"`
}

type UserSkillState struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36;uniqueIndex:idx_user_skill_state_user_skill,priority:1"`
	SkillID   string    `json:"skillId" gorm:"size:36;index;uniqueIndex:idx_user_skill_state_user_skill,priority:2"`
	Added     bool      `json:"added" gorm:"index"`
	Liked     bool      `json:"liked" gorm:"index"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
