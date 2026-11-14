package database

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func migrateImageUsageBilling(tx *gorm.DB) error {
	for _, change := range []struct {
		entity  any
		columns []string
	}{
		{&model.ChannelModelPriceTier{}, []string{"image_pricing", "cost_image_pricing"}},
		{&model.BillingOrder{}, []string{"image_pricing", "cost_image_pricing", "image_usage", "image_input_images", "image_max_output_images"}},
		{&model.LogicalModel{}, []string{"image_pricing"}},
	} {
		if !tx.Migrator().HasTable(change.entity) {
			continue
		}
		for _, column := range change.columns {
			if !tx.Migrator().HasColumn(change.entity, column) {
				if err := tx.Migrator().AddColumn(change.entity, column); err != nil {
					return err
				}
			}
		}
	}
	return nil
}
