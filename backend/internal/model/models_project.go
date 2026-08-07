package model

import "time"

type Resource struct {
	ID       string         `json:"id" gorm:"primaryKey;size:36"`
	UserID   string         `json:"userId" gorm:"index;size:36;index:idx_resources_user_created,priority:1"`
	Kind     string         `json:"kind" gorm:"index;size:24"`
	Status   ResourceStatus `json:"status" gorm:"index;size:24"`
	Provider string         `json:"provider" gorm:"size:24"`
	Endpoint string         `json:"endpoint"`
	Bucket   string         `json:"bucket" gorm:"size:160"`
	// 用户 OSS 每次修改都会生成新版本，资源固定引用创建时的版本，避免历史资源因换密钥失效。
	StorageSettingID string    `json:"-" gorm:"index;size:36"`
	ObjectKey        string    `json:"objectKey" gorm:"index"`
	PublicURL        string    `json:"publicUrl"`
	MimeType         string    `json:"mimeType" gorm:"size:120"`
	Size             int64     `json:"size"`
	Width            int       `json:"width"`
	Height           int       `json:"height"`
	DurationMs       int64     `json:"durationMs"`
	ETag             string    `json:"etag" gorm:"size:160"`
	Error            string    `json:"error"`
	CreatedAt        time.Time `json:"createdAt" gorm:"index:idx_resources_user_created,priority:2"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type Asset struct {
	ID               string             `json:"id" gorm:"primaryKey;size:36"`
	UserID           string             `json:"userId" gorm:"index;size:36;index:idx_assets_user_updated,priority:1"`
	Kind             string             `json:"kind" gorm:"index;size:24"`
	Category         AssetCategory      `json:"category" gorm:"index;size:32"`
	Status           AssetVersionStatus `json:"status" gorm:"index;size:24"`
	PrimaryVersionID string             `json:"primaryVersionId,omitempty" gorm:"index;size:36"`
	Title            string             `json:"title" gorm:"size:240"`
	PayloadJSON      string             `json:"payloadJson" gorm:"type:text"`
	CreatedAt        time.Time          `json:"createdAt"`
	UpdatedAt        time.Time          `json:"updatedAt" gorm:"index:idx_assets_user_updated,priority:2"`
}

type ProjectAssetLink struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID string    `json:"projectId" gorm:"index;size:36;uniqueIndex:idx_project_asset_links_unique,priority:1"`
	AssetID   string    `json:"assetId" gorm:"index;size:36;uniqueIndex:idx_project_asset_links_unique,priority:2"`
	CreatedAt time.Time `json:"createdAt"`
}

type ProjectAssetCandidate struct {
	ID              string        `json:"id" gorm:"primaryKey;size:36"`
	ProjectID       string        `json:"projectId" gorm:"index;size:36"`
	UnitID          string        `json:"unitId,omitempty" gorm:"index;size:36"`
	ShotID          string        `json:"shotId,omitempty" gorm:"index;size:36"`
	Name            string        `json:"name" gorm:"size:240"`
	Category        AssetCategory `json:"category" gorm:"index;size:32"`
	Status          string        `json:"status" gorm:"index;size:32"`
	DetailsJSON     string        `json:"detailsJson" gorm:"type:text"`
	ResolvedAssetID string        `json:"resolvedAssetId,omitempty" gorm:"index;size:36"`
	CreatedAt       time.Time     `json:"createdAt"`
	UpdatedAt       time.Time     `json:"updatedAt"`
}

type AssetVersion struct {
	ID             string             `json:"id" gorm:"primaryKey;size:36"`
	AssetID        string             `json:"assetId" gorm:"index;size:36;uniqueIndex:idx_asset_versions_number,priority:1"`
	Version        int                `json:"version" gorm:"uniqueIndex:idx_asset_versions_number,priority:2"`
	Status         AssetVersionStatus `json:"status" gorm:"index;size:24"`
	DefinitionJSON string             `json:"definitionJson" gorm:"type:text"`
	Prompt         string             `json:"prompt" gorm:"type:text"`
	Note           string             `json:"note" gorm:"size:500"`
	CreatedAt      time.Time          `json:"createdAt"`
	UpdatedAt      time.Time          `json:"updatedAt"`
}

type AssetRepresentation struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	TaskID         string    `json:"taskId,omitempty" gorm:"index;size:36;uniqueIndex:idx_asset_representations_task_role,priority:1"`
	AssetVersionID string    `json:"assetVersionId" gorm:"index;size:36;uniqueIndex:idx_asset_representations_version_role,priority:1"`
	ResourceID     string    `json:"resourceId,omitempty" gorm:"index;size:36"`
	MediaType      string    `json:"mediaType" gorm:"index;size:24"`
	Role           string    `json:"role" gorm:"index;size:32;uniqueIndex:idx_asset_representations_task_role,priority:2;uniqueIndex:idx_asset_representations_version_role,priority:2"`
	MetadataJSON   string    `json:"metadataJson" gorm:"type:text"`
	CreatedAt      time.Time `json:"createdAt"`
}

// VoiceProfile 是可复用的声音身份；试听音频只是表现资源，不等同于声音本身。
type VoiceProfile struct {
	ID                   string    `json:"id" gorm:"primaryKey;size:36"`
	UserID               string    `json:"userId" gorm:"index;size:36;uniqueIndex:idx_voice_profiles_user_provider_key,priority:1"`
	Name                 string    `json:"name" gorm:"size:160"`
	Provider             string    `json:"provider" gorm:"size:48;uniqueIndex:idx_voice_profiles_user_provider_key,priority:2"`
	VoiceKey             string    `json:"voiceKey" gorm:"size:160;uniqueIndex:idx_voice_profiles_user_provider_key,priority:3"`
	Language             string    `json:"language" gorm:"size:80"`
	Timbre               string    `json:"timbre" gorm:"size:240"`
	SampleResourceID     string    `json:"sampleResourceId,omitempty" gorm:"index;size:36"`
	CompatibleModelsJSON string    `json:"compatibleModelsJson" gorm:"type:text"`
	Status               string    `json:"status" gorm:"index;size:24"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type CharacterVoiceBinding struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	AssetVersionID string    `json:"assetVersionId" gorm:"uniqueIndex;size:36"`
	VoiceProfileID string    `json:"voiceProfileId" gorm:"index;size:36"`
	Instructions   string    `json:"instructions" gorm:"type:text"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// Project 是短剧领域聚合根；CanvasProject 仍代表可独立创作的画布文档。
type Project struct {
	ID               string        `json:"id" gorm:"primaryKey;size:36"`
	UserID           string        `json:"userId" gorm:"index;size:36;uniqueIndex:idx_projects_user_name,priority:1"`
	Name             string        `json:"name" gorm:"size:240;uniqueIndex:idx_projects_user_name,priority:2"`
	Type             string        `json:"type" gorm:"size:32;index"`
	AspectRatio      string        `json:"aspectRatio" gorm:"size:16"`
	SourceType       string        `json:"sourceType" gorm:"size:32"`
	Description      string        `json:"description" gorm:"type:text"`
	StylePresetID    string        `json:"stylePresetId" gorm:"size:64"`
	StyleProfileJSON string        `json:"styleProfileJson" gorm:"type:text"`
	Status           ProjectStatus `json:"status" gorm:"index;size:24"`
	Revision         int64         `json:"revision"`
	CreatedAt        time.Time     `json:"createdAt"`
	UpdatedAt        time.Time     `json:"updatedAt" gorm:"index"`
}

// StyleProfile 是用户可持续编辑的风格源；项目只保存应用当时的 JSON 快照，避免源对象更新污染历史生成。
type StyleProfile struct {
	ID          string     `json:"id" gorm:"primaryKey;size:36"`
	UserID      string     `json:"userId" gorm:"index;size:36;index:idx_style_profiles_user_updated,priority:1"`
	Name        string     `json:"name" gorm:"size:160"`
	Description string     `json:"description" gorm:"size:500"`
	CoverURL    string     `json:"coverUrl" gorm:"type:text"`
	TagsJSON    string     `json:"tagsJson" gorm:"type:text"`
	ProfileJSON string     `json:"profileJson" gorm:"type:text"`
	Favorite    bool       `json:"favorite" gorm:"index"`
	LastUsedAt  *time.Time `json:"lastUsedAt,omitempty" gorm:"index"`
	Revision    int64      `json:"revision"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt" gorm:"index:idx_style_profiles_user_updated,priority:2"`
}

