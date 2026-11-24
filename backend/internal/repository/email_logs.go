package repository

import (
	"time"

	"yingce/backend/internal/model"
)

type EmailLogFilter struct {
	Keyword string
	Purpose string
	Status  string
	From    *time.Time
	To      *time.Time
}

func (r *Repository) AppendEmailLog(entry *model.EmailLog) error { return r.db.Create(entry).Error }

func (r *Repository) EmailLogs(filter EmailLogFilter, limit, offset int) ([]model.EmailLog, int64, error) {
	query := r.db.Model(&model.EmailLog{})
	if filter.Keyword != "" {
		term := "%" + filter.Keyword + "%"
		query = query.Where("lower(recipient) LIKE lower(?) OR lower(subject) LIKE lower(?) OR user_id = ?", term, term, filter.Keyword)
	}
	if filter.Purpose != "" {
		query = query.Where("purpose = ?", filter.Purpose)
	}
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.From != nil {
		query = query.Where("created_at >= ?", filter.From.UTC())
	}
	if filter.To != nil {
		query = query.Where("created_at <= ?", filter.To.UTC())
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	logs := make([]model.EmailLog, 0)
	err := query.Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&logs).Error
	return logs, total, err
}

// EmailLogStats 汇总时间窗口内各状态的数量，供后台概览。
func (r *Repository) EmailLogStats(since time.Time) (map[string]int64, error) {
	var rows []struct {
		Status string
		Count  int64
	}
	if err := r.db.Model(&model.EmailLog{}).Select("status, count(*) AS count").Where("created_at >= ?", since.UTC()).Group("status").Scan(&rows).Error; err != nil {
		return nil, err
	}
	result := map[string]int64{}
	for _, row := range rows {
		result[row.Status] = row.Count
	}
	return result, nil
}

func (r *Repository) DeleteEmailLogsBefore(before time.Time) (int64, error) {
	result := r.db.Where("created_at < ?", before.UTC()).Delete(&model.EmailLog{})
	return result.RowsAffected, result.Error
}
