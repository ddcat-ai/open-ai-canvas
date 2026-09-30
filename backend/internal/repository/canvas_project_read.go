package repository

import "infinite-canvas/backend/internal/model"

// CanvasProjectMetadataForUser reads only fields needed to validate a cached
// canvas representation, avoiding the large JSON body when the caller's ETag
// is still current.
func (r *Repository) CanvasProjectMetadataForUser(userID string, id string) (*model.CanvasProject, error) {
	var project model.CanvasProject
	if err := r.db.Select("id", "user_id", "project_id", "title", "revision", "created_at", "updated_at").
		First(&project, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &project, nil
}
