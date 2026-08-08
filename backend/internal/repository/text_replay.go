package repository

import (
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type TextReplayLimits struct {
	MaxTaskBytes  int64
	MaxUserBytes  int64
	MaxTaskEvents int64
}

type TextReplayStats struct {
	EventCount int64      `json:"eventCount"`
	TaskCount  int64      `json:"taskCount"`
	ByteCount  int64      `json:"byteCount"`
	OldestAt   *time.Time `json:"oldestAt,omitempty"`
}

func (r *Repository) AppendTaskTextDelta(userID string, taskID string, content string, expiresAt time.Time, limits TextReplayLimits) (*model.TaskTextDelta, error) {
	var created model.TaskTextDelta
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var task model.Task
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "user_id", "status").First(&task, "id = ? AND user_id = ?", taskID, userID).Error; err != nil {
			return err
		}
		if task.Status == model.TaskStatusSucceeded || task.Status == model.TaskStatusFailed || task.Status == model.TaskStatusCancelled {
			return ErrTextReplayClosed
		}
		var taskUsage struct {
			Count int64
			Bytes int64
			Max   int64
		}
		if err := tx.Model(&model.TaskTextDelta{}).Select("count(*) AS count, COALESCE(sum(byte_count), 0) AS bytes, COALESCE(max(sequence), 0) AS max").Where("task_id = ?", taskID).Scan(&taskUsage).Error; err != nil {
			return err
		}
		var userBytes int64
		if err := tx.Model(&model.TaskTextDelta{}).Select("COALESCE(sum(byte_count), 0)").Where("user_id = ?", userID).Scan(&userBytes).Error; err != nil {
			return err
		}
		incoming := int64(len([]byte(content)))
		if taskUsage.Count+1 > limits.MaxTaskEvents || taskUsage.Bytes+incoming > limits.MaxTaskBytes || userBytes+incoming > limits.MaxUserBytes {
			return ErrTextReplayQuotaExceeded
		}
		created = model.TaskTextDelta{ID: newRepositoryID(), UserID: userID, TaskID: taskID, Sequence: taskUsage.Max + 1, Content: content, ByteCount: incoming, CreatedAt: time.Now(), ExpiresAt: expiresAt}
		return tx.Create(&created).Error
	})
	return &created, err
}

func (r *Repository) TaskTextDeltas(userID string, taskID string, after int64, limit int) ([]model.TaskTextDelta, error) {
	var items []model.TaskTextDelta
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}
	err := r.db.Where("user_id = ? AND task_id = ? AND sequence > ?", userID, taskID, after).Order("sequence asc").Limit(limit).Find(&items).Error
	return items, err
}

func (r *Repository) CompactTaskTextDeltas(taskID string, expiresAt time.Time, keepDraft bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var task model.Task
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&task, "id = ?", taskID).Error; err != nil {
			return err
		}
		if keepDraft {
			var items []model.TaskTextDelta
			if err := tx.Select("content").Where("task_id = ?", taskID).Order("sequence asc").Find(&items).Error; err != nil {
				return err
			}
			if task.TextDraft == "" {
				for _, item := range items {
					task.TextDraft += item.Content
				}
				if err := tx.Model(&task).Update("text_draft", task.TextDraft).Error; err != nil {
					return err
				}
			}
		}
		return tx.Model(&model.TaskTextDelta{}).Where("task_id = ?", taskID).Update("expires_at", expiresAt).Error
	})
}

func (r *Repository) CleanupTaskTextDeltas(now time.Time) (int64, error) {
	var deleted int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var taskIDs []string
		if err := tx.Model(&model.TaskTextDelta{}).Where("expires_at <= ?", now).Distinct().Pluck("task_id", &taskIDs).Error; err != nil {
			return err
		}
		for _, taskID := range taskIDs {
			var task model.Task
			if err := tx.Select("id", "status", "text_draft").First(&task, "id = ?", taskID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					continue
				}
				return err
			}
			if task.TextDraft != "" || (task.Status != model.TaskStatusFailed && task.Status != model.TaskStatusCancelled) {
				continue
			}
			var items []model.TaskTextDelta
			if err := tx.Select("content").Where("task_id = ?", taskID).Order("sequence asc").Find(&items).Error; err != nil {
				return err
			}
			for _, item := range items {
				task.TextDraft += item.Content
			}
			if err := tx.Model(&task).Update("text_draft", task.TextDraft).Error; err != nil {
				return err
			}
		}
		result := tx.Where("expires_at <= ? OR NOT EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_text_delta.task_id)", now).Delete(&model.TaskTextDelta{})
		deleted = result.RowsAffected
		return result.Error
	})
	return deleted, err
}

func (r *Repository) DeleteUserTaskTextDeltas(userID string) error {
	return r.db.Delete(&model.TaskTextDelta{}, "user_id = ?", userID).Error
}

func (r *Repository) TextReplayStats() (TextReplayStats, error) {
	var stats TextReplayStats
	err := r.db.Model(&model.TaskTextDelta{}).Select("count(*) AS event_count, count(DISTINCT task_id) AS task_count, COALESCE(sum(byte_count), 0) AS byte_count, min(created_at) AS oldest_at").Scan(&stats).Error
	return stats, err
}
