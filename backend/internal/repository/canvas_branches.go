package repository

import (
	"errors"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrCanvasBranchRevisionConflict = errors.New("canvas branch revision changed")

func (r *Repository) CanvasBranch(id string) (*model.CanvasBranch, error) {
	var branch model.CanvasBranch
	err := r.db.Where("id = ?", strings.TrimSpace(id)).First(&branch).Error
	return &branch, err
}

func (r *Repository) CanvasBranchByCanvasID(canvasID string) (*model.CanvasBranch, error) {
	var branch model.CanvasBranch
	err := r.db.Where("branch_canvas_id = ?", strings.TrimSpace(canvasID)).First(&branch).Error
	return &branch, err
}

func (r *Repository) CanvasBranchesForSource(sourceCanvasID string) ([]model.CanvasBranch, error) {
	var branches []model.CanvasBranch
	err := r.db.Where("source_canvas_id = ?", strings.TrimSpace(sourceCanvasID)).Order("updated_at desc, id desc").Find(&branches).Error
	return branches, err
}

func (r *Repository) ArchiveCanvasBranch(id string, now time.Time) (bool, error) {
	result := r.db.Model(&model.CanvasBranch{}).Where("id = ? AND status = ?", id, "active").Updates(map[string]any{"status": "archived", "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) CreateCanvasBranch(branchCanvas *model.CanvasProject, branch *model.CanvasBranch, members []model.CanvasCollaborator) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(branchCanvas).Error; err != nil {
			return err
		}
		if err := tx.Create(branch).Error; err != nil {
			return err
		}
		if len(members) > 0 {
			if err := tx.CreateInBatches(members, 100).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// WithCanvasBranchMerge locks the relationship, branch document and target
// document in a deterministic order. The callback must update the target row
// through tx and may update the branch relationship in the same transaction.
func (r *Repository) WithCanvasBranchMerge(branchID, targetCanvasID string, fn func(*gorm.DB, *model.CanvasBranch, *model.CanvasProject, *model.CanvasProject) error) error {
	branchID = strings.TrimSpace(branchID)
	targetCanvasID = strings.TrimSpace(targetCanvasID)
	if branchID == "" || targetCanvasID == "" || fn == nil {
		return gorm.ErrInvalidData
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var branch model.CanvasBranch
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", branchID).First(&branch).Error; err != nil {
			return err
		}
		if branch.BranchCanvasID == targetCanvasID {
			return gorm.ErrInvalidData
		}
		ids := []string{branch.BranchCanvasID, targetCanvasID}
		sort.Strings(ids)
		projects := make(map[string]*model.CanvasProject, 2)
		for _, id := range ids {
			var project model.CanvasProject
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).First(&project).Error; err != nil {
				return err
			}
			projects[id] = &project
		}
		return fn(tx, &branch, projects[branch.BranchCanvasID], projects[targetCanvasID])
	})
}

// UpdateCanvasProjectWithSnapshotTx performs the target CAS and writes its
// merge snapshot in the caller's transaction. It intentionally does not
// retain viewport/revision metadata from the submitted document.
func (r *Repository) UpdateCanvasProjectWithSnapshotTx(tx *gorm.DB, project *model.CanvasProject, snapshot *model.CanvasSnapshot, resourceIDs []string) error {
	if project == nil || tx == nil {
		return gorm.ErrInvalidData
	}
	expected := project.Revision
	result := tx.Model(&model.CanvasProject{}).
		Where("id = ? AND user_id = ? AND revision = ?", project.ID, project.UserID, expected).
		Updates(map[string]any{
			"project_id": project.ProjectID,
			"title":      project.Title, "payload_json": project.PayloadJSON,
			"updated_at": project.UpdatedAt, "revision": expected + 1,
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrCanvasBranchRevisionConflict
	}
	project.Revision = expected + 1
	if snapshot == nil {
		return nil
	}
	if len(resourceIDs) > 0 {
		var count int64
		if err := tx.Model(&model.Resource{}).Where("id IN ? AND status = ?", resourceIDs, model.ResourceStatusReady).Count(&count).Error; err != nil {
			return err
		}
		if count != int64(len(resourceIDs)) {
			return ErrCanvasHistoryResourceMissing
		}
	}
	if err := tx.Create(snapshot).Error; err != nil {
		return err
	}
	refs := make([]model.CanvasSnapshotResource, 0, len(resourceIDs))
	for _, resourceID := range resourceIDs {
		refs = append(refs, model.CanvasSnapshotResource{SnapshotID: snapshot.ID, ResourceID: resourceID})
	}
	if len(refs) > 0 {
		if err := tx.CreateInBatches(refs, 200).Error; err != nil {
			return err
		}
	}
	var expired []string
	if err := tx.Model(&model.CanvasSnapshot{}).Where("canvas_id = ?", project.ID).Order("revision DESC").Offset(20).Limit(100).Pluck("id", &expired).Error; err != nil {
		return err
	}
	return deleteCanvasSnapshots(tx, expired)
}

func (r *Repository) TouchCanvasBranchMerge(tx *gorm.DB, branchID string, sourceRevision, targetRevision int64, actorID string, now time.Time) error {
	return tx.Model(&model.CanvasBranch{}).Where("id = ?", branchID).Updates(map[string]any{
		"last_merged_source_rev": sourceRevision,
		"last_merged_target_rev": targetRevision,
		"merged_at":              now,
		"merged_by":              actorID,
		"updated_at":             now,
	}).Error
}
