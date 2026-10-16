package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

// ErrProjectAssetVersionChanged prevents a late image from replacing newer work.
var ErrProjectAssetVersionChanged = errors.New("project asset version changed")

type ProjectAssetImageReference struct {
	AssetID    string
	ResourceID string
}

// ProjectAssetImageReferences returns only server-owned historical image bindings.
func (r *Repository) ProjectAssetImageReferences(userID string, assetIDs []string) ([]ProjectAssetImageReference, error) {
	references := []ProjectAssetImageReference{}
	if len(assetIDs) == 0 {
		return references, nil
	}
	err := r.db.Table("asset_representations").
		Select("asset_versions.asset_id, asset_representations.resource_id").
		Joins("JOIN asset_versions ON asset_versions.id = asset_representations.asset_version_id").
		Joins("JOIN assets ON assets.id = asset_versions.asset_id").
		Where("assets.user_id = ? AND assets.id IN ? AND assets.category IN ? AND asset_representations.media_type = ?", userID, assetIDs, []model.AssetCategory{model.AssetCategoryEnvironment, model.AssetCategoryProp}, "image").
		Scan(&references).Error
	return references, err
}

// CommitProjectAssetImage atomically promotes one image version, retaining historical references.
func (r *Repository) CommitProjectAssetImage(projectID string, expectedVersionID string, asset *model.Asset, version *model.AssetVersion, representation *model.AssetRepresentation) (bool, error) {
	applied := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var existing int64
		if err := tx.Model(&model.AssetRepresentation{}).Where("task_id = ? AND role = ?", representation.TaskID, "primary").Count(&existing).Error; err != nil {
			return err
		}
		if existing > 0 {
			return nil
		}
		// 与物理清理竞争时持有资源行锁，提交引用前不得删除该资源。
		var resource model.Resource
		if err := tx.Clauses(clause.Locking{Strength: "SHARE"}).
			Where("id = ? AND user_id = ? AND kind = ? AND status = ?", representation.ResourceID, asset.UserID, "image", model.ResourceStatusReady).
			First(&resource).Error; err != nil {
			return err
		}
		result := tx.Model(&model.Asset{}).
			Where("id = ? AND user_id = ? AND primary_version_id = ? AND category = ?", asset.ID, asset.UserID, expectedVersionID, asset.Category).
			Where("id IN (?)", tx.Model(&model.ProjectAssetLink{}).Select("asset_id").Where("project_id = ?", projectID)).
			Updates(map[string]any{"kind": asset.Kind, "payload_json": asset.PayloadJSON, "primary_version_id": version.ID, "status": asset.Status, "updated_at": asset.UpdatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrProjectAssetVersionChanged
		}
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if err := tx.Create(representation).Error; err != nil {
			return err
		}
		// 资产可能被多个项目引用，所有关联项目都需要刷新。
		if err := tx.Model(&model.Project{}).
			Where("id IN (?)", tx.Model(&model.ProjectAssetLink{}).Select("project_id").Where("asset_id = ?", asset.ID)).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error; err != nil {
			return err
		}
		applied = true
		return nil
	})
	return applied, err
}