type ProjectUnit struct {
	ID         string            `json:"id" gorm:"primaryKey;size:36"`
	ProjectID  string            `json:"projectId" gorm:"index;size:36"`
	ParentID   string            `json:"parentId,omitempty" gorm:"index;size:36"`
	Kind       ProjectUnitKind   `json:"kind" gorm:"index;size:24"`
	Title      string            `json:"title" gorm:"size:240"`
	SourceText string            `json:"sourceText" gorm:"type:text"`
	Status     ProjectUnitStatus `json:"status" gorm:"index;size:24"`
	Position   int               `json:"position"`
	CreatedAt  time.Time         `json:"createdAt"`
	UpdatedAt  time.Time         `json:"updatedAt"`
}

type CanvasUnitLink struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID string    `json:"projectId" gorm:"index;size:36;uniqueIndex:idx_canvas_unit_links_unique,priority:1"`
	CanvasID  string    `json:"canvasId" gorm:"index;size:80;uniqueIndex:idx_canvas_unit_links_unique,priority:2"`
	UnitID    string    `json:"unitId" gorm:"index;size:36;uniqueIndex:idx_canvas_unit_links_unique,priority:3"`
	Role      string    `json:"role" gorm:"size:32"`
	CreatedAt time.Time `json:"createdAt"`
}

