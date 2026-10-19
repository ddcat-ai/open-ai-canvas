package repository

import (
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func (r *Repository) UploadSession(userID, id string) (*model.UploadReservation, error) {
	var reservation model.UploadReservation
	if err := r.db.Where("user_id = ? AND id = ? AND expires_at > ?", userID, id, time.Now()).First(&reservation).Error; err != nil {
		return nil, err
	}
	return &reservation, nil
}

func (r *Repository) ClaimBrowserUploadCancellation(userID, id string) (bool, error) {
	claimed := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockUploadStorage(tx, userID); err != nil {
			return err
		}
		result := tx.Model(&model.Resource{}).Where("id = ? AND user_id = ? AND status = ?", id, userID, model.ResourceStatusPending).
			Updates(map[string]any{"status": model.ResourceStatusCanceling, "updated_at": time.Now()})
		claimed = result.RowsAffected == 1
		return result.Error
	})
	return claimed, err
}

func (r *Repository) FinishBrowserUploadCancellation(userID, id string, canceled bool) error {
	status, message := model.ResourceStatusPending, ""
	if canceled {
		status, message = model.ResourceStatusFailed, "浏览器直传未完成"
	}
	return r.db.Model(&model.Resource{}).Where("id = ? AND user_id = ? AND status = ?", id, userID, model.ResourceStatusCanceling).
		Updates(map[string]any{"status": status, "error": message, "updated_at": time.Now()}).Error
}
