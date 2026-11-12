// Package repository 的官方素材库持久化层（迁移 v61，表 official_assets /
// official_asset_imports）。
//
// 分层约定（仓库 AGENTS.md §3）：本文件只做持久化，不做权限、不做状态机、
// 不做“用户能不能看”的判断。所有可见性与状态机都在 service 层
// （backend/internal/app/official_assets.go）。
//
// 软删除约定：OfficialAsset.DeletedAt 是普通的 *time.Time，不是
// gorm.DeletedAt，GORM 不会自动过滤。本文件所有查询都显式处理 deleted_at：
// 用户侧只查 deleted_at IS NULL 的行；管理侧同样排除已软删的行，
// 只是不过滤 status。
package repository

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// OfficialAssetPageFilter 是官方素材分页查询的过滤条件。
// Status 只在管理端使用（draft/published/unpublished/all）；
// 用户端查询固定只看 published，由 service 层传入 publishedOnly=true。
type OfficialAssetPageFilter struct {
	MediaType string
	Category  string
	Tag       string
	Query     string
	Status    string
}

// officialAssetFilteredQuery 给官方素材查询叠加过滤条件。
// 关键词命中 title / description / tags_json；标签用带引号的 LIKE，
// 避免 "cat" 命中 "category" 这类子串误伤；通配符先转义。
func officialAssetFilteredQuery(query *gorm.DB, filter OfficialAssetPageFilter, publishedOnly bool) *gorm.DB {
	if publishedOnly {
		query = query.Where("status = ? AND deleted_at IS NULL", model.OfficialAssetStatusPublished)
	} else {
		query = query.Where("deleted_at IS NULL")
		if value := strings.TrimSpace(filter.Status); value != "" && value != "all" {
			query = query.Where("status = ?", value)
		}
	}
	if value := strings.TrimSpace(filter.MediaType); value != "" {
		query = query.Where("media_type = ?", value)
	}
	if value := strings.TrimSpace(filter.Category); value != "" {
		query = query.Where("category = ?", value)
	}
	if value := strings.TrimSpace(filter.Tag); value != "" {
		pattern := `%"` + escapeLikeValue(value) + `"%`
		query = query.Where("tags_json LIKE ? ESCAPE '\\'", pattern)
	}
	if value := strings.ToLower(strings.TrimSpace(filter.Query)); value != "" {
		pattern := "%" + value + "%"
		query = query.Where("LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags_json) LIKE ?", pattern, pattern, pattern)
	}
	return query
}

// escapeLikeValue 转义 LIKE 模式里的通配符，配合 ESCAPE '\' 使用。
func escapeLikeValue(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}

