// 短剧项目、分集单元、项目素材库与画布-单元关联。

package repository

import (
	"fmt"
	"sort"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) Projects(userID string) ([]model.Project, error) {
	var projects []model.Project
	err := r.db.Where("user_id = ?", userID).Order("updated_at desc").Find(&projects).Error
	return projects, err
}

func (r *Repository) ProjectsPage(userID string, page int, pageSize int) ([]model.Project, int64, error) {
	var projects []model.Project
	var total int64
	query := r.db.Model(&model.Project{}).Where("user_id = ?", userID)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("updated_at desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&projects).Error; err != nil {
		return nil, 0, err
	}
	return projects, total, nil
}

func (r *Repository) ProjectForUser(userID string, id string) (*model.Project, error) {
	var project model.Project
	if err := r.db.First(&project, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

func (r *Repository) CreateProject(project *model.Project) error {
	return r.db.Create(project).Error
}

func (r *Repository) UpdateProject(project *model.Project) error {
	return r.db.Model(&model.Project{}).Where("id = ? AND user_id = ?", project.ID, project.UserID).Updates(map[string]any{
		"name": project.Name, "type": project.Type, "aspect_ratio": project.AspectRatio, "source_type": project.SourceType,
		"description": project.Description, "cover_resource_id": project.CoverResourceID,
		"style_preset_id": project.StylePresetID, "style_profile_json": project.StyleProfileJSON,
		"default_image_model": project.DefaultImageModel, "default_video_model": project.DefaultVideoModel,
		"status": project.Status, "revision": project.Revision, "updated_at": project.UpdatedAt,
	}).Error
}

func (r *Repository) DeleteProject(userID string, id string, canvasUpdates []model.CanvasProject) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var canvasIDs []string
		if err := tx.Model(&model.CanvasProject{}).
			Where("user_id = ? AND project_id = ?", userID, id).
			Pluck("id", &canvasIDs).Error; err != nil {
			return err
		}
		projectScopeIDs := append([]string{id}, canvasIDs...)
		var activeTaskCount int64
		if err := tx.Model(&model.Task{}).
			Where("user_id = ? AND project_id IN ? AND status IN ?", userID, projectScopeIDs, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).
			Count(&activeTaskCount).Error; err != nil {
			return err
		}
		if activeTaskCount > 0 {
			return ErrProjectHasActiveTasks
		}
		if err := tx.Where("user_id = ? AND project_id = ?", userID, id).Delete(&model.CanvasShare{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.CanvasUnitLink{}).Error; err != nil {
			return err
		}
		for _, canvas := range canvasUpdates {
			result := tx.Model(&model.CanvasProject{}).
				Where("id = ? AND user_id = ? AND project_id = ? AND revision = ?", canvas.ID, userID, id, canvas.Revision).
				Updates(map[string]any{"project_id": "", "payload_json": canvas.PayloadJSON, "updated_at": canvas.UpdatedAt, "revision": canvas.Revision + 1})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		var remainingCanvasCount int64
		if err := tx.Model(&model.CanvasProject{}).Where("user_id = ? AND project_id = ?", userID, id).Count(&remainingCanvasCount).Error; err != nil {
			return err
		}
		if remainingCanvasCount != 0 {
			return fmt.Errorf("项目删除时仍有 %d 个画布关联未处理", remainingCanvasCount)
		}
		shotIDs := tx.Model(&model.Shot{}).Select("id").Where("project_id = ?", id)
		if err := tx.Where("project_id = ?", id).Delete(&model.ProductionTaskLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ShotArtifact{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotRevision{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotAssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.Shot{}).Error; err != nil {
			return err
		}
		instanceIDs := tx.Model(&model.WorkflowInstance{}).Select("id").Where("project_id = ?", id)
		stepIDs := tx.Model(&model.WorkflowStepInstance{}).Select("id").Where("workflow_instance_id IN (?)", instanceIDs)
		if err := tx.Where("workflow_step_id IN (?)", stepIDs).Delete(&model.WorkflowStepTask{}).Error; err != nil {
			return err
		}
		if err := tx.Where("workflow_instance_id IN (?)", instanceIDs).Delete(&model.WorkflowStepInstance{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.WorkflowInstance{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectAssetLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectAssetFolder{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectAssetCandidate{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ?", id).Delete(&model.ProjectUnit{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.Task{}).Where("user_id = ? AND project_id = ?", userID, id).Update("project_id", "").Error; err != nil {
			return err
		}
		return tx.Delete(&model.Project{}, "id = ? AND user_id = ?", id, userID).Error
	})
}

func (r *Repository) BumpProjectRevision(projectID string) error {
	return r.db.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
}

func (r *Repository) ProjectUnits(projectID string) ([]model.ProjectUnit, error) {
	var units []model.ProjectUnit
	err := r.db.Where("project_id = ?", projectID).Order("position asc, created_at asc").Find(&units).Error
	return units, err
}

func (r *Repository) ProjectUnitSummaries(projectID string) ([]model.ProjectUnit, error) {
	var units []model.ProjectUnit
	err := r.db.Select("id", "project_id", "kind", "title", "word_count", "status", "position", "created_at", "updated_at").Where("project_id = ?", projectID).Order("position asc, created_at asc").Find(&units).Error
	return units, err
}

func (r *Repository) ProjectAssetCount(projectID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.ProjectAssetLink{}).Where("project_id = ?", projectID).Count(&count).Error
	return count, err
}

func (r *Repository) CreateProjectUnit(unit *model.ProjectUnit) error {
	return r.db.Create(unit).Error
}

func (r *Repository) ImportProjectUnits(projectID string, units []model.ProjectUnit) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// 分批写入仍处于同一事务，避免两千章导入超过 SQLite/PostgreSQL 单语句参数上限。
		if err := tx.CreateInBatches(&units, 100).Error; err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

func (r *Repository) ReorderProjectUnits(projectID string, unitIDs []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		for position, unitID := range unitIDs {
			result := tx.Model(&model.ProjectUnit{}).Where("id = ? AND project_id = ?", unitID, projectID).Updates(map[string]any{"position": position, "updated_at": now})
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": now}).Error
	})
}

func (r *Repository) ProjectUnit(projectID string, id string) (*model.ProjectUnit, error) {
	var unit model.ProjectUnit
	if err := r.db.First(&unit, "id = ? AND project_id = ?", id, projectID).Error; err != nil {
		return nil, err
	}
	return &unit, nil
}

func (r *Repository) UpdateProjectUnit(unit *model.ProjectUnit, invalidateWorkflow bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.ProjectUnit{}).Where("id = ? AND project_id = ?", unit.ID, unit.ProjectID).Updates(map[string]any{
			"parent_id": unit.ParentID, "title": unit.Title, "source_text": unit.SourceText, "word_count": unit.WordCount, "status": unit.Status, "position": unit.Position, "updated_at": unit.UpdatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if invalidateWorkflow {
			if err := tx.Model(&model.ShotArtifact{}).Where("project_id = ? AND unit_id = ? AND status NOT IN ?", unit.ProjectID, unit.ID, []string{"failed", "stale"}).Updates(map[string]any{"status": "stale", "selected": false, "updated_at": unit.UpdatedAt}).Error; err != nil {
				return err
			}
			if err := invalidateUnitWorkflowTx(tx, unit.ProjectID, unit.ID, "story", unit.UpdatedAt); err != nil {
				return err
			}
		}
		return tx.Model(&model.Project{}).Where("id = ?", unit.ProjectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": unit.UpdatedAt}).Error
	})
}

func (r *Repository) DeleteProjectUnit(projectID string, id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.CanvasUnitLink{}).Error; err != nil {
			return err
		}
		shotIDs := tx.Model(&model.Shot{}).Select("id").Where("project_id = ? AND unit_id = ?", projectID, id)
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.ProductionTaskLink{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.ShotArtifact{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotRevision{}).Error; err != nil {
			return err
		}
		if err := tx.Where("shot_id IN (?)", shotIDs).Delete(&model.ShotAssetReference{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.Shot{}).Error; err != nil {
			return err
		}
		instanceIDs := tx.Model(&model.WorkflowInstance{}).Select("id").Where("project_id = ? AND unit_id = ?", projectID, id)
		stepIDs := tx.Model(&model.WorkflowStepInstance{}).Select("id").Where("workflow_instance_id IN (?)", instanceIDs)
		if err := tx.Where("workflow_step_id IN (?)", stepIDs).Delete(&model.WorkflowStepTask{}).Error; err != nil {
			return err
		}
		if err := tx.Where("workflow_instance_id IN (?)", instanceIDs).Delete(&model.WorkflowStepInstance{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.WorkflowInstance{}).Error; err != nil {
			return err
		}
		if err := tx.Where("project_id = ? AND unit_id = ?", projectID, id).Delete(&model.ProjectAssetCandidate{}).Error; err != nil {
			return err
		}
		result := tx.Delete(&model.ProjectUnit{}, "id = ? AND project_id = ?", id, projectID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

func (r *Repository) CanvasUnitLink(projectID string, canvasID string, unitID string) (*model.CanvasUnitLink, error) {
	var link model.CanvasUnitLink
	if err := r.db.First(&link, "project_id = ? AND canvas_id = ? AND unit_id = ?", projectID, canvasID, unitID).Error; err != nil {
		return nil, err
	}
	return &link, nil
}

func (r *Repository) UpsertCanvasUnitLink(link *model.CanvasUnitLink) error {
	result := r.db.Model(&model.CanvasUnitLink{}).Where("project_id = ? AND canvas_id = ? AND unit_id = ?", link.ProjectID, link.CanvasID, link.UnitID).Updates(map[string]any{"role": link.Role})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return r.db.Create(link).Error
}

func (r *Repository) ProjectCanvasSummaries(userID string, projectID string) ([]model.CanvasProject, error) {
	var canvases []model.CanvasProject
	err := r.db.Select("id", "user_id", "project_id", "title", "revision", "created_at", "updated_at").Where("user_id = ? AND project_id = ?", userID, projectID).Order("updated_at desc").Find(&canvases).Error
	return canvases, err
}

func (r *Repository) ProjectCanvasDocuments(userID string, projectID string) ([]model.CanvasProject, error) {
	var canvases []model.CanvasProject
	err := r.db.Select("id", "title", "payload_json", "revision").Where("user_id = ? AND project_id = ?", userID, projectID).Find(&canvases).Error
	return canvases, err
}

func (r *Repository) ProjectCanvasUnitLinks(projectID string) ([]model.CanvasUnitLink, error) {
	var links []model.CanvasUnitLink
	err := r.db.Where("project_id = ?", projectID).Order("created_at asc").Find(&links).Error
	return links, err
}

func (r *Repository) DeleteCanvasUnitLink(projectID string, canvasID string, unitID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Delete(&model.CanvasUnitLink{}, "project_id = ? AND canvas_id = ? AND unit_id = ?", projectID, canvasID, unitID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

func (r *Repository) AssignCanvasToProject(userID string, canvasID string, projectID string) error {
	return r.db.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ?", canvasID, userID).Updates(map[string]any{"project_id": projectID, "revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
}

func (r *Repository) UnassignCanvasFromProject(userID string, projectID string, canvasID string, payloadJSON string, updatedAt time.Time, revision int64) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("project_id = ? AND canvas_id = ?", projectID, canvasID).Delete(&model.CanvasUnitLink{}).Error; err != nil {
			return err
		}
		result := tx.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ? AND project_id = ? AND revision = ?", canvasID, userID, projectID, revision).Updates(map[string]any{
			"project_id": "", "payload_json": payloadJSON, "updated_at": updatedAt, "revision": revision + 1,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": updatedAt}).Error
	})
}

func (r *Repository) ProjectAssets(userID string, projectID string) ([]model.Asset, error) {
	var assets []model.Asset
	err := r.db.Table("assets").Select("assets.*").Joins("JOIN project_asset_links ON project_asset_links.asset_id = assets.id").Where("assets.user_id = ? AND project_asset_links.project_id = ?", userID, projectID).Order("assets.updated_at desc").Scan(&assets).Error
	return assets, err
}

func (r *Repository) ProjectAssetLinks(projectID string) ([]model.ProjectAssetLink, error) {
	var links []model.ProjectAssetLink
	err := r.db.Where("project_id = ?", projectID).Order("folder_id asc, position asc, created_at asc").Find(&links).Error
	return links, err
}

func (r *Repository) ProjectAssetLink(projectID string, assetID string) (*model.ProjectAssetLink, error) {
	var link model.ProjectAssetLink
	if err := r.db.First(&link, "project_id = ? AND asset_id = ?", projectID, assetID).Error; err != nil {
		return nil, err
	}
	return &link, nil
}

func (r *Repository) NextProjectAssetPosition(projectID string, folderID string) (int, error) {
	var result struct{ Maximum int }
	err := r.db.Model(&model.ProjectAssetLink{}).
		Select("COALESCE(MAX(position), -1) AS maximum").
		Where("project_id = ? AND folder_id = ?", projectID, folderID).
		Scan(&result).Error
	return result.Maximum + 1, err
}

func (r *Repository) MoveProjectAsset(projectID string, assetID string, folderID string, position int) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.ProjectAssetLink{}).
			Where("project_id = ? AND asset_id = ?", projectID, assetID).
			Updates(map[string]any{"folder_id": folderID, "position": position})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

func (r *Repository) ProjectAssetFolders(projectID string) ([]model.ProjectAssetFolder, error) {
	var folders []model.ProjectAssetFolder
	err := r.db.Where("project_id = ?", projectID).Order("parent_id asc, position asc, created_at asc").Find(&folders).Error
	return folders, err
}

func (r *Repository) ProjectAssetFolder(projectID string, folderID string) (*model.ProjectAssetFolder, error) {
	var folder model.ProjectAssetFolder
	if err := r.db.First(&folder, "id = ? AND project_id = ?", folderID, projectID).Error; err != nil {
		return nil, err
	}
	return &folder, nil
}

func (r *Repository) CreateProjectAssetFolder(folder *model.ProjectAssetFolder) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(folder).Error; err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", folder.ProjectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": folder.UpdatedAt}).Error
	})
}

func (r *Repository) UpdateProjectAssetFolder(folder *model.ProjectAssetFolder) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.ProjectAssetFolder{}).
			Where("id = ? AND project_id = ?", folder.ID, folder.ProjectID).
			Updates(map[string]any{"parent_id": folder.ParentID, "name": folder.Name, "name_key": folder.NameKey, "style": folder.Style, "theme": folder.Theme, "position": folder.Position, "updated_at": folder.UpdatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", folder.ProjectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": folder.UpdatedAt}).Error
	})
}

