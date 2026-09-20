package repository

import (
	"errors"
	"slices"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrCanvasHistoryResourceMissing = errors.New("canvas history resource missing")
var ErrCanvasHistoryResourceReferenced = errors.New("resource referenced by canvas history")

const canvasSnapshotSummaryColumns = "id, canvas_id, user_id, revision, title, node_count, connection_count, payload_bytes, reason, content_updated_at, created_at"

func (r *Repository) CanvasProjectMetadata(userID, id string) (*model.CanvasProject, error) {
	var project model.CanvasProject
	err := r.db.Omit("payload_json").Where("id = ? AND user_id = ?", id, userID).First(&project).Error
	return &project, err
}

func (r *Repository) CanvasSnapshots(userID, canvasID string, limit int) ([]model.CanvasSnapshot, error) {
	items := []model.CanvasSnapshot{}
	err := r.db.Select(canvasSnapshotSummaryColumns).Where("user_id = ? AND canvas_id = ?", userID, canvasID).
		Order("revision DESC").Limit(limit).Find(&items).Error
	return items, err
}

func (r *Repository) CanvasSnapshot(userID, canvasID, id string) (*model.CanvasSnapshot, error) {
	var item model.CanvasSnapshot
	err := r.db.Where("id = ? AND user_id = ? AND canvas_id = ?", id, userID, canvasID).First(&item).Error
	return &item, err
}

func (r *Repository) CanvasSnapshotAtRevision(userID, canvasID string, revision int64) (*model.CanvasSnapshot, error) {
	var item model.CanvasSnapshot
	err := r.db.Where("user_id = ? AND canvas_id = ? AND revision = ?", userID, canvasID, revision).First(&item).Error
	return &item, err
}

// The successful CAS takes the canvas row lock before inspecting the history.
// Snapshot creation, reference protection and retention commit with the content.
func (r *Repository) SaveCanvasWithSnapshot(project *model.CanvasProject, snapshot *model.CanvasSnapshot, resourceIDs, restoredResourceIDs []string, cutoff time.Time, limit int, force bool) error {
	next := *project
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := New(tx).UpsertCanvasProject(&next); err != nil {
			return err
		}
		if snapshot == nil {
			return nil
		}
		var last model.CanvasSnapshot
		err := tx.Select("id", "revision", "created_at").Where("canvas_id = ?", project.ID).Order("revision DESC").First(&last).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		capture := err != nil || (last.Revision != snapshot.Revision && (force || !last.CreatedAt.After(cutoff)))
		requiredIDs := append([]string{}, restoredResourceIDs...)
		if capture {
			requiredIDs = append(requiredIDs, resourceIDs...)
		}
		slices.Sort(requiredIDs)
		requiredIDs = slices.Compact(requiredIDs)
		if len(requiredIDs) > 0 {
			var resources []model.Resource
			query := tx.Select("id").Where("id IN ? AND status = ?", requiredIDs, model.ResourceStatusReady).Order("id")
			if r.Dialect() == "postgres" {
				query = query.Clauses(clause.Locking{Strength: "UPDATE"})
			}
			if err := query.Find(&resources).Error; err != nil {
				return err
			}
			if len(resources) != len(requiredIDs) {
				return ErrCanvasHistoryResourceMissing
			}
		}
		if !capture {
			return nil
		}
		if err := tx.Create(snapshot).Error; err != nil {
			return err
		}
		refs := make([]model.CanvasSnapshotResource, 0, len(resourceIDs))
		for _, id := range resourceIDs {
			refs = append(refs, model.CanvasSnapshotResource{SnapshotID: snapshot.ID, ResourceID: id})
		}
		if len(refs) > 0 {
			if err := tx.CreateInBatches(refs, 200).Error; err != nil {
				return err
			}
		}
		var expired []string
		if err := tx.Model(&model.CanvasSnapshot{}).Where("canvas_id = ?", project.ID).Order("revision DESC").Offset(limit).Limit(100).Pluck("id", &expired).Error; err != nil {
			return err
		}
		return deleteCanvasSnapshots(tx, expired)
	})
	if err == nil {
		*project = next
	}
	return err
}

func (r *Repository) CanvasHistoryReferencesObject(resource *model.Resource) (bool, error) {
	var count int64
	aliases := r.db.Model(&model.Resource{}).Select("id").Where("endpoint = ? AND bucket = ? AND object_key = ?", resource.Endpoint, resource.Bucket, resource.ObjectKey)
	err := r.db.Model(&model.CanvasSnapshotResource{}).
		Where("resource_id = ? OR resource_id IN (?)", resource.ID, aliases).
		Count(&count).Error
	if err != nil || count > 0 {
		return count > 0, err
	}
	err = r.db.Model(&model.CanvasMediaGrant{}).
		Where("kind = ? AND current = ? AND (object_id = ? OR object_id IN (?))", model.CanvasMediaResource, true, resource.ID, aliases).
		Count(&count).Error
	return count > 0, err
}

func deleteCanvasSnapshots(tx *gorm.DB, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	if err := tx.Where("snapshot_id IN ?", ids).Delete(&model.CanvasSnapshotResource{}).Error; err != nil {
		return err
	}
	return tx.Where("id IN ?", ids).Delete(&model.CanvasSnapshot{}).Error
}

func (r *Repository) CanvasHistoryResourceReferences(resourceIDs []string) ([]ResourceDirectReference, error) {
	refs := []ResourceDirectReference{}
	if len(resourceIDs) == 0 {
		return refs, nil
	}
	err := r.db.Table("canvas_snapshot_resources AS refs").
		Select("'画布历史版本' AS kind, snapshots.canvas_id AS id, snapshots.title, refs.resource_id").
		Joins("JOIN canvas_snapshots AS snapshots ON snapshots.id = refs.snapshot_id").
		Where("refs.resource_id IN ?", resourceIDs).Distinct().Scan(&refs).Error
	return refs, err
}

func (r *Repository) RequireNoCanvasHistoryReferences(resourceIDs []string) error {
	if len(resourceIDs) == 0 {
		return nil
	}
	var resources []model.Resource
	query := r.db.Select("id").Where("id IN ?", resourceIDs).Order("id")
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	if err := query.Find(&resources).Error; err != nil {
		return err
	}
	refs, err := r.CanvasHistoryResourceReferences(resourceIDs)
	if err != nil {
		return err
	}
	if len(refs) > 0 {
		return ErrCanvasHistoryResourceReferenced
	}
	shared, err := r.CurrentCanvasMediaResourceReferences(resourceIDs)
	if err != nil {
		return err
	}
	if len(shared) > 0 {
		return ErrCanvasHistoryResourceReferenced
	}
	return nil
}
