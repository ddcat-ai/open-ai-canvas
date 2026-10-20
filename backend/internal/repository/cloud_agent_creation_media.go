package repository

import "yingce/backend/internal/model"

// CreationMediaTasks returns media from this homepage session and its explicitly
// imported ordinary tasks, with the same user and project boundaries.
// Submission order also includes pending/failed tasks, so late completion cannot
// silently renumber a task that the user already referred to.
func (r *Repository) CreationMediaTasks(userID, sessionID, runID string, offset, limit int, ordinaryTaskIDs ...string) ([]model.Task, error) {
	var tasks []model.Task
	query := r.db.Model(&model.Task{}).Select("tasks.*").
		Joins("LEFT JOIN cloud_agent_executions a ON a.id = tasks.agent_run_id AND a.user_id = tasks.user_id").
		Where("tasks.user_id = ? AND tasks.project_id = ? AND tasks.type IN ?", userID, "", []string{"canvas_image", "canvas_video"})
	if runID != "" {
		query = query.Where("a.session_id = ? AND a.surface = ? AND a.id = ?", sessionID, "creation", runID)
	} else if len(ordinaryTaskIDs) > 0 {
		query = query.Where("(a.session_id = ? AND a.surface = ?) OR (tasks.agent_run_id = ? AND tasks.id IN ?)", sessionID, "creation", "", ordinaryTaskIDs)
	} else {
		query = query.Where("a.session_id = ? AND a.surface = ?", sessionID, "creation")
	}
	err := query.Order("tasks.created_at, tasks.id").Offset(offset).Limit(limit).Find(&tasks).Error
	return tasks, err
}
