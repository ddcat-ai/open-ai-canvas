package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

var ErrUploadStorageLimit = errors.New("账号存储容量不足")
var ErrUploadSessionLimit = errors.New("同时进行中的上传过多，请稍后重试")
var ErrUploadReservationExpired = errors.New("上传会话不存在或已过期，请重新导入")

func lockUploadStorage(tx *gorm.DB, userID string) error {
	switch tx.Dialector.Name() {
	case "postgres":
		return tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?)::bigint)", "upload-storage:"+userID).Error
	case "sqlite":
		return tx.Exec("UPDATE upload_reservations SET size = size WHERE 1 = 0").Error
	default:
		return gorm.ErrInvalidData
	}
}

func (r *Repository) ReserveUploadSession(reservation *model.UploadReservation, dailyLimit, storedLimit int64, sessionLimit int) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockUploadStorage(tx, reservation.UserID); err != nil {
			return err
		}
		repo := New(tx)
		now := time.Now()
		if !reservation.ExpiresAt.After(now) {
			return ErrUploadReservationExpired
		}
		reservation.Day = now.UTC().Format("2006-01-02")
		var expired []model.UploadReservation
		if err := tx.Where("user_id = ? AND expires_at <= ?", reservation.UserID, now).Find(&expired).Error; err != nil {
			return err
		}
		for _, old := range expired {
			if err := repo.ReleaseDailyUpload(old.UserID, old.Day, old.Size); err != nil {
				return err
			}
			if err := tx.Delete(&old).Error; err != nil {
				return err
			}
		}
		var active int64
		if err := tx.Model(&model.UploadReservation{}).Where("user_id = ?", reservation.UserID).Count(&active).Error; err != nil {
			return err
		}
		if active >= int64(sessionLimit) {
			return ErrUploadSessionLimit
		}
		stored, err := repo.UserStoredFileBytes(reservation.UserID)
		if err != nil {
			return err
		}
		var pending int64
		if err := tx.Model(&model.UploadReservation{}).Select("COALESCE(SUM(size),0)").Where("user_id = ?", reservation.UserID).Scan(&pending).Error; err != nil {
			return err
		}
		if reservation.Size <= 0 || stored >= storedLimit || pending >= storedLimit-stored || reservation.Size >= storedLimit-stored-pending {
			return ErrUploadStorageLimit
		}
		if err := repo.ReserveDailyUpload(reservation.UserID, reservation.Day, reservation.Size, dailyLimit); err != nil {
			return err
		}
		return tx.Create(reservation).Error
	})
}

func (r *Repository) ReleaseUploadSession(userID, id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockUploadStorage(tx, userID); err != nil {
			return err
		}
		var reservation model.UploadReservation
		if err := tx.Where("id = ? AND user_id = ?", id, userID).First(&reservation).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if err := New(tx).ReleaseDailyUpload(userID, reservation.Day, reservation.Size); err != nil {
			return err
		}
		return tx.Delete(&reservation).Error
	})
}

// SaveResourceWithinStorageLimit publishes ready bytes and consumes the session
// reservation under the same database lock used by admission on every instance.
func (r *Repository) SaveResourceWithinStorageLimit(resource *model.Resource, limit, dailyLimit int64, reservationID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockUploadStorage(tx, resource.UserID); err != nil {
			return err
		}
		now := time.Now()
		if reservationID != "" {
			var reservation model.UploadReservation
			if err := tx.Where("id = ? AND user_id = ? AND size = ? AND expires_at > ?", reservationID, resource.UserID, resource.Size, now).First(&reservation).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrUploadReservationExpired
				}
				return err
			}
			day := now.UTC().Format("2006-01-02")
			if reservation.Day != day {
				repo := New(tx)
				if err := repo.ReserveDailyUpload(resource.UserID, day, reservation.Size, dailyLimit); err != nil {
					return err
				}
				if err := repo.ReleaseDailyUpload(resource.UserID, reservation.Day, reservation.Size); err != nil {
					return err
				}
			}
		}
		// Save inside the transaction so physical-object deduplication uses the
		// existing usage query; rollback leaves the resource non-ready on denial.
		if err := tx.Save(resource).Error; err != nil {
			return err
		}
		stored, err := New(tx).UserStoredFileBytes(resource.UserID)
		if err != nil {
			return err
		}
		var pending int64
		if err := tx.Model(&model.UploadReservation{}).Select("COALESCE(SUM(size),0)").Where("user_id = ? AND id <> ? AND expires_at > ?", resource.UserID, reservationID, now).Scan(&pending).Error; err != nil {
			return err
		}
		if stored >= limit || pending >= limit-stored {
			return ErrUploadStorageLimit
		}
		if reservationID != "" {
			return tx.Delete(&model.UploadReservation{}, "id = ? AND user_id = ?", reservationID, resource.UserID).Error
		}
		return nil
	})
}
