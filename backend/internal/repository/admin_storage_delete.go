package repository

import (
	"errors"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrAdminResourceDeleteChanged = errors.New("admin resource delete set changed")
var ErrAdminResourceStillReferenced = errors.New("admin resource is still directly referenced")
var ErrAdminResourceAuditMismatch = errors.New("admin resource delete audit mismatch")

func (r *Repository) AdminResourcesByIDs(ids []string) ([]model.Resource, error) {
	if len(ids) == 0 {
		return []model.Resource{}, nil
	}
	var resources []model.Resource
	err := r.db.Where("id IN ?", ids).Find(&resources).Error
	return resources, err
}

func (r *Repository) AnnouncementResourceReferences(resourceIDs []string) ([]ResourceDirectReference, error) {
	if len(resourceIDs) == 0 {
		return []ResourceDirectReference{}, nil
	}
	var announcements []model.Announcement
	if err := r.db.Where("image_resource_id IN ?", resourceIDs).Find(&announcements).Error; err != nil {
		return nil, err
	}
	result := make([]ResourceDirectReference, 0, len(announcements))
	for _, announcement := range announcements {
		result = append(result, ResourceDirectReference{Kind: "公告", ID: announcement.ID, Title: announcement.Title, ResourceID: announcement.ImageResourceID})
	}
	return result, nil
}

func (r *Repository) DeleteAdminResources(resources []model.Resource, deletionJobs []model.ResourceDeletionJob, audits []model.AdminAuditEvent) error {
	if len(resources) == 0 {
		return nil
	}
	if len(audits) != len(resources) {
		return ErrAdminResourceAuditMismatch
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
			return ErrAdminResourceDeleteChanged
		}
		for _, check := range []struct {
			model any
			query string
		}{
			{&model.Announcement{}, "image_resource_id IN ?"},
			{&model.AssetRepresentation{}, "resource_id IN ?"},
			{&model.VoiceProfile{}, "sample_resource_id IN ?"},
			{&model.ShotArtifact{}, "resource_id IN ?"},
		} {
			var count int64
			if err := tx.Model(check.model).Where(check.query, resourceIDs).Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return ErrAdminResourceStillReferenced
			}
		}
		if err := tx.Where("resource_id IN ?", resourceIDs).Delete(&model.ArkPrivateAssetBinding{}).Error; err != nil {
			return err
		}
		if err := tx.Where("resource_id IN ?", resourceIDs).Delete(&model.AnnouncementImageDraft{}).Error; err != nil {
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
			return ErrAdminResourceDeleteChanged
		}
		if len(audits) > 0 {
			if err := tx.Create(&audits).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
