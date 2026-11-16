package model

import (
	"encoding/json"
	"strings"
	"time"
)

// OfficialAsset 是官方素材库的独立数据模型（迁移 v61，表 official_assets）。
//
// 与已舍弃的 10-20 Scope 方案不同：官方素材不复用用户 assets 表，
// 不加 assets.scope，也不做 promote。官方素材只存元数据 + Resource 引用，
// 文件本身继续走现有 Resource 与对象存储体系。
//
// 软删除约定：DeletedAt 是普通的 *time.Time，不是 gorm.DeletedAt。
// GORM 不会自动过滤它，repository / service 必须在查询里显式写
// `deleted_at IS NULL`（用户侧）或按状态显式处理（管理侧）。
// 这样做是故意的：管理端要能看到草稿与已下架素材，不能让框架悄悄藏起来。

// OfficialAssetStatus 是官方素材的发布状态。
type OfficialAssetStatus string

const (
	// OfficialAssetStatusDraft 草稿：仅管理员可见，不可被用户浏览、导入。
	OfficialAssetStatusDraft OfficialAssetStatus = "draft"
	// OfficialAssetStatusPublished 已发布：普通用户可浏览、导入。
	OfficialAssetStatusPublished OfficialAssetStatus = "published"
	// OfficialAssetStatusUnpublished 已下架：不再接受新导入，已导入的资产不受影响。
	OfficialAssetStatusUnpublished OfficialAssetStatus = "unpublished"
)

// IsValid 报告该状态是否为三个合法值之一。
func (s OfficialAssetStatus) IsValid() bool {
	switch s {
	case OfficialAssetStatusDraft, OfficialAssetStatusPublished, OfficialAssetStatusUnpublished:
		return true
	default:
		return false
	}
}

// 官方素材的媒体类型。v1 只允许图片与视频，校验由 service 层执行，
// 非法值直接 400 拒绝，不静默改成默认值。
const (
	OfficialAssetMediaTypeImage  = "image"
	OfficialAssetMediaTypeVideo  = "video"
	OfficialAssetMediaTypeAudio  = "audio"
	OfficialAssetMediaTypeEntity = "entity"
)

type OfficialAssetRecommendationStatus string

const (
	OfficialAssetRecommendationPending          OfficialAssetRecommendationStatus = "pending"
	OfficialAssetRecommendationApproved         OfficialAssetRecommendationStatus = "approved"
	OfficialAssetRecommendationRejected         OfficialAssetRecommendationStatus = "rejected"
	OfficialAssetRecommendationChangesRequested OfficialAssetRecommendationStatus = "changes_requested"
)

type OfficialAssetRecommendation struct {
	ID              string                            `json:"id" gorm:"primaryKey;size:36"`
	AssetID         string                            `json:"assetId" gorm:"index;size:80"`
	SubmitterID     string                            `json:"submitterId" gorm:"index;size:36"`
	Title           string                            `json:"title" gorm:"size:240"`
	Note            string                            `json:"note" gorm:"type:text"`
	SnapshotJSON    string                            `json:"-" gorm:"type:text"`
	ConsentVersion  string                            `json:"consentVersion,omitempty" gorm:"size:40"`
	ConsentAt       *time.Time                        `json:"consentAt,omitempty"`
	Status          OfficialAssetRecommendationStatus `json:"status" gorm:"index;size:32"`
	ReviewerID      string                            `json:"reviewerId,omitempty" gorm:"index;size:36"`
	ReviewerNote    string                            `json:"reviewerNote,omitempty" gorm:"type:text"`
	OfficialAssetID string                            `json:"officialAssetId,omitempty" gorm:"index;size:36"`
	ReviewedAt      *time.Time                        `json:"reviewedAt,omitempty"`
	CreatedAt       time.Time                         `json:"createdAt"`
	UpdatedAt       time.Time                         `json:"updatedAt"`
}

func (OfficialAssetRecommendation) TableName() string { return "official_asset_recommendations" }

// 标签的入库上限（校验由 service 层执行，超限 400，不静默截断）。
const (
	// OfficialAssetTagMaxCount 单条素材最多标签数。
	OfficialAssetTagMaxCount = 20
	// OfficialAssetTagMaxRunes 单个标签最多字符数（按 rune 计）。
	OfficialAssetTagMaxRunes = 40
)

