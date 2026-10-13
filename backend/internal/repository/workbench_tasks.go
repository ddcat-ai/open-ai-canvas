package repository

import (
	"yingce/backend/internal/model"
)

type TaskPage struct {
	Tasks      []model.Task `json:"tasks"`
	NextCursor string       `json:"nextCursor,omitempty"`
}

func (r *Repository) WorkbenchTasks(userID, kind string, activeOnly bool, cursor string, limit int) (TaskPage, error) {
	if limit < 1 || limit > 100 {
		limit = 30
	}
	if kind != model.WorkbenchKindImage && kind != model.WorkbenchKindVideo {
		return TaskPage{}, nil
	}
	query := r.db.Model(&model.Task{}).Where("user_id = ? AND workbench_kind = ?", userID, kind)
	if activeOnly {
		query = query.Where("status IN ?", []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning})
	}
	if cursor != "" {
		query = query.Where("id < ?", cursor)
	}
	var tasks []model.Task
	if err := query.Order("created_at desc, id desc").Limit(limit + 1).Find(&tasks).Error; err != nil {
		return TaskPage{}, err
	}
	page := TaskPage{Tasks: tasks}
	if len(tasks) > limit {
		page.Tasks = tasks[:limit]
		page.NextCursor = page.Tasks[len(page.Tasks)-1].ID
	}
	return page, nil
}