type Shot struct {
	ID          string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID   string    `json:"projectId" gorm:"index;size:36"`
	UnitID      string    `json:"unitId" gorm:"index;size:36"`
	Title       string    `json:"title" gorm:"size:240"`
	Description string    `json:"description" gorm:"type:text"`
	Position    int       `json:"position"`
	DurationMs  int64     `json:"durationMs"`
	Status      string    `json:"status" gorm:"index;size:24"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type ShotAssetReference struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	ShotID         string    `json:"shotId" gorm:"index;size:36;uniqueIndex:idx_shot_asset_reference_unique,priority:1"`
	AssetVersionID string    `json:"assetVersionId" gorm:"index;size:36;uniqueIndex:idx_shot_asset_reference_unique,priority:2"`
	Role           string    `json:"role" gorm:"index;size:32;uniqueIndex:idx_shot_asset_reference_unique,priority:3"`
	Status         string    `json:"status" gorm:"index;size:24"`
	CreatedAt      time.Time `json:"createdAt"`
}

type WorkflowTemplateVersion struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	TemplateKey    string    `json:"templateKey" gorm:"size:80;uniqueIndex:idx_workflow_template_version,priority:1"`
	Name           string    `json:"name" gorm:"size:160"`
	Version        int       `json:"version" gorm:"uniqueIndex:idx_workflow_template_version,priority:2"`
	DefinitionJSON string    `json:"definitionJson" gorm:"type:text"`
	CreatedAt      time.Time `json:"createdAt"`
}

type WorkflowInstance struct {
	ID                string         `json:"id" gorm:"primaryKey;size:36"`
	ProjectID         string         `json:"projectId" gorm:"index;size:36;uniqueIndex:idx_workflow_instance_scope,priority:1"`
	UnitID            string         `json:"unitId,omitempty" gorm:"index;size:36;uniqueIndex:idx_workflow_instance_scope,priority:2"`
	TemplateVersionID string         `json:"templateVersionId" gorm:"index;size:36;uniqueIndex:idx_workflow_instance_scope,priority:3"`
	Scope             string         `json:"scope" gorm:"index;size:24"`
	Status            WorkflowStatus `json:"status" gorm:"index;size:24"`
	Revision          int64          `json:"revision"`
	CreatedAt         time.Time      `json:"createdAt"`
	UpdatedAt         time.Time      `json:"updatedAt"`
}

type WorkflowStepInstance struct {
	ID                 string             `json:"id" gorm:"primaryKey;size:36"`
	WorkflowInstanceID string             `json:"workflowInstanceId" gorm:"index;size:36;uniqueIndex:idx_workflow_steps_instance_key,priority:1"`
	StepKey            string             `json:"stepKey" gorm:"size:80;uniqueIndex:idx_workflow_steps_instance_key,priority:2"`
	Name               string             `json:"name" gorm:"size:160"`
	Position           int                `json:"position"`
	Status             WorkflowStepStatus `json:"status" gorm:"index;size:24"`
	InputJSON          string             `json:"inputJson" gorm:"type:text"`
	OutputJSON         string             `json:"outputJson" gorm:"type:text"`
	Error              string             `json:"error" gorm:"type:text"`
	StartedAt          *time.Time         `json:"startedAt"`
	CompletedAt        *time.Time         `json:"completedAt"`
	CreatedAt          time.Time          `json:"createdAt"`
	UpdatedAt          time.Time          `json:"updatedAt"`
}

type WorkflowStepTask struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	WorkflowStepID string    `json:"workflowStepId" gorm:"index;size:36;uniqueIndex:idx_workflow_step_tasks_unique,priority:1"`
	TaskID         string    `json:"taskId" gorm:"index;size:36;uniqueIndex:idx_workflow_step_tasks_unique,priority:2"`
	CreatedAt      time.Time `json:"createdAt"`
}

type CanvasProject struct {
	ID          string    `json:"id" gorm:"primaryKey;size:80"`
	UserID      string    `json:"userId" gorm:"index;size:36;index:idx_canvas_projects_user_updated,priority:1"`
	ProjectID   string    `json:"projectId,omitempty" gorm:"index;size:36"`
	Title       string    `json:"title" gorm:"size:240"`
	PayloadJSON string    `json:"payloadJson" gorm:"type:text"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt" gorm:"index:idx_canvas_projects_user_updated,priority:2"`
}

