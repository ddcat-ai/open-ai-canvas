package database

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func migrateModelGroupDiscounts(tx *gorm.DB) error {
	for _, entity := range []any{&model.ChannelModelPriceTier{}, &model.BillingOrder{}} {
		for _, column := range []string{"official_configured", "official_unit_price_microcredits", "official_input_token_price_microcredits", "official_output_token_price_microcredits", "official_cached_token_price_microcredits"} {
			if !tx.Migrator().HasColumn(entity, column) {
				if err := tx.Migrator().AddColumn(entity, column); err != nil {
					return err
				}
			}
		}
	}
	for _, column := range []string{"BillingGroupID", "BillingGroupName", "BillingGroupVersion", "BillingMemberVersion", "MultiplierSource"} {
		if !tx.Migrator().HasColumn(&model.BillingOrder{}, column) {
			if err := tx.Migrator().AddColumn(&model.BillingOrder{}, column); err != nil {
				return err
			}
		}
	}
	return tx.AutoMigrate(&model.UserGroupRates{})
}
