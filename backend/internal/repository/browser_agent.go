package repository

import "yingce/backend/internal/model"

func (r *Repository) UserActiveAgentRuns(userID string) ([]model.CloudAgentExecution, error) {
	var runs []model.CloudAgentExecution
	err := r.db.Where("user_id = ? AND status IN ?", userID, []string{"running", "queued", "waiting_approval", "waiting_user"}).Order("created_at DESC").Limit(100).Find(&runs).Error
	return runs, err
}
