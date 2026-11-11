// 素材与画布项目的基础读写。
//
// 素材的彻底删除（含引用、Outbox）在 resource_reference.go 的 DeleteAssetsAndResources。

package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	canvasdoc "yingce/backend/internal/canvas/document"
	"yingce/backend/internal/model"
)

func (r *Repository) Assets(userID string) ([]model.Asset, error) {
	var assets []model.Asset
	err := r.db.Order("updated_at desc").Find(&assets, "user_id = ?", userID).Error
	return assets, err
}

func (r *Repository) AssetSummaries(userID string) ([]model.Asset, error) {
	var assets []model.Asset
	err := r.db.Select("id", "folder_id", "kind", "category", "status", "primary_version_id", "title", "created_at", "updated_at").Order("updated_at desc").Find(&assets, "user_id = ?", userID).Error
	return assets, err
}

func (r *Repository) AssetForUser(userID string, id string) (*model.Asset, error) {
	var asset model.Asset
	if err := r.db.First(&asset, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func (r *Repository) AssetsForUserIDs(userID string, ids []string) ([]model.Asset, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var assets []model.Asset
	err := r.db.Find(&assets, "user_id = ? AND id IN ?", userID, ids).Error
	return assets, err
}

func (r *Repository) UpsertAsset(asset *model.Asset) error {
	result := r.db.Model(&model.Asset{}).
		Where("id = ? AND user_id = ?", asset.ID, asset.UserID).
		Updates(map[string]any{"folder_id": asset.FolderID, "kind": asset.Kind, "category": asset.Category, "status": asset.Status, "primary_version_id": asset.PrimaryVersionID, "title": asset.Title, "payload_json": asset.PayloadJSON, "updated_at": asset.UpdatedAt})
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	return r.db.Create(asset).Error
}

func (r *Repository) DeleteAsset(userID string, id string) error {
	return r.DeleteAssetAndResources(userID, id, nil, nil, false)
}

func (r *Repository) FindExpiredArchivedAssets(cutoff time.Time, limit int) ([]model.Asset, error) {
	var assets []model.Asset
	if limit <= 0 {
		limit = 100
	}
	err := r.db.Where("status = ? AND updated_at <= ?", model.AssetVersionStatusArchived, cutoff).
		Order("updated_at asc, id asc").
		Limit(limit).
		Find(&assets).Error
	return assets, err
}

func (r *Repository) ReplaceAssets(userID string, assets []model.Asset) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&model.Asset{}, "user_id = ?", userID).Error; err != nil {
			return err
		}
		if len(assets) == 0 {
			return nil
		}
		return tx.Create(&assets).Error
	})
}

func (r *Repository) CanvasProjects(userID string) ([]model.CanvasProject, error) {
	var projects []model.CanvasProject
	err := r.db.Order("updated_at desc").Find(&projects, "user_id = ?", userID).Error
	return projects, err
}

func (r *Repository) CanvasProjectSummaries(userID string) ([]model.CanvasProject, error) {
	var projects []model.CanvasProject
	err := r.db.Select("id", "title", "revision", "created_at", "updated_at").Order("updated_at desc").Find(&projects, "user_id = ?", userID).Error
	return projects, err
}

func (r *Repository) CanvasProjectForUser(userID string, id string) (*model.CanvasProject, error) {
	var project model.CanvasProject
	if err := r.db.First(&project, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

func (r *Repository) UpsertCanvasProject(project *model.CanvasProject) error {
	canonical, changed, err := canvasdoc.Canonicalize([]byte(project.PayloadJSON))
	if err != nil {
		return err
	}
	if changed {
		project.PayloadJSON = string(canonical)
	}
	return r.Transaction(func(tx *Repository) error {
		if project.Revision > 0 {
			if err := tx.LockCanvasMutation(project.UserID, project.ID); err != nil {
				return err
			}
			before, err := tx.CanvasProjectForUser(project.UserID, project.ID)
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrCanvasRevisionConflict
			}
			if err != nil {
				return err
			}
			if err := tx.checkCanvasEditLeases(before, project); err != nil {
				return err
			}
		}
		return tx.upsertCanvasProject(project)
	})
}

func (r *Repository) upsertCanvasProject(project *model.CanvasProject) error {
	expected := project.Revision
	if expected < 0 {
		return ErrCanvasRevisionConflict
	}
	if expected == 0 {
		created := *project
		created.Revision = 1
		result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&created)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCanvasRevisionConflict
		}
		project.Revision = 1
		r.canvasChanged(project.UserID, project.ID)
		return nil
	}
	// The revision predicate and increment must be in the same SQL statement.
	// A missing row is a conflict, never an invitation to recreate a deleted canvas.
	result := r.db.Model(&model.CanvasProject{}).
		Where("id = ? AND user_id = ? AND revision = ?", project.ID, project.UserID, expected).
		Updates(map[string]any{"project_id": project.ProjectID, "title": project.Title, "payload_json": project.PayloadJSON, "updated_at": project.UpdatedAt, "revision": expected + 1})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCanvasRevisionConflict
	}
	project.Revision = expected + 1
	r.canvasChanged(project.UserID, project.ID)
	return nil
}

func (r *Repository) DeleteCanvasProject(userID string, id string) error {
	return r.Transaction(func(repo *Repository) error {
		tx := repo.db
		// Serialize deletion with saves before reading the history IDs to remove.
		if err := tx.Model(&model.CanvasProject{}).Where("user_id = ? AND id = ?", userID, id).UpdateColumn("revision", gorm.Expr("revision")).Error; err != nil {
			return err
		}
		var snapshotIDs []string
		before, err := New(tx).CanvasProjectForUser(userID, id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		// Admission locks this same canvas before reserving a root task. Include
		// text_replay carriers, approval waits and terminal runs still cleaning up.
		activity, err := repo.CanvasAgentActivity(userID, id)
		if err != nil {
			return err
		}
		if activity != nil {
			return &CanvasAgentBusyError{Activity: *activity}
		}
		if err := New(tx).checkCanvasEditLeases(before, nil); err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND canvas_id = ?", userID, id).Delete(&model.CanvasEditLease{}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.CanvasSnapshot{}).Where("user_id = ? AND canvas_id = ?", userID, id).Pluck("id", &snapshotIDs).Error; err != nil {
			return err
		}
		if err := deleteCanvasSnapshots(tx, snapshotIDs); err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND project_id = ?", userID, id).Delete(&model.CanvasShare{}).Error; err != nil {
			return err
		}
		if err := tx.Where("canvas_id = ?", id).Delete(&model.CanvasUnitLink{}).Error; err != nil {
			return err
		}
		// Agent 根任务的画布 ID 是冻结请求身份的一部分；保留它才能查询历史、
		// 核对原幂等请求和在其他画布续轮。已删除的实体不能由该 ID 重新创建。
		if err := tx.Model(&model.Task{}).Where("user_id = ? AND project_id = ? AND operation <> ?", userID, id, "cloud_agent").Update("project_id", "").Error; err != nil {
			return err
		}
		if err := tx.Delete(&model.CanvasProject{}, "id = ? AND user_id = ?", id, userID).Error; err != nil {
			return err
		}
		repo.canvasChanged(userID, id)
		return nil
	})
}
