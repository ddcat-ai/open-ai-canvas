package repository

import (
	"errors"
	"time"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type LoginLogFilter struct {
	Keyword string
	Event   string
	Method  string
	Result  string
	IP      string
	From    *time.Time
	To      *time.Time
}

func (r *Repository) AppendLoginLog(event *model.LoginLog) error { return r.db.Create(event).Error }

func (r *Repository) LoginLogs(filter LoginLogFilter, limit, offset int) ([]model.LoginLog, int64, error) {
	query := r.db.Model(&model.LoginLog{})
	if filter.Keyword != "" {
		term := "%" + filter.Keyword + "%"
		query = query.Where("lower(username) LIKE lower(?) OR lower(display_name) LIKE lower(?) OR lower(account) LIKE lower(?) OR user_id = ?", term, term, term, filter.Keyword)
	}
	if filter.Event != "" {
		query = query.Where("event = ?", filter.Event)
	}
	if filter.Method != "" {
		query = query.Where("method = ?", filter.Method)
	}
	if filter.Result != "" {
		query = query.Where("result = ?", filter.Result)
	}
	if filter.IP != "" {
		query = query.Where("ip = ?", filter.IP)
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
	logs := make([]model.LoginLog, 0)
	err := query.Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&logs).Error
	return logs, total, err
}

func (r *Repository) LoginLog(id string) (*model.LoginLog, error) {
	var event model.LoginLog
	if err := r.db.First(&event, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &event, nil
}

// 凭据校验、撤销和日志提交在同一事务中；只有真正撤销的有效会话写成功事件。
func (r *Repository) RevokeAuthSessionWithLog(sessionID, tokenHash string, event *model.LoginLog) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// SQLite 先取得写锁，避免并发退出在读快照后升级写锁时互相冲突。
		if tx.Dialector.Name() == "sqlite" {
			if err := tx.Model(&model.AuthSession{}).Where("id = ? AND token_hash = ?", sessionID, tokenHash).UpdateColumn("updated_at", gorm.Expr("updated_at")).Error; err != nil {
				return err
			}
		}
		var session model.AuthSession
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&session, "id = ? AND token_hash = ?", sessionID, tokenHash).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		// 既有 SQLite 会话可能保存不同时区的时间字符串，不能按 SQL 字符串比较有效期。
		if !session.ExpiresAt.After(time.Now()) {
			return nil
		}
		var user model.User
		if err := tx.First(&user, "id = ?", session.UserID).Error; err != nil {
			return err
		}
		event.UserID = &user.ID
		event.Username, event.DisplayName, event.Account = user.Username, user.DisplayName, user.Username
		var login model.LoginLog
		err = tx.Where("session_ref = ? AND event = ? AND result = ?", event.SessionRef, "login", "success").First(&login).Error
		if err == nil {
			event.Method = login.Method
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		deleted := tx.Where("id = ? AND token_hash = ? AND expires_at = ?", session.ID, tokenHash, session.ExpiresAt).Delete(&model.AuthSession{})
		if deleted.Error != nil {
			return deleted.Error
		}
		if deleted.RowsAffected == 0 {
			return nil
		}
		return tx.Create(event).Error
	})
}