func (r *Repository) DeleteProjectAssetFolder(projectID string, folderID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var childCount int64
		if err := tx.Model(&model.ProjectAssetFolder{}).Where("project_id = ? AND parent_id = ?", projectID, folderID).Count(&childCount).Error; err != nil {
			return err
		}
		var assetCount int64
		if err := tx.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND folder_id = ?", projectID, folderID).Count(&assetCount).Error; err != nil {
			return err
		}
		if childCount > 0 || assetCount > 0 {
			return ErrProjectAssetFolderNotEmpty
		}
		result := tx.Delete(&model.ProjectAssetFolder{}, "id = ? AND project_id = ?", folderID, projectID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
}

// LinkProjectAsset 将首版本、素材领域字段、项目引用和修订号原子提交，避免产生半关联资产。
// 资产首次入库也在此事务内完成（service 层只做内存构造，不预落库），
// 事务失败时资产一并回滚，不再留下“有资产无链接”的孤儿资产。
func (r *Repository) LinkProjectAsset(asset *model.Asset, version *model.AssetVersion, link *model.ProjectAssetLink) (bool, error) {
	createdLink := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// 资产可能尚未落库（首次导入）或已存在（并发/重试），冲突幂等跳过。
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
		if version != nil {
			if err := tx.Create(version).Error; err != nil {
				return err
			}
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
		return tx.Model(&model.Project{}).Where("id = ?", link.ProjectID).Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error
	})
	return createdLink, err
}

