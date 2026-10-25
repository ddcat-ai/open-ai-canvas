package database

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
)

func TestOfficialPricingMigrationPreservesExistingPrices(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"channel_model_price_tiers", "billing_orders"} {
		if err := db.Exec("CREATE TABLE " + table + " (id TEXT PRIMARY KEY, unit_price_microcredits INTEGER, cost_unit_price_microcredits INTEGER)").Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Exec("INSERT INTO " + table + " VALUES ('existing', 8000000, 5000000)").Error; err != nil {
			t.Fatal(err)
		}
	}
	found := false
	for _, migration := range schemaMigrations {
		if migration.name != "model_group_discounts" {
			continue
		}
		found = true
		for i := 0; i < 2; i++ {
			if err := migration.apply(db); err != nil {
				t.Fatal(err)
			}
		}
	}
	if !found {
		t.Fatal("missing migration")
	}
	for _, table := range []string{"channel_model_price_tiers", "billing_orders"} {
		var row struct {
			UnitPriceMicrocredits, CostUnitPriceMicrocredits, OfficialUnitPriceMicrocredits int64
			OfficialConfigured                                                              bool
		}
		if err := db.Table(table).Where("id = ?", "existing").Take(&row).Error; err != nil {
			t.Fatal(err)
		}
		if row.UnitPriceMicrocredits != 8000000 || row.CostUnitPriceMicrocredits != 5000000 || row.OfficialConfigured || row.OfficialUnitPriceMicrocredits != 0 {
			t.Fatalf("migration changed prices: %+v", row)
		}
	}
}
