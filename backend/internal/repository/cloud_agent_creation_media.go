package repository

import "yingce/backend/internal/model"

// CreationMediaTasks returns only media submitted by this user's homepage session.
// Submission order also includes pending/failed tasks, so late completion cannot
// silently renumber a task that the user already referred to.
func (r *Repository) CreationMediaTasks(userID, sessionID, runID string, offset, limit int) ([]model.Task, error) {
	var tasks []model.Task
	query := r.db.Model(&model.Task{}).Select("tasks.*").
		Joins("JOIN cloud_agent_executions a ON a.id = tasks.agent_run_id AND a.user_id = tasks.user_id").
		Where("tasks.user_id = ? AND a.session_id = ? AND a.surface = ? AND tasks.project_id = ? AND tasks.type IN ?", userID, sessionID, "creation", "", []string{"canvas_image", "canvas_video"})
	if runID != "" {
		query = query.Where("a.id = ?", runID)
	}
	err := query.Order("tasks.created_at, tasks.id").Offset(offset).Limit(limit).Find(&tasks).Error
	return tasks, err
}