func (r *Repository) DeleteProjectAssetLink(projectID string, assetID string) error {
	return r.db.Delete(&model.ProjectAssetLink{}, "project_id = ? AND asset_id = ?", projectID, assetID).Error
}

func (r *Repository) ProjectAssetShotReferenceCount(projectID string, assetID string) (int64, error) {
	var count int64
	err := r.db.Table("shot_asset_references").
		Joins("JOIN shots ON shots.id = shot_asset_references.shot_id").
		Joins("JOIN asset_versions ON asset_versions.id = shot_asset_references.asset_version_id").
		Where("shots.project_id = ? AND asset_versions.asset_id = ?", projectID, assetID).
		Count(&count).Error
	return count, err
}

func (r *Repository) ProjectAssetLinked(projectID string, assetID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.ProjectAssetLink{}).Where("project_id = ? AND asset_id = ?", projectID, assetID).Count(&count).Error
	return count > 0, err
}

func (r *Repository) AssetReferenceCount(assetID string) (int64, error) {
	var projectLinks int64
	if err := r.db.Model(&model.ProjectAssetLink{}).Where("asset_id = ?", assetID).Count(&projectLinks).Error; err != nil {
		return 0, err
	}
	var shotLinks int64
	err := r.db.Table("shot_asset_references").Joins("JOIN asset_versions ON asset_versions.id = shot_asset_references.asset_version_id").Where("asset_versions.asset_id = ?", assetID).Count(&shotLinks).Error
	return projectLinks + shotLinks, err
}

