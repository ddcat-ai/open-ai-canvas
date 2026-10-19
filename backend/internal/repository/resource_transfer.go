package repository

import (
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func (r *Repository) CreateResourceTransfer(resource *model.Resource, transfer *model.ResourceTransfer) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(resource).Error; err != nil {
			return err
		}
		return tx.Create(transfer).Error
	})
}

func (r *Repository) ResourceTransfer(userID, id string) (*model.ResourceTransfer, error) {
	var transfer model.ResourceTransfer
	err := r.db.Where("resource_id = ? AND user_id = ?", id, userID).First(&transfer).Error
	return &transfer, err
}

// ClaimResourceTransfer serializes browser and server saves without holding a DB lock during network I/O.
func (r *Repository) ClaimResourceTransfer(userID, id, owner string, until time.Time, uploadJSON string) (bool, error) {
	now := time.Now()
	result := r.db.Model(&model.ResourceTransfer{}).
		Where("resource_id = ? AND user_id = ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)", id, userID, now).
		Updates(map[string]any{"lease_owner": owner, "lease_expires_at": until, "upload_json": uploadJSON, "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) DueResourceTransfers(limit int) ([]model.ResourceTransfer, error) {
	var transfers []model.ResourceTransfer
	now := time.Now()
	err := r.db.Where("next_attempt_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)", now, now).
		Order("next_attempt_at asc").Limit(limit).Find(&transfers).Error
	return transfers, err
}

func (r *Repository) RetryResourceTransfer(id, owner, message string, next time.Time) error {
	query := r.db.Model(&model.ResourceTransfer{}).Where("resource_id = ?", id)
	query = query.Where("lease_owner = ?", owner)
	return query.Updates(map[string]any{"lease_owner": "", "lease_expires_at": nil, "last_error": message,
		"attempts": gorm.Expr("attempts + 1"), "next_attempt_at": next, "updated_at": time.Now()}).Error
}

func (r *Repository) PublishResourceTransfer(resource *model.Resource, owner, reservationID string, storedLimit, dailyLimit int64) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockUploadStorage(tx, resource.UserID); err != nil {
			return err
		}
		claim := tx.Where("resource_id = ? AND user_id = ? AND lease_owner = ? AND lease_expires_at > ?", resource.ID, resource.UserID, owner, time.Now()).Delete(&model.ResourceTransfer{})
		if claim.Error != nil {
			return claim.Error
		}
		if claim.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		_, objectID, _ := strings.Cut(owner, ":")
		if err := tx.Delete(&model.ResourceDeletionJob{}, "id = ?", objectID).Error; err != nil {
			return err
		}
		var current model.Resource
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ? AND status = ? AND transfer_pending = ?", resource.ID, resource.UserID, model.ResourceStatusReady, true).First(&current).Error; err != nil {
			return err
		}
		resource.TransferPending = false
		return New(tx).SaveResourceWithinStorageLimit(resource, storedLimit, dailyLimit, reservationID)
	})
}

func (r *Repository) TrackResourceTransferObject(resource *model.Resource, owner string, cleanupAt time.Time) error {
	_, objectID, _ := strings.Cut(owner, ":")
	return r.db.Create(&model.ResourceDeletionJob{ID: objectID, UserID: resource.UserID, ResourceID: resource.ID,
		Provider: resource.Provider, Endpoint: resource.Endpoint, Bucket: resource.Bucket, StorageSettingID: resource.StorageSettingID,
		ObjectKey: resource.ObjectKey, Status: model.ResourceDeletionStatusPending, NextAttemptAt: cleanupAt}).Error
}

func (r *Repository) RemoveResourceTransfer(id, owner string) error {
	return r.db.Where("resource_id = ? AND lease_owner = ?", id, owner).Delete(&model.ResourceTransfer{}).Error
}

func (r *Repository) PublishBrowserThumbnail(userID, id, uploadID, mimeType string, size int64, width, height int, storedLimit, dailyLimit int64) (*model.Resource, error) {
	var resource model.Resource
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockUploadStorage(tx, userID); err != nil {
			return err
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ? AND status = ? AND transfer_pending = ?", id, userID, model.ResourceStatusReady, false).First(&resource).Error; err != nil {
			return err
		}
		if resource.ThumbnailStatus == "ready" {
			return New(tx).ReleaseUploadSession(userID, uploadID)
		}
		resource.ThumbnailStatus, resource.ThumbnailMimeType, resource.ThumbnailSize = "ready", mimeType, size
		resource.ThumbnailWidth, resource.ThumbnailHeight, resource.UpdatedAt = width, height, time.Now()
		// The reservation accounts for thumbnail bytes, not the original's size.
		var reservation model.UploadReservation
		if err := tx.Where("id = ? AND user_id = ? AND size = ? AND expires_at > ?", uploadID, userID, size, time.Now()).First(&reservation).Error; err != nil {
			return err
		}
		day := time.Now().UTC().Format("2006-01-02")
		if reservation.Day != day {
			if err := New(tx).ReserveDailyUpload(userID, day, size, dailyLimit); err != nil {
				return err
			}
			if err := New(tx).ReleaseDailyUpload(userID, reservation.Day, size); err != nil {
				return err
			}
		}
		if err := tx.Delete(&reservation).Error; err != nil {
			return err
		}
		return New(tx).SaveResourceWithinStorageLimit(&resource, storedLimit, dailyLimit, "")
	})
	return &resource, err
}
