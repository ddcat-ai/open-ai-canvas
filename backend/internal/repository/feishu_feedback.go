package repository

import (
	"strings"
	"time"

	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

// FeishuFeedbackUserPrefix distinguishes inbound Feishu messages from normal
// signed-in user feedback while reusing the existing admin feedback inbox.
const FeishuFeedbackUserPrefix = "feishu:"

// CreateOrGetFeishuFeedback inserts a normalized Feishu message exactly once.
// The caller supplies a deterministic primary key derived from the event ID;
// a duplicate delivery returns the already stored row and is acknowledged.
func (r *Repository) CreateOrGetFeishuFeedback(feedback *model.UserFeedback) (created bool, existing *model.UserFeedback, err error) {
	if feedback == nil || strings.TrimSpace(feedback.ID) == "" {
		return false, nil, ErrCreationConflict
	}
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(feedback)
	if result.Error != nil {
		return false, nil, result.Error
	}
	if result.RowsAffected == 1 {
		return true, feedback, nil
	}
	var row model.UserFeedback
	if err := r.db.Where("id = ?", feedback.ID).First(&row).Error; err != nil {
		return false, nil, err
	}
	return false, &row, nil
}

// ListFeishuFeedbacksBetween returns inbound messages in [start,end), ordered
// by their original creation time for deterministic digest formatting.
func (r *Repository) ListFeishuFeedbacksBetween(start, end time.Time) ([]model.UserFeedback, error) {
	var rows []model.UserFeedback
	err := r.db.Where("user_id LIKE ?", FeishuFeedbackUserPrefix+"%").
		Where("created_at >= ? AND created_at < ?", start, end).
		Order("created_at ASC, id ASC").Find(&rows).Error
	return rows, err
}
