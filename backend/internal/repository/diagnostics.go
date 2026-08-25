package repository

import (
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

const (
	diagnosticTaskLimit    = 100
	diagnosticTaskLogLimit = 2000
	diagnosticAPICallLimit = 1000
)

func (r *Repository) DiagnosticTasks(userID string, from time.Time, to time.Time, taskID string, projectID string) ([]model.Task, error) {
	var tasks []model.Task
	query := r.db.Model(&model.Task{}).Select(
		"id", "user_id", "trace_id", "request_id", "project_id", "type", "status", "stage", "progress",
		"operation", "provider", "model", "logical_model_id", "provider_request_id", "error", "attempts",
		"started_at", "completed_at", "created_at", "updated_at",
	)
	if taskID = strings.TrimSpace(taskID); taskID != "" {
		query = query.Where("user_id = ? AND id = ?", userID, taskID)
	} else {
		query = query.Where("user_id = ? AND created_at >= ? AND created_at <= ?", userID, from, to)
		if projectID = strings.TrimSpace(projectID); projectID != "" {
			query = query.Where("project_id = ?", projectID)
		}
	}
	err := query.Order("created_at asc").Limit(diagnosticTaskLimit).Find(&tasks).Error
	return tasks, err
}

func (r *Repository) DiagnosticTaskLogs(userID string, from time.Time, to time.Time, taskID string, projectID string) ([]model.TaskLog, error) {
	var logs []model.TaskLog
	query := r.db.Where("user_id = ?", userID)
	if taskID = strings.TrimSpace(taskID); taskID != "" {
		query = query.Where("task_id = ?", taskID)
	} else {
		query = query.Where("created_at >= ? AND created_at <= ?", from, to)
		if projectID = strings.TrimSpace(projectID); projectID != "" {
			query = query.Where("task_id IN (SELECT id FROM tasks WHERE user_id = ? AND project_id = ?)", userID, projectID)
		}
	}
	err := query.Order("created_at asc").Limit(diagnosticTaskLogLimit).Find(&logs).Error
	return logs, err
}

func (r *Repository) DiagnosticAPICallLogs(userID string, from time.Time, to time.Time, taskID string, projectID string) ([]model.ApiCallLog, error) {
	var logs []model.ApiCallLog
	query := r.db.Where("user_id = ?", userID)
	if taskID = strings.TrimSpace(taskID); taskID != "" {
		query = query.Where("task_id = ?", taskID)
	} else {
		query = query.Where("created_at >= ? AND created_at <= ?", from, to)
		if projectID = strings.TrimSpace(projectID); projectID != "" {
			query = query.Where("task_id IN (SELECT id FROM tasks WHERE user_id = ? AND project_id = ?)", userID, projectID)
		}
	}
	err := query.Omit("RequestBody", "ResponseBody").Order("created_at asc").Limit(diagnosticAPICallLimit).Find(&logs).Error
	return logs, err
}
