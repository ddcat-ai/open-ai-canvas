package repository

import (
	"errors"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *Repository) BuiltinSkillTombstoned(skillID string) (bool, error) {
	var count int64
	if err := r.db.Model(&model.BuiltinSkillTombstone{}).Where("skill_id = ?", skillID).Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

func (r *Repository) DeleteBuiltinSkill(skillID string, actorID string) error {
	now := time.Now().UTC()
	return r.db.Transaction(func(tx *gorm.DB) error {
		var locked model.Skill
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ?", skillID).Error; err != nil {
			return err
		}
		if err := tx.Delete(&model.SkillCurationAssignment{}, "skill_id = ?", skillID).Error; err != nil {
			return err
		}
		if err := tx.Delete(&model.SkillCurationRootAssignment{}, "skill_id = ?", skillID).Error; err != nil {
			return err
		}
		if err := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "skill_id"}}, DoUpdates: clause.AssignmentColumns([]string{"deleted_by", "deleted_at"})}).Create(&model.BuiltinSkillTombstone{SkillID: skillID, DeletedBy: actorID, DeletedAt: now}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&model.UserSkillState{}, "skill_id = ?", skillID).Error; err != nil {
			return err
		}
		var versions []model.SkillVersion
		if err := tx.Where("skill_id = ?", skillID).Find(&versions).Error; err != nil {
			return err
		}
		versionIDs := make([]string, 0, len(versions))
		for _, version := range versions {
			versionIDs = append(versionIDs, version.ID)
		}
		if len(versionIDs) > 0 {
			if err := tx.Delete(&model.SkillFile{}, "skill_version_id IN ?", versionIDs).Error; err != nil {
				return err
			}
		}
		if err := tx.Delete(&model.SkillVersion{}, "skill_id = ?", skillID).Error; err != nil {
			return err
		}
		result := tx.Delete(&model.Skill{}, "id = ?", skillID)
		if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return result.Error
		}
		return nil
	})
}
