package repository

import (
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
	"time"
)

var ErrNotificationLimit = errors.New("notification limit reached")
var ErrVerificationInvalid = errors.New("verification expired, changed or consumed")
var ErrChannelConflict = errors.New("sms channel changed")

func (r *Repository) AttemptLegacyEmailVerification(id string) error {
	result := r.db.Model(&model.EmailVerificationCode{}).Where("id = ? AND attempts < 5 AND used_at IS NULL AND expires_at > ?", id, time.Now()).Update("attempts", gorm.Expr("attempts + 1"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrVerificationInvalid
	}
	return nil
}

type NotificationLimit struct {
	Key       string
	Limit     int
	Cooldown  time.Duration
	ExpiresAt time.Time
}

func reserveNotificationLimits(tx *gorm.DB, limits []NotificationLimit, now time.Time) error {
	for _, limit := range limits {
		row := model.NotificationQuota{Key: limit.Key, NextAt: now, ExpiresAt: limit.ExpiresAt}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return err
		}
		result := tx.Model(&model.NotificationQuota{}).Where("key = ? AND count < ? AND next_at <= ?", limit.Key, limit.Limit, now).
			Updates(map[string]any{"count": gorm.Expr("count + 1"), "next_at": now.Add(limit.Cooldown)})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrNotificationLimit
		}
	}
	return nil
}

func (r *Repository) ReserveNotificationLimits(limits []NotificationLimit, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error { return reserveNotificationLimits(tx, limits, now) })
}

func (r *Repository) CreateAuthVerification(v *model.AuthVerification, limits []NotificationLimit) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// These rows contain contact data; retain only the short-lived verification window.
		if err := tx.Where("expires_at < ?", time.Now()).Delete(&model.AuthVerification{}).Error; err != nil {
			return err
		}
		if err := tx.Where("expires_at < ?", time.Now()).Delete(&model.NotificationQuota{}).Error; err != nil {
			return err
		}
		if err := reserveNotificationLimits(tx, limits, v.CreatedAt); err != nil {
			return err
		}
		return tx.Create(v).Error
	})
}
func (r *Repository) AuthVerification(id string) (*model.AuthVerification, error) {
	var v model.AuthVerification
	err := r.db.First(&v, "id = ?", id).Error
	return &v, err
}
func (r *Repository) SetAuthVerificationReady(id string) error {
	return r.db.Model(&model.AuthVerification{}).Where("id = ?", id).Update("ready", true).Error
}
func (r *Repository) AttemptAuthVerification(id string, now time.Time) error {
	result := r.db.Model(&model.AuthVerification{}).Where("id = ? AND ready = ? AND used_at IS NULL AND expires_at > ? AND attempts < 5", id, true, now).Update("attempts", gorm.Expr("attempts + 1"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrVerificationInvalid
	}
	return nil
}
func consumeVerification(tx *gorm.DB, id string, now time.Time) error {
	result := tx.Model(&model.AuthVerification{}).Where("id = ? AND ready = ? AND used_at IS NULL AND expires_at > ? AND attempts <= 5", id, true, now).Update("used_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrVerificationInvalid
	}
	return nil
}
func (r *Repository) CreateUserWithVerification(user *model.User, id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := consumeVerification(tx, id, time.Now()); err != nil {
			return err
		}
		return tx.Create(user).Error
	})
}
func (r *Repository) CompleteAuthVerification(v *model.AuthVerification, bind bool) (*model.User, error) {
	var user model.User
	err := r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now()
		if err := consumeVerification(tx, v.ID, now); err != nil {
			return err
		}
		query := tx.Model(&model.User{}).Where("id = ? AND status = ?", v.UserID, model.UserStatusActive)
		updates := map[string]any{"updated_at": now}
		if bind {
			if v.Email != "" {
				updates["email"], updates["email_verified_at"] = v.Email, now
			}
			if v.Phone != "" {
				updates["phone"], updates["phone_verified_at"] = v.Phone, now
			}
		} else {
			if v.Email != "" {
				query = query.Where("email = ? AND email_verified_at IS NOT NULL", v.Email)
			}
			if v.Phone != "" {
				query = query.Where("phone = ? AND phone_verified_at IS NOT NULL", v.Phone)
			}
			updates["last_login_at"] = now
		}
		result := query.Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrVerificationInvalid
		}
		return tx.First(&user, "id = ?", v.UserID).Error
	})
	return &user, err
}
func (r *Repository) UserByPhone(phone string) (*model.User, error) {
	var u model.User
	err := r.db.First(&u, "phone = ?", phone).Error
	return &u, err
}

func (r *Repository) SMSChannels() ([]model.SMSChannel, error) {
	var rows []model.SMSChannel
	err := r.db.Order("priority ASC, id ASC").Find(&rows).Error
	return rows, err
}
func (r *Repository) SMSChannel(id string) (*model.SMSChannel, error) {
	var row model.SMSChannel
	err := r.db.First(&row, "id = ?", id).Error
	return &row, err
}
func (r *Repository) SaveSMSChannel(row *model.SMSChannel, create bool) error {
	if create {
		return r.db.Create(row).Error
	}
	version := row.Version
	row.Version++
	result := r.db.Model(&model.SMSChannel{}).Where("id = ? AND version = ?", row.ID, version).Select("Name", "Provider", "Enabled", "Priority", "DailyLimit", "SignName", "AppID", "Credentials", "TemplatesJSON", "Version", "UpdatedAt").Updates(row)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrChannelConflict
	}
	return nil
}
func (r *Repository) DeleteSMSChannel(id string) error {
	return r.db.Where("id = ?", id).Delete(&model.SMSChannel{}).Error
}
func (r *Repository) SMSRecords(channel, state string, page, size int) ([]model.SMSRecord, int64, error) {
	q := r.db.Model(&model.SMSRecord{})
	if channel != "" {
		q = q.Where("channel_id = ?", channel)
	}
	if state != "" {
		q = q.Where("state = ?", state)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.SMSRecord
	err := q.Order("created_at DESC, id DESC").Offset((page - 1) * size).Limit(size).Find(&rows).Error
	return rows, count, err
}
