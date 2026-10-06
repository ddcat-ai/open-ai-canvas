package database

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
)

func migrateSkillCuration(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.SkillCurationSetting{}, &model.SkillCurationCategory{}, &model.SkillCurationAssignment{}); err != nil {
		return err
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.SkillCurationSetting{ID: 1}).Error
}
