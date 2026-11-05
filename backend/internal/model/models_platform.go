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

// ArkPortraitSession 是一次方舟真人认证（H5 活体）会话。State 是回调地址里的一次性随机凭据，
// BytedToken 加密保存，30 分钟内用于换取本次认证创建的真人素材组 ID。
// Scope 为 user 时由用户自建，可能冻结素材组费用（BillingOrderID）；platform 由管理员为平台素材组发起，不收费。
type ArkPortraitSession struct {
	ID               string    `json:"id" gorm:"primaryKey;size:36"`
	UserID           string    `json:"userId" gorm:"index;size:36"`
	Scope            string    `json:"scope" gorm:"size:16;not null;default:user"`
	State            string    `json:"-" gorm:"uniqueIndex;size:64"`
	Name             string    `json:"name" gorm:"size:80"`
	Description      string    `json:"description" gorm:"size:500;not null;default:''"`
	Site             string    `json:"site" gorm:"size:24"`
	Region           string    `json:"region" gorm:"size:40"`
	ProjectName      string    `json:"projectName" gorm:"size:160"`
	BytedTokenCipher string    `json:"-" gorm:"type:text"`
	Status           string    `json:"status" gorm:"index;size:24"`
	ResultCode       string    `json:"resultCode,omitempty" gorm:"size:40"`
	GroupID          string    `json:"groupId,omitempty" gorm:"size:120"`
	Error            string    `json:"error,omitempty" gorm:"size:1000"`
	BillingOrderID   string    `json:"-" gorm:"size:36;not null;default:''"`
	ExpiresAt        time.Time `json:"expiresAt" gorm:"index"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

// ArkPortraitGroup 是平台方舟账号下的一个素材组。Kind 区分真人（LivenessFace，只能经 H5 认证生成）、
// 虚拟与版权 IP（AIGC）；Scope=user 只属于创建者本人，Scope=platform 由管理员创建并按授权给用户只读使用。
// 真人组的 ExpiresAt 是授权到期时间，到期后不能再上传或用于生成。
type ArkPortraitGroup struct {
	ID             string     `json:"id" gorm:"primaryKey;size:36"`
	UserID         string     `json:"userId" gorm:"index;size:36"`
	Kind           string     `json:"kind" gorm:"size:16;not null;default:real;index"`
	Scope          string     `json:"scope" gorm:"size:16;not null;default:user;index"`
	Name           string     `json:"name" gorm:"size:80"`
	Description    string     `json:"description" gorm:"size:500;not null;default:''"`
	Site           string     `json:"site" gorm:"size:24"`
	Region         string     `json:"region" gorm:"size:40"`
	ProjectName    string     `json:"projectName" gorm:"uniqueIndex:idx_ark_portrait_group_project,priority:1;size:160"`
	GroupID        string     `json:"groupId" gorm:"uniqueIndex:idx_ark_portrait_group_project,priority:2;size:120"`
	Source         string     `json:"source" gorm:"size:24"`
	GrantAll       bool       `json:"grantAll" gorm:"not null;default:false"`
	AuthorizedAt   *time.Time `json:"authorizedAt"`
	ExpiresAt      *time.Time `json:"expiresAt"`
	BillingOrderID string     `json:"-" gorm:"size:36;not null;default:''"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// ArkPortraitAsset 是素材组内的一份素材。需要平台审核时先为 pending_review，管理员通过后才提交方舟；
// 方舟审核通过（active）后，LibraryAssetID 指向素材库中被认证的素材。
type ArkPortraitAsset struct {
	ID             string     `json:"id" gorm:"primaryKey;size:36"`
	UserID         string     `json:"userId" gorm:"index;size:36"`
	GroupID        string     `json:"groupId" gorm:"index;size:36"`
	ResourceID     string     `json:"resourceId" gorm:"index;size:36"`
	ArkAssetID     string     `json:"arkAssetId" gorm:"index;size:120"`
	AssetType      string     `json:"assetType" gorm:"size:16"`
	Name           string     `json:"name" gorm:"size:120"`
	Status         string     `json:"status" gorm:"index;size:24"`
	Error          string     `json:"error,omitempty" gorm:"size:1000"`
	LibraryAssetID string     `json:"libraryAssetId,omitempty" gorm:"size:80;not null;default:'';index"`
	ReviewedBy     string     `json:"reviewedBy,omitempty" gorm:"size:36;not null;default:''"`
	ReviewedAt     *time.Time `json:"reviewedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

// BillingSceneArkAssetGroup 是方舟素材组费用的计费场景：按组一次性收费，不关联生成任务。
const BillingSceneArkAssetGroup = "ark_asset_group"

// ArkPortraitGroupGrant 记录平台素材组授权给的单个用户；GrantAll 的组不逐个写入。
type ArkPortraitGroupGrant struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	GroupID   string    `json:"groupId" gorm:"size:36;uniqueIndex:idx_ark_portrait_grant_group_user,priority:1"`
	UserID    string    `json:"userId" gorm:"size:36;index;uniqueIndex:idx_ark_portrait_grant_group_user,priority:2"`
	CreatedBy string    `json:"createdBy" gorm:"size:36"`
	CreatedAt time.Time `json:"createdAt"`
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
	// AdminInfoEditedAt / AdminContentEditedAt 记录管理员最近一次修改基本信息 / 文件内容的时间（Schema 83）。
	// 内置技能启动同步不再覆盖管理员改过的部分；GitHub 同步在 AdminInfoEditedAt 非空时保留名称和简介。
	AdminInfoEditedAt    *time.Time `json:"adminInfoEditedAt"`
	AdminContentEditedAt *time.Time `json:"adminContentEditedAt"`
	CreatedAt            time.Time  `json:"createdAt" gorm:"index"`
	UpdatedAt            time.Time  `json:"updatedAt" gorm:"index"`
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

// SkillLibraryCategory separates a user's library taxonomy from Skill.Tag,
// which remains the shared marketplace category.
type SkillLibraryCategory struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	Name           string    `json:"name" gorm:"size:64;not null"`
	NormalizedName string    `json:"-" gorm:"size:96;not null;uniqueIndex:idx_skill_library_category_scope_owner_name,priority:3"`
	Scope          string    `json:"scope" gorm:"size:16;not null;uniqueIndex:idx_skill_library_category_scope_owner_name,priority:1;index"`
	OwnerID        string    `json:"-" gorm:"size:36;not null;uniqueIndex:idx_skill_library_category_scope_owner_name,priority:2;index"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type UserSkillState struct {
	ID                 string `json:"id" gorm:"primaryKey;size:36"`
	UserID             string `json:"userId" gorm:"index;size:36;uniqueIndex:idx_user_skill_state_user_skill,priority:1"`
	SkillID            string `json:"skillId" gorm:"size:36;index;uniqueIndex:idx_user_skill_state_user_skill,priority:2"`
	LibraryCategoryID  string `json:"libraryCategoryId" gorm:"size:36;index"`
	InstalledVersionID string `json:"installedVersionId" gorm:"size:36;index"`
	AutoUpdate         bool   `json:"autoUpdate"`
	Added              bool   `json:"added" gorm:"index"`
	Liked              bool   `json:"liked" gorm:"index"`
	// AgentMode 为空或 auto 时 Agent 可以自动发现该技能；manual 只在用户点名或固定时使用。
	AgentMode string `json:"agentMode,omitempty" gorm:"size:16"`
	// AgentUseCount / AgentLastUsedAt 只记录 Agent 实际读取，用于决定目录里谁优先列出。
	AgentUseCount   int64      `json:"agentUseCount"`
	AgentLastUsedAt *time.Time `json:"agentLastUsedAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

const (
	UserSkillAgentModeAuto   = "auto"
	UserSkillAgentModeManual = "manual"
)

type Tool struct {
	ID            int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	Type          string    `json:"type" gorm:"size:24;index"`
	LabelEn       string    `json:"labelEn" gorm:"size:120;index"`
	Label         string    `json:"label" gorm:"size:120"`
	Desc          string    `json:"desc" gorm:"size:500"`
	Tag           string    `json:"tag" gorm:"size:64;index"`
	Cover         string    `json:"cover" gorm:"size:500"`
	ExtraInfoJSON string    `json:"-" gorm:"type:text"`
	Prompt        string    `json:"prompt" gorm:"type:text"`
	Ratio         string    `json:"ratio" gorm:"size:32"`
	MediaURL      string    `json:"mediaUrl" gorm:"size:500"`
	OwnerID       string    `json:"ownerId" gorm:"size:36;index"`
	Source        string    `json:"source" gorm:"size:16;index"`
	Enabled       bool      `json:"enabled" gorm:"index"`
	Visibility    string    `json:"visibility" gorm:"size:16;index"`
	SortWeight    int       `json:"sortWeight" gorm:"index"`
	CreatedAt     time.Time `json:"createdAt" gorm:"index"`
	UpdatedAt     time.Time `json:"updatedAt" gorm:"index"`
}

// ToolFavorite 保存用户对工具的收藏关系；一个用户对同一工具只能收藏一次。
type ToolFavorite struct {
	ID        int64     `json:"id" gorm:"primaryKey;autoIncrement"`
	UserID    string    `json:"userId" gorm:"size:36;index;uniqueIndex:idx_tool_favorite_user_tool,priority:1"`
	ToolID    int64     `json:"toolId" gorm:"index;uniqueIndex:idx_tool_favorite_user_tool,priority:2"`
	CreatedAt time.Time `json:"createdAt" gorm:"index"`
}