type CanvasShare struct {
	ID          string     `json:"id" gorm:"primaryKey;size:36"`
	UserID      string     `json:"userId" gorm:"index;size:36;uniqueIndex:idx_canvas_share_owner_project,priority:1"`
	ProjectID   string     `json:"projectId" gorm:"index;size:80;uniqueIndex:idx_canvas_share_owner_project,priority:2"`
	TokenHash   string     `json:"-" gorm:"uniqueIndex;size:64"`
	TokenCipher string     `json:"-" gorm:"type:text"`
	Enabled     bool       `json:"enabled" gorm:"index"`
	ExpiresAt   *time.Time `json:"expiresAt" gorm:"index"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type PromptTemplate struct {
	ID         string    `json:"id" gorm:"primaryKey;size:36"`
	Operation  string    `json:"operation" gorm:"size:64;index;uniqueIndex:idx_prompt_template_operation_version,priority:1"`
	Name       string    `json:"name" gorm:"size:120"`
	Version    int       `json:"version" gorm:"uniqueIndex:idx_prompt_template_operation_version,priority:2"`
	Content    string    `json:"content" gorm:"type:text"`
	OutputType string    `json:"outputType" gorm:"size:24"`
	Enabled    bool      `json:"enabled" gorm:"index;index:idx_prompt_template_active,priority:2"`
	CreatedBy  string    `json:"createdBy" gorm:"index;size:36"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// UserPromptCustomization 只保存用户的创作策略层，动态上下文和输出契约始终由服务端编译器注入。
type UserPromptCustomization struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	UserID         string    `json:"userId" gorm:"size:36;index;uniqueIndex:idx_user_prompt_operation,priority:1"`
	Operation      string    `json:"operation" gorm:"size:64;index;uniqueIndex:idx_user_prompt_operation,priority:2"`
	Mode           string    `json:"mode" gorm:"size:24"`
	Content        string    `json:"content" gorm:"type:text"`
	BaseTemplateID string    `json:"baseTemplateId" gorm:"size:36;index"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type Announcement struct {
	ID          string             `json:"id" gorm:"primaryKey;size:36"`
	Title       string             `json:"title" gorm:"size:120"`
	Content     string             `json:"content" gorm:"type:text"`
	Level       AnnouncementLevel  `json:"level" gorm:"index;size:24"`
	Status      AnnouncementStatus `json:"status" gorm:"index;size:24;index:idx_announcements_status_published,priority:1"`
	CreatedBy   string             `json:"createdBy" gorm:"index;size:36"`
	PublishedAt time.Time          `json:"publishedAt" gorm:"index:idx_announcements_status_published,priority:2"`
	ClosedAt    *time.Time         `json:"closedAt"`
	CreatedAt   time.Time          `json:"createdAt"`
	UpdatedAt   time.Time          `json:"updatedAt"`
}

type UserAnnouncementRead struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	UserID         string    `json:"userId" gorm:"index;size:36;uniqueIndex:idx_user_announcement_read,priority:1"`
	AnnouncementID string    `json:"announcementId" gorm:"index;size:36;uniqueIndex:idx_user_announcement_read,priority:2"`
	ReadAt         time.Time `json:"readAt"`
}
