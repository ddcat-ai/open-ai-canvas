package model

import (
	"html"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var projectUnitHTMLTagPattern = regexp.MustCompile(`<[^>]+>`)

func ProjectUnitWordCount(sourceText string) int {
	plainText := projectUnitHTMLTagPattern.ReplaceAllString(sourceText, "")
	return utf8.RuneCountInString(strings.TrimSpace(html.UnescapeString(plainText)))
}

const AssetIDMaxLength = 80

type Resource struct {
	ID       string         `json:"id" gorm:"primaryKey;size:36"`
	UserID   string         `json:"userId" gorm:"index;size:36;index:idx_resources_user_created,priority:1;uniqueIndex:idx_resources_user_upload_key,priority:1"`
	Kind     string         `json:"kind" gorm:"index;size:24"`
	Status   ResourceStatus `json:"status" gorm:"index;size:24"`
	Provider string         `json:"provider" gorm:"size:24"`
	Endpoint string         `json:"endpoint"`
	Bucket   string         `json:"bucket" gorm:"size:160"`
	// 用户 OSS 每次修改都会生成新版本，资源固定引用创建时的存储与密钥；只有同一存储位置才可复用当前 CDN。
	StorageSettingID string `json:"-" gorm:"index;size:36"`
	ObjectKey        string `json:"objectKey" gorm:"index"`
	PublicURL        string `json:"publicUrl"`
	MimeType         string `json:"mimeType" gorm:"size:120"`
	Size             int64  `json:"size"`
	Width            int    `json:"width"`
	Height           int    `json:"height"`
	DurationMs       int64  `json:"durationMs"`
	ETag             string `json:"etag" gorm:"size:160"`
	// UploadKey 是客户端逻辑上传身份的摘要；NULL 表示不参与幂等约束。
	UploadKey *string   `json:"-" gorm:"size:64;uniqueIndex:idx_resources_user_upload_key,priority:2"`
	Error     string    `json:"error"`
	CreatedAt time.Time `json:"createdAt" gorm:"index:idx_resources_user_created,priority:2"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ResourceDeletionJob is the durable handoff between database deletion and
// physical object cleanup. Storage fields are frozen because the Resource row
// is removed in the same transaction that creates this job.
type ResourceDeletionJob struct {
	ID               string                 `json:"id" gorm:"primaryKey;size:36"`
	UserID           string                 `json:"userId" gorm:"index;size:36"`
	ResourceID       string                 `json:"resourceId" gorm:"index;size:36"`
	Provider         string                 `json:"provider" gorm:"size:24"`
	Endpoint         string                 `json:"endpoint"`
	Bucket           string                 `json:"bucket" gorm:"size:160"`
	StorageSettingID string                 `json:"-" gorm:"index;size:36"`
	ObjectKey        string                 `json:"objectKey" gorm:"index"`
	Status           ResourceDeletionStatus `json:"status" gorm:"index:idx_resource_deletion_jobs_due,priority:1;size:24"`
	Attempts         int                    `json:"attempts"`
	LastError        string                 `json:"lastError" gorm:"type:text"`
	NextAttemptAt    time.Time              `json:"nextAttemptAt" gorm:"index:idx_resource_deletion_jobs_due,priority:2"`
	LeaseOwner       string                 `json:"-" gorm:"index;size:120"`
	LeaseExpiresAt   *time.Time             `json:"-" gorm:"index"`
	CreatedAt        time.Time              `json:"createdAt"`
	UpdatedAt        time.Time              `json:"updatedAt"`
}

// AnnouncementImageDraft marks an uploaded image as temporary until an
// announcement create or update transaction consumes it.
type AnnouncementImageDraft struct {
	ResourceID string    `json:"resourceId" gorm:"primaryKey;size:36"`
	UserID     string    `json:"userId" gorm:"index;size:36"`
	CreatedAt  time.Time `json:"createdAt" gorm:"index"`
}

type Asset struct {
	ID               string             `json:"id" gorm:"primaryKey;size:80"`
	UserID           string             `json:"userId" gorm:"index;size:36;index:idx_assets_user_updated,priority:1"`
	FolderID         string             `json:"folderId,omitempty" gorm:"index;size:36"`
	Kind             string             `json:"kind" gorm:"index;size:24"`
	Category         AssetCategory      `json:"category" gorm:"index;size:32"`
	Status           AssetVersionStatus `json:"status" gorm:"index;size:24"`
	PrimaryVersionID string             `json:"primaryVersionId,omitempty" gorm:"index;size:36"`
	Title            string             `json:"title" gorm:"size:240"`
	PayloadJSON      string             `json:"payloadJson" gorm:"type:text"`
	CreatedAt        time.Time          `json:"createdAt"`
	UpdatedAt        time.Time          `json:"updatedAt" gorm:"index:idx_assets_user_updated,priority:2"`
}

// AssetFolder 是用户素材库的一层自定义分类；业务分类仍由 Asset.Category 表达。
type AssetFolder struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36;uniqueIndex:idx_asset_folders_user_name,priority:1"`
	Name      string    `json:"name" gorm:"size:80"`
	NameKey   string    `json:"-" gorm:"size:80;uniqueIndex:idx_asset_folders_user_name,priority:2"`
	Position  int       `json:"position" gorm:"index"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ProjectAssetLink struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID string    `json:"projectId" gorm:"index;size:36;uniqueIndex:idx_project_asset_links_unique,priority:1;index:idx_project_asset_links_project_folder_position,priority:1"`
	AssetID   string    `json:"assetId" gorm:"index;size:80;uniqueIndex:idx_project_asset_links_unique,priority:2"`
	FolderID  string    `json:"folderId,omitempty" gorm:"index;size:36;index:idx_project_asset_links_project_folder_position,priority:2"`
	Position  int       `json:"position" gorm:"index;index:idx_project_asset_links_project_folder_position,priority:3"`
	CreatedAt time.Time `json:"createdAt"`
}

// ProjectAssetFolder 只保存项目内的目录结构；真实媒体仍由 Asset/Resource 唯一持有。
type ProjectAssetFolder struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID string    `json:"projectId" gorm:"index;size:36;uniqueIndex:idx_project_asset_folders_sibling_name,priority:1"`
	ParentID  string    `json:"parentId,omitempty" gorm:"index;size:36;uniqueIndex:idx_project_asset_folders_sibling_name,priority:2"`
	Name      string    `json:"name" gorm:"size:240"`
	NameKey   string    `json:"-" gorm:"size:240;uniqueIndex:idx_project_asset_folders_sibling_name,priority:3"`
	Style     string    `json:"style" gorm:"size:24"`
	Theme     string    `json:"theme" gorm:"size:24"`
	Position  int       `json:"position" gorm:"index"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ProjectAssetCandidate struct {
	ID              string        `json:"id" gorm:"primaryKey;size:36"`
	ProjectID       string        `json:"projectId" gorm:"index;size:36;index:idx_project_asset_candidates_project_unit_status,priority:1;index:idx_project_asset_candidates_project_status_category,priority:1"`
	UnitID          string        `json:"unitId,omitempty" gorm:"index;size:36;index:idx_project_asset_candidates_project_unit_status,priority:2"`
	ShotID          string        `json:"shotId,omitempty" gorm:"index;size:36"`
	Name            string        `json:"name" gorm:"size:240"`
	NameKey         string        `json:"-" gorm:"index;size:240"`
	Category        AssetCategory `json:"category" gorm:"index;size:32;index:idx_project_asset_candidates_project_status_category,priority:3"`
	Status          string        `json:"status" gorm:"index;size:32;index:idx_project_asset_candidates_project_unit_status,priority:3;index:idx_project_asset_candidates_project_status_category,priority:2"`
	Source          string        `json:"source,omitempty" gorm:"index;size:48"`
	DetailsJSON     string        `json:"detailsJson" gorm:"type:text"`
	ResolvedAssetID string        `json:"resolvedAssetId,omitempty" gorm:"index;size:80"`
	CreatedAt       time.Time     `json:"createdAt"`
	UpdatedAt       time.Time     `json:"updatedAt"`
}

type AssetVersion struct {
	ID             string             `json:"id" gorm:"primaryKey;size:36"`
	AssetID        string             `json:"assetId" gorm:"index;size:80;uniqueIndex:idx_asset_versions_number,priority:1"`
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
	ID                string        `json:"id" gorm:"primaryKey;size:36"`
	UserID            string        `json:"userId" gorm:"index;size:36;uniqueIndex:idx_projects_user_name,priority:1"`
	Name              string        `json:"name" gorm:"size:240;uniqueIndex:idx_projects_user_name,priority:2"`
	Type              string        `json:"type" gorm:"size:32;index"`
	AspectRatio       string        `json:"aspectRatio" gorm:"size:16"`
	SourceType        string        `json:"sourceType" gorm:"size:32"`
	Description       string        `json:"description" gorm:"type:text"`
	CoverResourceID   string        `json:"coverResourceId,omitempty" gorm:"index;size:36"`
	StylePresetID     string        `json:"stylePresetId" gorm:"size:64"`
	StyleProfileJSON  string        `json:"styleProfileJson" gorm:"type:text"`
	DefaultImageModel string        `json:"defaultImageModel,omitempty" gorm:"size:500"`
	DefaultVideoModel string        `json:"defaultVideoModel,omitempty" gorm:"size:500"`
	Status            ProjectStatus `json:"status" gorm:"index;size:24"`
	Revision          int64         `json:"revision"`
	CreatedAt         time.Time     `json:"createdAt"`
	UpdatedAt         time.Time     `json:"updatedAt" gorm:"index"`
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
	ProjectID  string            `json:"projectId" gorm:"index;size:36;index:idx_project_units_project_position,priority:1"`
	ParentID   string            `json:"parentId,omitempty" gorm:"index;size:36"`
	Kind       ProjectUnitKind   `json:"kind" gorm:"index;size:24"`
	Title      string            `json:"title" gorm:"size:240"`
	SourceText string            `json:"sourceText" gorm:"type:text"`
	WordCount  int               `json:"wordCount"`
	Status     ProjectUnitStatus `json:"status" gorm:"index;size:24"`
	Position   int               `json:"position" gorm:"index:idx_project_units_project_position,priority:2"`
	CreatedAt  time.Time         `json:"createdAt"`
	UpdatedAt  time.Time         `json:"updatedAt"`
}

type CanvasUnitLink struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID string    `json:"projectId" gorm:"index;size:36;uniqueIndex:idx_canvas_unit_links_unique,priority:1;index:idx_canvas_unit_links_project_unit,priority:1"`
	CanvasID  string    `json:"canvasId" gorm:"index;size:80;uniqueIndex:idx_canvas_unit_links_unique,priority:2"`
	UnitID    string    `json:"unitId" gorm:"index;size:36;uniqueIndex:idx_canvas_unit_links_unique,priority:3;index:idx_canvas_unit_links_project_unit,priority:2"`
	Role      string    `json:"role" gorm:"size:32"`
	CreatedAt time.Time `json:"createdAt"`
}

type Shot struct {
	ID                string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID         string    `json:"projectId" gorm:"index;size:36;index:idx_shots_project_unit_position,priority:1"`
	UnitID            string    `json:"unitId" gorm:"index;size:36;index:idx_shots_project_unit_position,priority:2"`
	CurrentRevisionID string    `json:"currentRevisionId,omitempty" gorm:"index;size:36"`
	Title             string    `json:"title" gorm:"size:240"`
	Description       string    `json:"description" gorm:"type:text"`
	Position          int       `json:"position" gorm:"index:idx_shots_project_unit_position,priority:3"`
	DurationMs        int64     `json:"durationMs"`
	Status            string    `json:"status" gorm:"index;size:24"`

	// W1-01（D-026 并轨）：Canvas 节点绑定与生成侧最新指针。
	// CanvasNodeID 是后端 canonical 字段（D-025）——一个 Canvas 节点最多绑定一个 Shot，
	// 叙事内容（prompt/duration/role）仍以 CanvasNode 为唯一事实源，这里只存定位。
	// 注意：不要用 gorm uniqueIndex 标签——历史行 canvas_node_id 为空串会撞唯一约束。
	// 幂等索引在迁移里建成“部分唯一索引”（WHERE canvas_node_id <> ''），见 migrateSchemaV7。
	CanvasNodeID string `json:"canvasNodeId,omitempty" gorm:"index:idx_shots_canvas_node;size:80"`
	// SemanticType 语义类型（如 dialogue/action/transition），用于 Timeline 分组；可空。
	SemanticType string `json:"semanticType,omitempty" gorm:"index;size:32"`
	// 以下三个指针是查询加速用的冗余，权威关系仍在 ProductionTaskLink / ShotArtifact。
	LatestTaskID     string `json:"latestTaskId,omitempty" gorm:"size:36"`
	LatestJobID      string `json:"latestJobId,omitempty" gorm:"size:64"`
	LatestArtifactID string `json:"latestArtifactId,omitempty" gorm:"size:36"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ShotRevision 保存可复现的分镜脚本版本；Shot 只保留稳定身份、排序和当前版本指针。
type ShotRevision struct {
	ID              string    `json:"id" gorm:"primaryKey;size:36"`
	ShotID          string    `json:"shotId" gorm:"index;size:36;uniqueIndex:idx_shot_revisions_version,priority:1"`
	Version         int       `json:"version" gorm:"uniqueIndex:idx_shot_revisions_version,priority:2"`
	PlotDescription string    `json:"plotDescription" gorm:"type:text"`
	Action          string    `json:"action" gorm:"type:text"`
	Dialogue        string    `json:"dialogue" gorm:"type:text"`
	ShotSize        string    `json:"shotSize" gorm:"size:80"`
	CameraAngle     string    `json:"cameraAngle" gorm:"size:80"`
	CameraMovement  string    `json:"cameraMovement" gorm:"size:120"`
	DurationMs      int64     `json:"durationMs"`
	ImagePrompt     string    `json:"imagePrompt" gorm:"type:text"`
	VideoPrompt     string    `json:"videoPrompt" gorm:"type:text"`
	NegativePrompt  string    `json:"negativePrompt" gorm:"type:text"`
	ContinuityNotes string    `json:"continuityNotes" gorm:"type:text"`
	ActionBeatsJSON string    `json:"actionBeatsJson" gorm:"type:text"`
	CreatedBy       string    `json:"createdBy,omitempty" gorm:"index;size:36"`
	CreatedAt       time.Time `json:"createdAt"`
}

// ShotArtifact 状态常量（D-034）。
//
// 历史遗留：这些值此前散落在代码里当裸字符串用，且 `failed` 只出现在
// `status NOT IN ('failed','stale')` 排除列表里、无任何写入点（死值）。
// 从 W1-01 起**一律使用常量**，禁止再写裸字符串。
//
// 语义：Status 描述的不是文件处理 pipeline，而是「这个 Artifact 目前在生产域中是否可用」，
// 因此不引入 created / processing 这类中间态。
//
// ─────────────────────────────────────────────────────────────────────────
// ★ Status 与 Selected 是两个正交维度（W1-01 纠偏后定死，勿再混用）
// ─────────────────────────────────────────────────────────────────────────
//   Status   = 「这个产物能不能用？」——生命周期可用性
//   Selected = 「这个产物是不是当前被采用的那个版本？」——版本指针（pointer）
//
// 二者组合出的合法状态：
//   1) ready + selected        → 当前采用版本，可用（最常见）
//   2) ready + !selected       → 历史可用版本，被更新的版本顶替，但仍可回放/切回
//   3) pending_resource + sel. → 已生成成功、Resource 未登记；W3-01 之前这是常态
//   4) stale                   → 被新 Revision / 参数变更淘汰，**不再可用**，只作历史留档
//
// 关键区分（此前混淆导致 Bug）：
//   · 「曾经是 selected，现在不是了」≠ stale。那只是版本更替（组合 2），产物依然可用。
//   · stale 是不可逆淘汰：分镜/资产引用改了，旧产物对新输入不再成立，即便文件还在。
//   · 因此置 stale 时**必须同时清 selected**（见 repository.go 的 markArtifactStale），
//     避免出现「已淘汰但仍被当作当前版本」的自相矛盾状态。
//
// ⚠️ selected=true 只是「当前候选版本」，**不等于 Timeline 最终使用的产物**。
//   完整取值链必须走完四层：
//       Shot → Active Revision → Selected Artifact → 实际媒体
//   少了 Revision 这一层，就会出现「产物被选中、但分镜版本已经切换」的语义冲突
//   ——即 selected 指向的 Artifact 并不属于当前 Active Revision。
//   （W1-02 / W1-03 会在读取侧补齐这一层，此处先立规矩，避免后来者误解。）
//
const (
	// ShotArtifactStatusReady 表示 Resource 已登记，产物可正常使用。
	ShotArtifactStatusReady = "ready"
	// ShotArtifactStatusPendingResource 表示生成成功，但尚未注册 Resource
	// （D-029 拆段：真实下载归 W3-01，故 W3-01 之前这是常态，不是错误）。
	ShotArtifactStatusPendingResource = "pending_resource"
	// ShotArtifactStatusResourceFailed 表示已尝试注册 Resource 但失败。
	// 注意：视频已生成成功，只是资产登记失败——Task 仍应视为成功，可重试登记（W3-02 提供 UI）。
	ShotArtifactStatusResourceFailed = "resource_failed"
	// ShotArtifactStatusStale 表示被新 Revision / 新版本淘汰（历史保留，不删除）。
	ShotArtifactStatusStale = "stale"
)

// ShotArtifact 是镜头的版本化生产产物。修改分镜或资产引用时只标记 stale，不删除历史。
type ShotArtifact struct {
	ID           string    `json:"id" gorm:"primaryKey;size:36"`
	ProjectID    string    `json:"projectId" gorm:"index;size:36;index:idx_shot_artifacts_project_unit,priority:1"`
	UnitID       string    `json:"unitId" gorm:"index;size:36;index:idx_shot_artifacts_project_unit,priority:2"`
	ShotID       string    `json:"shotId" gorm:"index;size:36;uniqueIndex:idx_shot_artifacts_version,priority:1"`
	RevisionID   string    `json:"revisionId,omitempty" gorm:"index;size:36"`
	TaskID       string    `json:"taskId,omitempty" gorm:"index;size:36"`
	Type         string    `json:"type" gorm:"index;size:40;uniqueIndex:idx_shot_artifacts_version,priority:2"`
	Version      int       `json:"version" gorm:"uniqueIndex:idx_shot_artifacts_version,priority:3"`
	ResourceID   string    `json:"resourceId,omitempty" gorm:"index;size:36"`
	// Status：生命周期可用性，取值见上方 D-034 常量，禁止裸字符串。
	Status string `json:"status" gorm:"index;size:24"`
	// Selected：版本指针，标记「当前采用的版本」。与 Status 正交，不是状态。
	// 同一 (ShotID, Type) 下最多一行 selected=true；置 stale 时必须同时置 false。
	Selected     bool   `json:"selected" gorm:"index"`
	MetadataJSON string `json:"metadataJson" gorm:"type:text"`

	// W1-01（D-026 并轨）：生成侧溯源字段，原拟新建 output_assets 表，改为挂在既有产物表上。
	// RequestID 指向 comfy_bridge_requests（即 ComfyJob，D-020）；
	// AssetIndex 与 RequestID 组成幂等键，Bridge 重复回调不会重复落产物。
	// 注意：不要用 gorm uniqueIndex 标签——历史行 request_id 为空串会撞唯一约束。
	// 幂等索引在迁移里建成“部分唯一索引”（WHERE request_id <> ''），见 migrateSchemaV7。
	RequestID  string `json:"requestId,omitempty" gorm:"index:idx_shot_artifacts_request;size:64"`
	AssetIndex int    `json:"assetIndex"`
	Checksum  string `json:"checksum,omitempty" gorm:"size:128"`
	FileSize  int64  `json:"fileSize"`
	Provider  string `json:"provider,omitempty" gorm:"size:64"`
	// 媒体元信息：供 Timeline 投影与失败诊断直接读取，避免每次解析 MetadataJSON。
	DurationMs float64 `json:"durationMs"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`

	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
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

	// W1-01（D-026 并轨）：Bridge 执行侧元数据，原拟新建 bridge_workflows 表，
	// 改为挂在既有模板版本上——这些字段本质是“这个版本的模板怎么被执行”。
	// WorkflowHash 是 Comfy 工作流 JSON 的指纹，用于判断本地工作流是否已变更。
	WorkflowHash string `json:"workflowHash,omitempty" gorm:"index;size:128"`
	// CapabilitiesJSON 是能力声明（Capability Manifest，D-013）；
	// MappingJSON 是结构化字段映射（D-015）——Skill 管“什么时候用”，这里只管“机器怎么填参数”。
	CapabilitiesJSON string `json:"-" gorm:"type:text"`
	MappingJSON      string `json:"-" gorm:"type:text"`
	// H3 分段约束（D-021：Segment 是执行细节，不入 Shot 模型，只作为执行期上限）
	MaxSegmentDurationSec  float64 `json:"maxSegmentDurationSec"`
	MaxTimelineDurationSec float64 `json:"maxTimelineDurationSec"`
	MaxFramesPerSegment    int     `json:"maxFramesPerSegment"`
	// Enabled 控制该版本是否可被 Bridge 派发
	Enabled bool `json:"enabled" gorm:"index;default:true"`

	CreatedAt time.Time `json:"createdAt"`
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

// ProductionTaskLink 显式区分领域项目、画布和镜头上下文，避免继续复用 Task.ProjectID 表达多种身份。
type ProductionTaskLink struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	TaskID         string    `json:"taskId" gorm:"index;size:36;uniqueIndex:idx_production_task_context,priority:1"`
	ProjectID      string    `json:"projectId" gorm:"index;size:36"`
	CanvasID       string    `json:"canvasId,omitempty" gorm:"index;size:80"`
	UnitID         string    `json:"unitId,omitempty" gorm:"index;size:36"`
	ShotID         string    `json:"shotId,omitempty" gorm:"index;size:36;uniqueIndex:idx_production_task_context,priority:2"`
	WorkflowStepID string    `json:"workflowStepId,omitempty" gorm:"index;size:36"`
	ArtifactType   string    `json:"artifactType,omitempty" gorm:"index;size:40;uniqueIndex:idx_production_task_context,priority:3"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type CanvasProject struct {
	ID          string    `json:"id" gorm:"primaryKey;size:80"`
	UserID      string    `json:"userId" gorm:"index;size:36;index:idx_canvas_projects_user_updated,priority:1;index:idx_canvas_projects_user_project_updated,priority:1"`
	ProjectID   string    `json:"projectId,omitempty" gorm:"index;size:36;index:idx_canvas_projects_user_project_updated,priority:2"`
	Title       string    `json:"title" gorm:"size:240"`
	PayloadJSON string    `json:"payloadJson" gorm:"type:text"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt" gorm:"index:idx_canvas_projects_user_updated,priority:2;index:idx_canvas_projects_user_project_updated,priority:3"`
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
	ID              string             `json:"id" gorm:"primaryKey;size:36"`
	Title           string             `json:"title" gorm:"size:120"`
	Content         string             `json:"content" gorm:"type:text"`
	ImageResourceID string             `json:"imageResourceId,omitempty" gorm:"index;size:36"`
	ImageURL        string             `json:"imageUrl,omitempty" gorm:"-"`
	Level           AnnouncementLevel  `json:"level" gorm:"index;size:24"`
	Pinned          bool               `json:"pinned" gorm:"index"`
	Status          AnnouncementStatus `json:"status" gorm:"index;size:24;index:idx_announcements_status_published,priority:1"`
	CreatedBy       string             `json:"createdBy" gorm:"index;size:36"`
	PublishedAt     time.Time          `json:"publishedAt" gorm:"index:idx_announcements_status_published,priority:2"`
	ClosedAt        *time.Time         `json:"closedAt"`
	CreatedAt       time.Time          `json:"createdAt"`
	UpdatedAt       time.Time          `json:"updatedAt"`
}

type UserAnnouncementRead struct {
	ID             string    `json:"id" gorm:"primaryKey;size:36"`
	UserID         string    `json:"userId" gorm:"index;size:36;uniqueIndex:idx_user_announcement_read,priority:1"`
	AnnouncementID string    `json:"announcementId" gorm:"index;size:36;uniqueIndex:idx_user_announcement_read,priority:2"`
	ReadAt         time.Time `json:"readAt"`
}
