package database

import (
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func migrateDramaCastStylesImport(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.DramaCast{}) {
		return nil
	}
	for _, field := range []string{"ImageStyleID", "ImageStyleName", "ImageStylePrompt", "SourceProjectID", "SourceCastID"} {
		if !tx.Migrator().HasColumn(&model.DramaCast{}, field) {
			if err := tx.Migrator().AddColumn(&model.DramaCast{}, field); err != nil {
				return err
			}
		}
	}
	for _, column := range []string{"image_style_id", "image_style_name", "image_style_prompt", "source_project_id", "source_cast_id"} {
		if err := tx.Model(&model.DramaCast{}).Where(column+" IS NULL").UpdateColumn(column, "").Error; err != nil {
			return err
		}
	}
	if !tx.Migrator().HasIndex(&model.DramaCast{}, "idx_drama_cast_source") {
		return tx.Migrator().CreateIndex(&model.DramaCast{}, "idx_drama_cast_source")
	}
	return nil
}
