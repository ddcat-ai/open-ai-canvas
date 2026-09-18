package repository

import (
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type AgentLessonCategoryCount struct {
	Category string
	Count    int64
}

func (r *Repository) ApprovedAgentLessonCategoryCounts(userID string) ([]AgentLessonCategoryCount, error) {
	var rows []AgentLessonCategoryCount
	err := r.db.Model(&model.AgentLesson{}).
		Select("category, count(1) as count").
		Where("author_user_id = ? AND status = ?", strings.TrimSpace(userID), model.AgentLessonStatusApproved).
		Group("category").
		Find(&rows).Error
	return rows, err
}

type AgentLessonCandidate struct {
	ID        string
	Topic     string
	Category  string
	StepsJSON string
}

func (r *Repository) ApprovedAgentLessonCandidates(userID string, limit int) ([]AgentLessonCandidate, error) {
	if limit <= 0 || limit > 2000 {
		limit = 2000
	}
	var rows []AgentLessonCandidate
	err := r.db.Model(&model.AgentLesson{}).
		Select("id, topic, category, steps_json").
		Where("author_user_id = ? AND status = ?", strings.TrimSpace(userID), model.AgentLessonStatusApproved).
		Order("hits DESC, updated_at DESC").
		Limit(limit).
		Find(&rows).Error
	return rows, err
}

func (r *Repository) AgentLessonsByIDs(userID string, ids []string) ([]model.AgentLesson, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	query := r.db.Where("id IN ? AND status = ?", ids, model.AgentLessonStatusApproved)
	if trimmed := strings.TrimSpace(userID); trimmed != "" {
		query = query.Where("author_user_id = ?", trimmed)
	}
	var lessons []model.AgentLesson
	err := query.Find(&lessons).Error
	return lessons, err
}

func (r *Repository) AgentLessonsByCategory(userID, category string, limit int) ([]model.AgentLesson, error) {
	if limit <= 0 || limit > 500 {
		limit = 500
	}
	var lessons []model.AgentLesson
	err := r.db.Where("author_user_id = ? AND status = ? AND category = ?", strings.TrimSpace(userID), model.AgentLessonStatusApproved, category).
		Order("hits DESC, updated_at DESC").Limit(limit).Find(&lessons).Error
	return lessons, err
}

func (r *Repository) AgentLessonByTopic(userID, topic string) (*model.AgentLesson, error) {
	var lesson model.AgentLesson
	err := r.db.Where("author_user_id = ? AND status = ? AND topic = ?", strings.TrimSpace(userID), model.AgentLessonStatusApproved, topic).
		Order("updated_at DESC").First(&lesson).Error
	if err != nil {
		return nil, err
	}
	return &lesson, nil
}

func (r *Repository) UserAgentLessons(userID, status string, limit int) ([]model.AgentLesson, error) {
	query := r.db.Model(&model.AgentLesson{}).Where("author_user_id = ?", strings.TrimSpace(userID))
	if trimmed := strings.TrimSpace(status); trimmed != "" {
		query = query.Where("status = ?", trimmed)
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var lessons []model.AgentLesson
	err := query.Order("updated_at DESC").Limit(limit).Find(&lessons).Error
	return lessons, err
}

func (r *Repository) AgentLessonForUser(userID, id string) (*model.AgentLesson, error) {
	var lesson model.AgentLesson
	query := r.db.Where("id = ?", strings.TrimSpace(id))
	if trimmed := strings.TrimSpace(userID); trimmed != "" {
		query = query.Where("author_user_id = ?", trimmed)
	}
	if err := query.First(&lesson).Error; err != nil {
		return nil, err
	}
	return &lesson, nil
}

const cloudAgentLessonScanMax = 500

func (r *Repository) ApprovedAgentLessons(userID string, limit int) ([]model.AgentLesson, error) {
	if limit <= 0 || limit > cloudAgentLessonScanMax {
		limit = cloudAgentLessonScanMax
	}
	var lessons []model.AgentLesson
	err := r.db.Where("author_user_id = ? AND status = ?", strings.TrimSpace(userID), model.AgentLessonStatusApproved).
		Order("hits DESC, updated_at DESC").Limit(limit).Find(&lessons).Error
	return lessons, err
}

func (r *Repository) CountAgentLessonsByAuthor(userID, status string) (int64, error) {
	query := r.db.Model(&model.AgentLesson{}).Where("author_user_id = ?", strings.TrimSpace(userID))
	if trimmed := strings.TrimSpace(status); trimmed != "" {
		query = query.Where("status = ?", trimmed)
	}
	var count int64
	err := query.Count(&count).Error
	return count, err
}

func (r *Repository) AdminAgentLessons(status, userID, keyword string, limit int) ([]model.AgentLesson, error) {
	query := r.db.Model(&model.AgentLesson{})
	if trimmed := strings.TrimSpace(status); trimmed != "" {
		query = query.Where("status = ?", trimmed)
	}
	if trimmed := strings.TrimSpace(userID); trimmed != "" {
		query = query.Where("author_user_id = ?", trimmed)
	}
	if trimmed := strings.TrimSpace(keyword); trimmed != "" {
		like := "%" + trimmed + "%"
		query = query.Where(
			"topic LIKE ? OR situation LIKE ? OR lesson LIKE ? OR author_user_id LIKE ? OR author_user_id IN (SELECT id FROM users WHERE username LIKE ? OR display_name LIKE ?)",
			like, like, like, like, like, like,
		)
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var lessons []model.AgentLesson
	err := query.Order("updated_at DESC").Limit(limit).Find(&lessons).Error
	return lessons, err
}

func (r *Repository) SetAgentLessonStatus(userID, id, status string) error {
	query := r.db.Model(&model.AgentLesson{}).Where("id = ?", strings.TrimSpace(id))
	if trimmed := strings.TrimSpace(userID); trimmed != "" {
		query = query.Where("author_user_id = ?", trimmed)
	}
	result := query.Update("status", status)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) DeleteAgentLesson(userID, id string) error {
	query := r.db.Where("id = ?", strings.TrimSpace(id))
	if trimmed := strings.TrimSpace(userID); trimmed != "" {
		query = query.Where("author_user_id = ?", trimmed)
	}
	result := query.Delete(&model.AgentLesson{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) SaveAgentLesson(lesson *model.AgentLesson) error {
	return r.db.Save(lesson).Error
}

func (r *Repository) BumpAgentLessonHits(userID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	query := r.db.Model(&model.AgentLesson{}).Where("id IN ?", ids)
	if trimmed := strings.TrimSpace(userID); trimmed != "" {
		query = query.Where("author_user_id = ?", trimmed)
	}
	return query.UpdateColumn("hits", gorm.Expr("hits + 1")).Error
}

func (r *Repository) TouchAgentLesson(userID, id string, verifiedAt time.Time) error {
	query := r.db.Model(&model.AgentLesson{}).Where("id = ?", strings.TrimSpace(id))
	if trimmed := strings.TrimSpace(userID); trimmed != "" {
		query = query.Where("author_user_id = ?", trimmed)
	}
	return query.Updates(map[string]any{"last_verified_at": verifiedAt, "updated_at": verifiedAt}).Error
}

func (r *Repository) BumpAgentLessonInjected(userID string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	query := r.db.Model(&model.AgentLesson{}).Where("id IN ?", ids)
	if trimmed := strings.TrimSpace(userID); trimmed != "" {
		query = query.Where("author_user_id = ?", trimmed)
	}
	return query.UpdateColumn("injected", gorm.Expr("injected + 1")).Error
}

func (r *Repository) ApplyUserAgentMemoryCompact(userID string, updates []model.AgentLesson, deleteIDs []string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return gorm.ErrRecordNotFound
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		for index := range updates {
			lesson := updates[index]
			if strings.TrimSpace(lesson.AuthorUserID) != userID {
				return gorm.ErrRecordNotFound
			}
			if err := tx.Save(&lesson).Error; err != nil {
				return err
			}
		}
		if len(deleteIDs) == 0 {
			return nil
		}
		return tx.Where("author_user_id = ? AND id IN ?", userID, deleteIDs).Delete(&model.AgentLesson{}).Error
	})
}

func (r *Repository) AgentMemorySetting(userID string) (*model.AgentMemorySetting, error) {
	var setting model.AgentMemorySetting
	err := r.db.Where("user_id = ?", strings.TrimSpace(userID)).First(&setting).Error
	if err != nil {
		return nil, err
	}
	return &setting, nil
}

func (r *Repository) SaveAgentMemorySetting(setting *model.AgentMemorySetting) error {
	return r.db.Save(setting).Error
}

func (r *Repository) ScheduledAgentMemorySettings(limit int) ([]model.AgentMemorySetting, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var rows []model.AgentMemorySetting
	err := r.db.Where("compact_interval IN ?", []string{
		model.AgentMemoryCompactIntervalDaily,
		model.AgentMemoryCompactIntervalWeekly,
		model.AgentMemoryCompactIntervalMonthly,
	}).Order("last_compact_at ASC").Limit(limit).Find(&rows).Error
	return rows, err
}
