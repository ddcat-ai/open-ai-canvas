package database

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestChannelCreditCostMigrationPreservesSalesAndUnknownHistoricalCosts(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`CREATE TABLE channel_model_price_tiers (id TEXT PRIMARY KEY, unit_price_microcredits INTEGER, deleted_at DATETIME)`,
		`CREATE TABLE billing_orders (id TEXT PRIMARY KEY, actual_amount_microcredits INTEGER)`,
		`INSERT INTO channel_model_price_tiers VALUES ('tier',900000,NULL)`,
		`INSERT INTO billing_orders VALUES ('order',13500000)`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := migrateChannelCreditCost(db); err != nil {
			t.Fatal(err)
		}
	}
	var tier model.ChannelModelPriceTier
	var order model.BillingOrder
	if err := db.First(&tier, "id = ?", "tier").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&order, "id = ?", "order").Error; err != nil {
		t.Fatal(err)
	}
	if tier.UnitPriceMicrocredits != 900000 || order.ActualAmountMicrocredits != 13500000 || tier.CostPricing.Configured || order.CostPricing.Configured || order.CostBillingMode != "" {
		t.Fatalf("migration changed history: %#v %#v", tier, order)
	}
	if err := db.Table("channel_model_price_tiers").Where("id = ?", "tier").Updates(map[string]any{"cost_configured": true, "cost_unit_price_microcredits": 123456}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&tier, "id = ?", "tier").Error; err != nil {
		t.Fatal(err)
	}
	if !tier.CostPricing.Configured || tier.CostPricing.UnitPriceMicrocredits != 123456 {
		t.Fatalf("cost columns not mapped: %#v", tier)
	}
}