// OfficialAssetsPage 返回一页官方素材与总数。排序固定为
// sort_order ASC, updated_at DESC, id DESC（管理端排序调整后立即生效）。
func (r *Repository) OfficialAssetsPage(page int, pageSize int, filter OfficialAssetPageFilter, publishedOnly bool) ([]model.OfficialAsset, int64, error) {
	var assets []model.OfficialAsset
	var total int64
	query := officialAssetFilteredQuery(r.db.Model(&model.OfficialAsset{}), filter, publishedOnly)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("sort_order ASC, updated_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&assets).Error
	return assets, total, err
}

// OfficialAssetFacets 返回官方素材的媒体类型与分类计数，
// 与分页查询用同一过滤口径（publishedOnly 决定是否只统计已发布）。
func (r *Repository) OfficialAssetFacets(publishedOnly bool) ([]UserAssetFacetRow, []UserAssetFacetRow, error) {
	base := func() *gorm.DB {
		return officialAssetFilteredQuery(r.db.Model(&model.OfficialAsset{}), OfficialAssetPageFilter{}, publishedOnly)
	}
	var mediaTypeRows []UserAssetFacetRow
	if err := base().Select("media_type AS key, COUNT(*) AS count").Group("media_type").Scan(&mediaTypeRows).Error; err != nil {
		return nil, nil, err
	}
	var categoryRows []UserAssetFacetRow
	if err := base().Select("category AS key, COUNT(*) AS count").Group("category").Scan(&categoryRows).Error; err != nil {
		return nil, nil, err
	}
	return mediaTypeRows, categoryRows, nil
}

// OfficialAssetByID 按 ID 取一行官方素材，不做可见性过滤
// （草稿/已下架是否可见由 service 层判断；找不到返回 gorm.ErrRecordNotFound）。
func (r *Repository) OfficialAssetByID(id string) (*model.OfficialAsset, error) {
	var asset model.OfficialAsset
	if err := r.db.First(&asset, "id = ?", strings.TrimSpace(id)).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

// OfficialAssetByResourceID 按底层 Resource 反查官方素材。
// 资源访问层用它识别“属于官方素材库、但不属于当前用户”的共享资源。
func (r *Repository) OfficialAssetByResourceID(resourceID string) (*model.OfficialAsset, error) {
	var asset model.OfficialAsset
	id := strings.TrimSpace(resourceID)
	if err := r.db.Where("resource_id = ? AND deleted_at IS NULL", id).First(&asset).Error; err == nil {
		return &asset, nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	var candidates []model.OfficialAsset
	if err := r.db.Where("deleted_at IS NULL AND character_snapshot_json <> ?", "").Find(&candidates).Error; err != nil {
		return nil, err
	}
	for _, candidate := range candidates {
		var snapshot struct {
			Images []struct {
				ResourceID string `json:"resourceId"`
			} `json:"images"`
			Representations []struct {
				ResourceID string `json:"resourceId"`
			} `json:"representations"`
			Voice *struct {
				Profile struct {
					SampleResourceID string `json:"sampleResourceId"`
				} `json:"profile"`
			} `json:"voice"`
		}
		if err := json.Unmarshal([]byte(candidate.CharacterSnapshotJSON), &snapshot); err != nil {
			return nil, err
		}
		for _, image := range snapshot.Images {
			if image.ResourceID == id {
				return &candidate, nil
			}
		}
		for _, image := range snapshot.Representations {
			if image.ResourceID == id {
				return &candidate, nil
			}
		}
		if snapshot.Voice != nil && snapshot.Voice.Profile.SampleResourceID == id {
			return &candidate, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

// OfficialAssetImportedByUser 判断用户是否已经导入过某份官方素材。
// 已导入副本在官方素材下架后仍须保持可读。
func (r *Repository) OfficialAssetImportedByUser(officialAssetID string, userID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.OfficialAssetImport{}).
		Where("official_asset_id = ? AND scope = ? AND owner_id = ?", strings.TrimSpace(officialAssetID), model.OfficialAssetImportScopeLibrary, strings.TrimSpace(userID)).
		Count(&count).Error
	return count > 0, err
}

// CreateOfficialAsset 插入一行官方素材。
func (r *Repository) CreateOfficialAsset(asset *model.OfficialAsset) error {
	return r.db.Create(asset).Error
}

// UpdateOfficialAssetFields 按字段更新一行官方素材（不含 status 流转专用的
// published_at 语义——调用方把要改的字段连同 updated_at 一起放进 fields）。
// 返回实际影响行数；0 表示该行不存在或已被软删，调用方应按不存在处理。
func (r *Repository) UpdateOfficialAssetFields(id string, fields map[string]any) (int64, error) {
	result := r.db.Model(&model.OfficialAsset{}).Where("id = ? AND deleted_at IS NULL", strings.TrimSpace(id)).Updates(fields)
	return result.RowsAffected, result.Error
}

// SoftDeleteOfficialAsset 软删除一行官方素材（置 deleted_at）。
// 只删尚未软删的行；已发布/已下架的删除拦截在 service 层，不在这里判断。
func (r *Repository) SoftDeleteOfficialAsset(id string, now time.Time) error {
	return r.db.Model(&model.OfficialAsset{}).Where("id = ? AND deleted_at IS NULL", strings.TrimSpace(id)).Update("deleted_at", now).Error
}

// OfficialAssetImportCount 返回引用某官方素材的导入记录数，
// 删除草稿前用它判定（>0 拒绝删除）。
func (r *Repository) OfficialAssetImportCount(officialAssetID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.OfficialAssetImport{}).Where("official_asset_id = ?", strings.TrimSpace(officialAssetID)).Count(&count).Error
	return count, err
}

// ImportRecord 按（作用域，归属，官方素材）取导入记录；
// 不存在时返回 gorm.ErrRecordNotFound，调用方不要把它当成 500。
func (r *Repository) ImportRecord(scope string, ownerID string, officialAssetID string) (*model.OfficialAssetImport, error) {
	var record model.OfficialAssetImport
	if err := r.db.First(&record, "scope = ? AND owner_id = ? AND official_asset_id = ?", strings.TrimSpace(scope), strings.TrimSpace(ownerID), strings.TrimSpace(officialAssetID)).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

// ImportedAssetIDs 批量查一批官方素材在某作用域/归属下的导入情况，
// 返回 officialAssetID → assetID 的映射（未导入的不在映射里）。
func (r *Repository) ImportedAssetIDs(scope string, ownerID string, officialAssetIDs []string) (map[string]string, error) {
	result := make(map[string]string, len(officialAssetIDs))
	if len(officialAssetIDs) == 0 {
		return result, nil
	}
	var records []model.OfficialAssetImport
	if err := r.db.Where("scope = ? AND owner_id = ? AND official_asset_id IN ?", strings.TrimSpace(scope), strings.TrimSpace(ownerID), officialAssetIDs).Find(&records).Error; err != nil {
		return nil, err
	}
	for _, record := range records {
		result[record.OfficialAssetID] = record.AssetID
	}
	return result, nil
}

// CreateImportedLibraryAsset 在一个事务内创建导入到个人素材库的全部记录：
// Asset + 首版本 + 主表现 + 导入记录。任一步失败全部回滚，
// 不留“有资产无导入记录”或“有导入记录无资产”的半成品。
// 并发重复导入时，导入记录的唯一索引会让后到的事务失败，
// service 层收到错误后重查导入记录，返回先到者已创建的资产（见 app 层）。
func (r *Repository) CreateImportedLibraryAsset(asset *model.Asset, version *model.AssetVersion, representation *model.AssetRepresentation, record *model.OfficialAssetImport) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(asset).Error; err != nil {
			return err
		}
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if err := tx.Create(representation).Error; err != nil {
			return err
		}
		return tx.Create(record).Error
	})
}

// ImportOfficialAssetToProject 在一个事务内完成导入到项目的全部写入：
// Asset（已存在时幂等跳过）+ 项目链接（已存在时幂等跳过）+ 首版本
// （仅链接新建时创建）+ 主表现（仅链接新建时创建，与版本同事务，
// 仿照 project_asset_image.go:129 的项目图片绑定）+ 导入记录 + 项目修订号 +1。
//
// 刻意不直接复用 LinkProjectAsset：后者自己开事务，嵌套调用依赖
// GORM 保存点语义，且它不写导入记录——分开提交会在“链接已建、
// 导入记录未写”的窗口里留下重复导入可建第二条资产的缺口。
// 本方法按 LinkProjectAsset 的语句逐条镜像（见 repository_projects.go），
// 两处逻辑若日后有改动应同步改。
// 返回 createdLink：链接是否为本次新建；false 表示该（项目，资产）
// 链接已存在，调用方应重查导入记录后返回已导入资产。
func (r *Repository) ImportOfficialAssetToProject(asset *model.Asset, version *model.AssetVersion, representation *model.AssetRepresentation, link *model.ProjectAssetLink, record *model.OfficialAssetImport) (bool, error) {
	createdLink := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		assetCreated := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoNothing: true}).Create(asset)
		if assetCreated.Error != nil {
			return assetCreated.Error
		}
		created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "project_id"}, {Name: "asset_id"}}, DoNothing: true}).Create(link)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 0 {
			return nil
		}
		createdLink = true
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if err := tx.Create(representation).Error; err != nil {
			return err
		}
		result := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ?", asset.ID, asset.UserID).Updates(map[string]any{
			"category": asset.Category, "status": asset.Status, "primary_version_id": asset.PrimaryVersionID, "updated_at": asset.UpdatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Model(&model.Project{}).Where("id = ?", link.ProjectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error; err != nil {
			return err
		}
		return tx.Create(record).Error
	})
	if err != nil {
		return false, err
	}
	// 链接已存在时本事务只读不写：导入记录也已存在（或正由并发事务写入），
	// 调用方重查导入记录即可，不要在这里再补写。
	if !createdLink {
		return false, nil
	}
	return true, nil
}

// IsOfficialAssetImportNotFound 报告错误是否为“导入记录不存在”。
// service 层用它区分“未导入过”（走新建流程）与真正的读库失败。
func IsOfficialAssetImportNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}