type OfficialAsset struct {
	ID                    string `json:"id" gorm:"primaryKey;size:36"`
	CharacterSnapshotJSON string `json:"-" gorm:"type:text"`
	// ResourceID 只存 Resource ID，不存临时签名地址、PublicURL、ObjectKey 副本。
	// 封面与播放地址一律由前端按现有 resource: 存储键机制换取。
	ResourceID  string        `json:"resourceId" gorm:"index;size:36;index:idx_official_assets_resource,priority:1"`
	Title       string        `json:"title" gorm:"size:240"`
	Description string        `json:"description" gorm:"type:text"`
	MediaType   string        `json:"mediaType" gorm:"index;size:24"`
	Category    AssetCategory `json:"category" gorm:"index;size:32"`
	// TagsJSON 存 JSON 数组（如 `["a","b"]`），对外以 tags: string[] 呈现。
	// 编解码用本文件的 EncodeOfficialAssetTags / DecodeOfficialAssetTags，
	// 不要在 repository 里手写 LIKE 拼接。
	TagsJSON    string              `json:"-" gorm:"type:text"`
	SourceName  string              `json:"sourceName" gorm:"size:240"`
	SourceURL   string              `json:"sourceUrl" gorm:"size:500"`
	LicenseNote string              `json:"licenseNote" gorm:"type:text"`
	UsageNote   string              `json:"usageNote" gorm:"type:text"`
	Status      OfficialAssetStatus `json:"status" gorm:"index;size:24;index:idx_official_assets_status_sort,priority:1"`
	SortOrder   int                 `json:"sortOrder" gorm:"index:idx_official_assets_status_sort,priority:2"`
	CreatedBy   string              `json:"createdBy" gorm:"index;size:36"`
	CreatedAt   time.Time           `json:"createdAt"`
	UpdatedAt   time.Time           `json:"updatedAt" gorm:"index:idx_official_assets_status_sort,priority:3"`
	// PublishedAt 只在首次发布时写入，之后再发布 / 下架不再改。
	PublishedAt *time.Time `json:"publishedAt,omitempty"`
	// DeletedAt 软删除标记。v1 只有“删除未被引用的草稿”走这条路；
	// 已发布 / 已下架素材不允许删除，也不允许用 DeletedAt 绕过。
	DeletedAt *time.Time `json:"deletedAt,omitempty" gorm:"index"`
}

func (OfficialAsset) TableName() string { return "official_assets" }

// NormalizeOfficialAssetTags 去空格、去空、按首次出现顺序去重。
// 不做长度截断：超限由 service 层按 OfficialAssetTagMaxCount /
// OfficialAssetTagMaxRunes 拒绝。
func NormalizeOfficialAssetTags(tags []string) []string {
	seen := make(map[string]struct{}, len(tags))
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if _, exists := seen[tag]; exists {
			continue
		}
		seen[tag] = struct{}{}
		out = append(out, tag)
	}
	return out
}

// EncodeOfficialAssetTags 把标签编码为入库的 JSON 数组字符串。
// 空标签存 "[]"，不存 ""，保证 Decode 与 LIKE 查询的行为一致。
func EncodeOfficialAssetTags(tags []string) (string, error) {
	normalized := NormalizeOfficialAssetTags(tags)
	if len(normalized) == 0 {
		return "[]", nil
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

// DecodeOfficialAssetTags 解码 TagsJSON。空字符串按历史空值容忍为 nil，
// "[]" 解码为空切片。非法 JSON 返回错误，调用方不得静默当成无标签。
func DecodeOfficialAssetTags(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var tags []string
	if err := json.Unmarshal([]byte(raw), &tags); err != nil {
		return nil, err
	}
	return tags, nil
}

// OfficialAssetImportScope 是导入记录的作用域。
const (
	// OfficialAssetImportScopeLibrary 导入到个人素材库，OwnerID 是 userId。
	OfficialAssetImportScopeLibrary = "library"
	// OfficialAssetImportScopeProject 导入到当前项目资产，OwnerID 是 projectId。
	OfficialAssetImportScopeProject = "project"
)

// OfficialAssetImport 是官方素材的导入去重记录（表 official_asset_imports）。
//
// 唯一索引 (scope, owner_id, official_asset_id)：同一用户（或同一项目）
// 重复导入同一官方素材时，数据库层面直接冲突，service 层把冲突翻译成
// “已经存在”的明确返回，不新建第二条资产。
//
// 注意：AssetID（导入后创建的 assets.id）不在唯一索引里。
// 草案 §2.2 的代码块曾把 AssetID 写成唯一索引的第 3 列，那是错的——
// 第二次导入会产生新的 AssetID，唯一索引永远冲突不上，去重就失效了。
// 本文件已按 (scope, owner_id, official_asset_id) 修正，
// AssetID 只另建普通索引，供“由资产反查导入记录”使用。
type OfficialAssetImport struct {
	ID string `json:"id" gorm:"primaryKey;size:36"`
	// OfficialAssetID 是唯一索引的第 3 列（与 Scope、OwnerID 共同组成去重键）。
	OfficialAssetID string `json:"officialAssetId" gorm:"index;size:36;uniqueIndex:idx_official_asset_imports_unique,priority:3"`
	Scope           string `json:"scope" gorm:"size:16;uniqueIndex:idx_official_asset_imports_unique,priority:1"`
	OwnerID         string `json:"ownerId" gorm:"size:36;uniqueIndex:idx_official_asset_imports_unique,priority:2"`
	// AssetID 指向导入后创建的 assets.id。官方素材下架或删除后，
	// 这行记录保留，已导入的资产照常可用。
	AssetID   string    `json:"assetId" gorm:"index;size:80"`
	CreatedAt time.Time `json:"createdAt"`
}

func (OfficialAssetImport) TableName() string { return "official_asset_imports" }
