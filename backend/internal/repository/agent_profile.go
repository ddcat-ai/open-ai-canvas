package repository

import (
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) AgentProfile(userID, scope, projectID, canvasID string) (*model.AgentProfile, error) {
	var profile model.AgentProfile
	if err := r.db.Where("user_id = ? AND scope = ? AND project_id = ? AND canvas_id = ?", userID, scope, projectID, canvasID).First(&profile).Error; err != nil {
		return nil, err
	}
	return &profile, nil
}

func (r *Repository) SaveAgentProfile(profile *model.AgentProfile, expectedRevision int64) error {
	if profile == nil {
		return gorm.ErrInvalidData
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var current model.AgentProfile
		err := tx.Where("user_id = ? AND scope = ? AND project_id = ? AND canvas_id = ?", profile.UserID, profile.Scope, profile.ProjectID, profile.CanvasID).First(&current).Error
		if err != nil && err != gorm.ErrRecordNotFound {
			return err
		}
		if err == gorm.ErrRecordNotFound {
			if expectedRevision != 0 {
				return ErrTaskStateConflict
			}
			return tx.Create(profile).Error
		}
		if expectedRevision != current.Revision {
			return ErrTaskStateConflict
		}
		profile.ID, profile.Revision, profile.CreatedAt = current.ID, current.Revision+1, current.CreatedAt
		result := tx.Model(&model.AgentProfile{}).Where("id = ? AND revision = ?", current.ID, current.Revision).Updates(map[string]any{
			"content": profile.Content, "revision": profile.Revision, "hash": profile.Hash, "updated_at": profile.UpdatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		return nil
	})
}