func (r *Repository) UpdateAssetDomain(asset *model.Asset) error {
	return r.db.Model(&model.Asset{}).Where("id = ? AND user_id = ?", asset.ID, asset.UserID).Updates(map[string]any{"category": asset.Category, "status": asset.Status, "primary_version_id": asset.PrimaryVersionID, "updated_at": asset.UpdatedAt}).Error
}

func (r *Repository) AssetVersions(assetID string) ([]model.AssetVersion, error) {
	var versions []model.AssetVersion
	err := r.db.Where("asset_id = ?", assetID).Order("version desc").Find(&versions).Error
	return versions, err
}

func (r *Repository) ProjectAssetUsageRoles(projectID string, assetID string) ([]string, error) {
	var shotRoles []string
	if err := r.db.Table("shot_asset_references").
		Distinct("shot_asset_references.role").
		Joins("JOIN shots ON shots.id = shot_asset_references.shot_id").
		Joins("JOIN asset_versions ON asset_versions.id = shot_asset_references.asset_version_id").
		Where("shots.project_id = ? AND asset_versions.asset_id = ?", projectID, assetID).
		Order("shot_asset_references.role asc").
		Pluck("shot_asset_references.role", &shotRoles).Error; err != nil {
		return nil, err
	}
	var representationRoles []string
	if err := r.db.Table("asset_representations").
		Distinct("asset_representations.role").
		Joins("JOIN asset_versions ON asset_versions.id = asset_representations.asset_version_id").
		Joins("JOIN project_asset_links ON project_asset_links.asset_id = asset_versions.asset_id").
		Where("project_asset_links.project_id = ? AND asset_versions.asset_id = ?", projectID, assetID).
		Pluck("asset_representations.role", &representationRoles).Error; err != nil {
		return nil, err
	}
	seen := make(map[string]struct{}, len(shotRoles)+len(representationRoles))
	for _, role := range append(shotRoles, representationRoles...) {
		if role != "" {
			seen[role] = struct{}{}
		}
	}
	roles := make([]string, 0, len(seen))
	for role := range seen {
		roles = append(roles, role)
	}
	sort.Strings(roles)
	return roles, nil
}

func (r *Repository) AssetVersionForProject(projectID string, versionID string) (*model.AssetVersion, error) {
	var version model.AssetVersion
	err := r.db.Table("asset_versions").Select("asset_versions.*").Joins("JOIN project_asset_links ON project_asset_links.asset_id = asset_versions.asset_id").Where("project_asset_links.project_id = ? AND asset_versions.id = ?", projectID, versionID).First(&version).Error
	if err != nil {
		return nil, err
	}
	return &version, nil
}

func (r *Repository) CreateAssetVersion(version *model.AssetVersion) error {
	return r.db.Create(version).Error
}
