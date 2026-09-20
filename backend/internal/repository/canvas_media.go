package repository

import (
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *Repository) SaveCanvasMediaGrants(grants []model.CanvasMediaGrant) error {
	if len(grants) == 0 {
		return nil
	}
	return r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "canvas_id"}, {Name: "kind"}, {Name: "object_id"}}, DoUpdates: clause.AssignmentColumns([]string{"current"})}).CreateInBatches(grants, 200).Error
}

func (r *Repository) SetCurrentCanvasMediaGrants(canvasID string, grants []model.CanvasMediaGrant) error {
	if err := r.db.Model(&model.CanvasMediaGrant{}).Where("canvas_id = ? AND current = ?", canvasID, true).Update("current", false).Error; err != nil {
		return err
	}
	return r.SaveCanvasMediaGrants(grants)
}

func (r *Repository) CanvasMediaGrants(canvasIDs []string) ([]model.CanvasMediaGrant, error) {
	var grants []model.CanvasMediaGrant
	if len(canvasIDs) == 0 {
		return grants, nil
	}
	err := r.db.Where("canvas_id IN ?", canvasIDs).Find(&grants).Error
	return grants, err
}

func (r *Repository) readableCanvasMediaIDs(userID, kind string) *gorm.DB {
	return r.db.Model(&model.CanvasMediaGrant{}).Select("canvas_media_grants.object_id").
		Joins("JOIN canvas_projects ON canvas_projects.id = canvas_media_grants.canvas_id").
		Where("canvas_media_grants.kind = ?", kind).
		Where("canvas_projects.user_id = ? OR EXISTS (SELECT 1 FROM canvas_collaborators WHERE canvas_collaborators.canvas_id = canvas_projects.id AND canvas_collaborators.user_id = ?)", userID, userID)
}

func (r *Repository) GrantedResourceForReader(userID, resourceID string) (*model.Resource, error) {
	var resource model.Resource
	err := r.db.Where("id = ? AND id IN (?)", resourceID, r.readableCanvasMediaIDs(userID, model.CanvasMediaResource)).First(&resource).Error
	return &resource, err
}

func (r *Repository) GrantedAssetsForReader(userID string, ids []string) ([]model.Asset, error) {
	var items []model.Asset
	if len(ids) == 0 {
		return items, nil
	}
	err := r.db.Where("id IN ? AND id IN (?)", ids, r.readableCanvasMediaIDs(userID, model.CanvasMediaAsset)).Find(&items).Error
	return items, err
}

func (r *Repository) ResourceRecords(ids []string) ([]model.Resource, error) {
	var items []model.Resource
	if len(ids) == 0 {
		return items, nil
	}
	query := r.db.Where("id IN ?", ids).Order("id")
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.Find(&items).Error
	return items, err
}

func (r *Repository) AssetRecords(ids []string) ([]model.Asset, error) {
	var items []model.Asset
	if len(ids) == 0 {
		return items, nil
	}
	query := r.db.Where("id IN ?", ids).Order("id")
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.Find(&items).Error
	return items, err
}

func (r *Repository) CanvasProjectsReferencingUserAssets(userID string) ([]model.CanvasProject, error) {
	var items []model.CanvasProject
	shared := r.db.Table("canvas_media_grants AS media").Select("media.canvas_id").
		Joins("JOIN assets ON assets.id = media.object_id").
		Where("media.kind = ? AND media.current = ? AND assets.user_id = ?", model.CanvasMediaAsset, true, userID)
	err := r.db.Where("user_id = ? OR id IN (?)", userID, shared).Find(&items).Error
	return items, err
}

func (r *Repository) ResourceGrantedToCanvas(canvasID, resourceID string) (*model.Resource, error) {
	var resource model.Resource
	granted := r.db.Model(&model.CanvasMediaGrant{}).Select("object_id").
		Where("canvas_id = ? AND kind = ?", canvasID, model.CanvasMediaResource)
	err := r.db.Where("id = ? AND id IN (?)", resourceID, granted).First(&resource).Error
	return &resource, err
}

func (r *Repository) CurrentCanvasMediaResourceReferences(ids []string) ([]ResourceDirectReference, error) {
	return r.currentCanvasMediaReferences(model.CanvasMediaResource, ids)
}

func (r *Repository) CurrentCanvasMediaAssetReferences(ids []string) ([]ResourceDirectReference, error) {
	return r.currentCanvasMediaReferences(model.CanvasMediaAsset, ids)
}

func (r *Repository) currentCanvasMediaReferences(kind string, ids []string) ([]ResourceDirectReference, error) {
	var refs []ResourceDirectReference
	if len(ids) == 0 {
		return refs, nil
	}
	err := r.db.Table("canvas_media_grants AS media").
		Select("'共享画布' AS kind, canvas_projects.id, canvas_projects.title, media.object_id AS resource_id").
		Joins("JOIN canvas_projects ON canvas_projects.id = media.canvas_id").
		Where("media.kind = ? AND media.object_id IN ? AND media.current = ?", kind, ids, true).Scan(&refs).Error
	return refs, err
}
