package database

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func migrateMembershipCards(tx *gorm.DB) error {
	for _, entry := range []struct {
		table  any
		fields []string
	}{
		{&model.User{}, []string{"MembershipUntil"}},
		{&model.TopupProduct{}, []string{"MembershipDays", "MembershipGroup"}},
		{&model.PaymentOrder{}, []string{"MembershipDays", "MembershipGroup", "MembershipStartsAt", "MembershipEndsAt"}},
	} {
		for _, field := range entry.fields {
			if !tx.Migrator().HasColumn(entry.table, field) {
				if err := tx.Migrator().AddColumn(entry.table, field); err != nil {
					return err
				}
			}
		}
	}
	if !tx.Migrator().HasIndex(&model.PaymentOrder{}, "MembershipEndsAt") {
		return tx.Migrator().CreateIndex(&model.PaymentOrder{}, "MembershipEndsAt")
	}
	return nil
}
