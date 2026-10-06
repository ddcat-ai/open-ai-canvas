package database

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
)

func migrateSkillCurationRoots(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.SkillCurationRoot{}, &model.SkillCurationRootAssignment{}); err != nil {
		return err
	}
	roots := model.DefaultSkillCurationRoots()
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&roots).Error
}
