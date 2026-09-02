package repository

import (
	"errors"
	"strings"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrResourceCleanupSetChanged = errors.New("resource cleanup set changed")
var ErrResourceCleanupStillReferenced = errors.New("resource cleanup resource is still directly referenced")

// DeleteDetachedResources removes Resource rows and enqueues physical deletion in one transaction.
// JSON references are checked by the service before this call; direct foreign-key-like references
// are checked again while the candidate rows are locked to avoid deleting a newly attached object.
func (r *Repository) DeleteDetachedResources(resources []model.Resource, deletionJobs []model.ResourceDeletionJob) error {
	if len(resources) == 0 {
		return nil
	}
	resourceIDs := make([]string, 0, len(resources))
	for _, resource := range resources {
		resourceIDs = append(resourceIDs, resource.ID)
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var current []model.Resource
		query := tx.Where("id IN ?", resourceIDs)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.Find(&current).Error; err != nil {
			return err
		}
		if len(current) != len(resources) {
			return ErrResourceCleanupSetChanged
		}
		// The service performs exact JSON parsing before entering this transaction.
		// This conservative second check closes the common race where an Asset or
		// canvas is attached after that snapshot but before Resource deletion.
		documentsByUser := map[string][]string{}
		for _, resource := range current {
			if _, loaded := documentsByUser[resource.UserID]; loaded {
				continue
			}
			var assetDocuments []string
			if err := tx.Model(&model.Asset{}).Where("user_id = ?", resource.UserID).Pluck("payload_json", &assetDocuments).Error; err != nil {
				return err
			}
			var canvasDocuments []string
			if err := tx.Model(&model.CanvasProject{}).Where("user_id = ?", resource.UserID).Pluck("payload_json", &canvasDocuments).Error; err != nil {
				return err
			}
			documentsByUser[resource.UserID] = append(assetDocuments, canvasDocuments...)
		}
		for _, resource := range current {
			storageKey := "resource:" + resource.ID + `"`
			fileURL := "/api/resources/" + resource.ID + "/"
			for _, document := range documentsByUser[resource.UserID] {
				if strings.Contains(document, storageKey) || strings.Contains(document, fileURL) {
					return ErrResourceCleanupStillReferenced
				}
			}
		}
		for _, check := range []struct {
			model any
			query string
		}{
			{&model.Announcement{}, "image_resource_id IN ?"},
			{&model.AnnouncementImageDraft{}, "resource_id IN ?"},
			{&model.AssetRepresentation{}, "resource_id IN ?"},
			{&model.VoiceProfile{}, "sample_resource_id IN ?"},
			{&model.ShotArtifact{}, "resource_id IN ?"},
		} {
			var count int64
			if err := tx.Model(check.model).Where(check.query, resourceIDs).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return ErrResourceCleanupStillReferenced
			}
		}
		if err := tx.Where("resource_id IN ?", resourceIDs).Delete(&model.ArkPrivateAssetBinding{}).Error; err != nil {
			return err
		}
		if len(deletionJobs) > 0 {
			if err := tx.Create(&deletionJobs).Error; err != nil {
				return err
			}
		}
		deleted := tx.Where("id IN ?", resourceIDs).Delete(&model.Resource{})
		if deleted.Error != nil {
			return deleted.Error
		}
		if deleted.RowsAffected != int64(len(resourceIDs)) {
			return ErrResourceCleanupSetChanged
		}
		return nil
	})
}
