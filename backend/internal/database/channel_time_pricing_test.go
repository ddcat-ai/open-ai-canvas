package database

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestMigrateSchemaV46AddsTimePricingWithoutChangingExistingPrices(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-time-pricing-v46?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.ChannelModelPriceTier{}, "time_pricing"); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version >= ?", 46).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO channel_model_price_tiers (id, channel_model_id, selector_key, selector_json, unit_price_microcredits, price_version) VALUES (?, ?, ?, ?, ?, ?)`, "existing", "model", "{}", "{}", 12345, 7).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var tier model.ChannelModelPriceTier
	if err := db.First(&tier, "id = ?", "existing").Error; err != nil {
		t.Fatal(err)
	}
	if tier.TimePricing != nil || tier.UnitPriceMicrocredits != 12345 || tier.PriceVersion != 7 {
		t.Fatalf("migration changed existing prices: %#v", tier)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("repeat migration: %v", err)
	}
}
