package repository

import (
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) UserAgentMemoryRevisions(userID string, limit int) ([]model.AgentMemoryRevision, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	var rows []model.AgentMemoryRevision
	err := r.db.Where("user_id = ?", userID).Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *Repository) AgentMemoryRevisionForUser(userID, id string) (*model.AgentMemoryRevision, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(id) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var row model.AgentMemoryRevision
	err := r.db.Where("user_id = ? AND id = ?", userID, id).First(&row).Error
	return &row, err
}

func (r *Repository) RestoreAgentMemoryRevision(userID, id string, version int64, now time.Time) error {
	if strings.TrimSpace(userID) == "" || id == "" || version <= 0 {
		return gorm.ErrRecordNotFound
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var revision model.AgentMemoryRevision
		if err := tx.Where("id = ? AND user_id = ?", id, userID).First(&revision).Error; err != nil {
			return err
		}
		result := tx.Model(&model.AgentMemoryRevision{}).
			Where("id = ? AND user_id = ? AND version = ? AND restored_at IS NULL", id, userID, version).
			Updates(map[string]any{"restored_at": now, "version": version + 1})
		if err := memorySingleWrite(result); err != nil {
			return err
		}
		before, err := decodeAgentMemorySnapshots(revision.BeforeJSON)
		if err != nil {
			return err
		}
		after, err := decodeAgentMemorySnapshots(revision.AfterJSON)
		if err != nil {
			return err
		}
		if len(before) == 0 || len(after) == 0 || len(before) > 80 {
			return ErrCreationConflict
		}
		current, err := lockedMemorySnapshots(tx, userID, snapshotIDs(after))
		if err != nil {
			return err
		}
		if !sameMemorySnapshots(after, current) {
			return ErrCreationConflict
		}
		afterByID := make(map[string]model.AgentMemorySnapshot, len(after))
		for _, snapshot := range after {
			afterByID[snapshot.ID] = snapshot
		}
		seen := map[string]bool{}
		for _, snapshot := range before {
			if snapshot.ID == "" || seen[snapshot.ID] {
				return ErrCreationConflict
			}
			seen[snapshot.ID] = true
			if expected, exists := afterByID[snapshot.ID]; exists {
				result := memorySnapshotQuery(tx, userID, expected).Updates(map[string]any{
					"topic": snapshot.Topic, "category": snapshot.Category,
					"situation": snapshot.Situation, "lesson": snapshot.Lesson,
					"source": snapshot.Source, "steps_json": snapshot.StepsJSON,
					"status": snapshot.Status, "last_verified_at": snapshot.LastVerifiedAt,
					"updated_at": now,
				})
				if err := memorySingleWrite(result); err != nil {
					return err
				}
				continue
			}
			// Deleted IDs must remain absent, even if the same ID was recreated by
			// someone else. Never upsert or overwrite during restoration.
			var count int64
			if err := tx.Model(&model.AgentLesson{}).Where("id = ?", snapshot.ID).Count(&count).Error; err != nil {
				return err
			}
			if count != 0 {
				return ErrCreationConflict
			}
			lesson := snapshot.LessonForUser(userID)
			lesson.UpdatedAt = now
			if err := tx.Create(&lesson).Error; err != nil {
				return err
			}
		}
		return tx.Model(&model.AgentMemorySetting{}).Where("user_id = ? AND compact_proposal_id = ?", userID, revision.ProposalID).
			Updates(map[string]any{"last_status": model.AgentMemoryCompactStatusRestored, "updated_at": now}).Error
	})
}
