package repository

import (
	"time"

	"yingce/backend/internal/model"
)

// CreateLoginLog 插入一条登录日志。
func (r *Repository) CreateLoginLog(log *model.LoginLog) error {
	return r.db.Create(log).Error
}

// LoginLogsByUser 查询指定用户的登录日志，按时间倒序。
func (r *Repository) LoginLogsByUser(userID string, limit, offset int) ([]model.LoginLog, int64, error) {
	var logs []model.LoginLog
	var total int64
	q := r.db.Model(&model.LoginLog{}).Where("user_id = ?", userID)
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := q.Order("login_at DESC").Limit(limit).Offset(offset).Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	return logs, total, nil
}

// AllLoginLogs 查询全部登录日志，支持按用户名/状态/方式筛选，按时间倒序。
func (r *Repository) AllLoginLogs(keyword, status, method string, limit, offset int) ([]model.LoginLog, int64, error) {
	var logs []model.LoginLog
	var total int64
	q := r.db.Model(&model.LoginLog{})
	if keyword != "" {
		q = q.Where("username LIKE ?", "%"+keyword+"%")
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if method != "" {
		q = q.Where("method = ?", method)
	}
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := q.Order("login_at DESC").Limit(limit).Offset(offset).Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	return logs, total, nil
}

// UpdateLoginLogLogout 根据 session ID 回填登出时间。
func (r *Repository) UpdateLoginLogLogout(sessionID string, logoutAt time.Time) error {
	return r.db.Model(&model.LoginLog{}).Where("session_id = ?", sessionID).Update("logout_at", logoutAt).Error
}

// DeleteLoginLogsBefore 删除指定时间之前的登录日志，用于自动清理。
func (r *Repository) DeleteLoginLogsBefore(before time.Time) (int64, error) {
	result := r.db.Where("login_at < ?", before).Delete(&model.LoginLog{})
	return result.RowsAffected, result.Error
}
