package repository

import (
	"errors"
	"reflect"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func (r *Repository) SaveClientFailures(userID string, events []model.ClientFailure) ([]string, error) {
	accepted := []string{}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// Serialize quota admission across instances for this user.
		if err := tx.Model(&model.User{}).Where("id = ?", userID).UpdateColumn("id", gorm.Expr("id")).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND created_at < ?", userID, time.Now().Add(-14*24*time.Hour)).Delete(&model.ClientFailure{}).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&model.ClientFailure{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
			return err
		}
		for _, event := range events {
			var previous model.ClientFailure
			err := tx.First(&previous, "user_id = ? AND event_id = ?", userID, event.EventID).Error
			if err == nil {
				if !previous.OccurredAt.Equal(event.OccurredAt) {
					return ErrCreationConflict
				}
				previous.OccurredAt = event.OccurredAt
				previous.CreatedAt = time.Time{}
				candidate := event
				candidate.CreatedAt = time.Time{}
				if !reflect.DeepEqual(previous, candidate) {
					return ErrCreationConflict
				}
				accepted = append(accepted, event.EventID)
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if count >= 2000 {
				continue
			}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&event).Error; err != nil {
				return err
			}
			count++
			accepted = append(accepted, event.EventID)
		}
		return nil
	})
	return accepted, err
}

func (r *Repository) ClientFailures(userID, runID string) ([]model.ClientFailure, error) {
	q := r.db.Where("created_at >= ?", time.Now().Add(-14*24*time.Hour))
	if userID != "" {
		q = q.Where("user_id = ?", userID)
	}
	if runID != "" {
		q = q.Where("run_id = ?", runID)
	}
	var events []model.ClientFailure
	err := q.Order("created_at DESC").Limit(200).Find(&events).Error
	return events, err
}

func (r *Repository) PurgeClientFailures(before time.Time) error {
	return r.db.Where("created_at < ?", before).Delete(&model.ClientFailure{}).Error
}
