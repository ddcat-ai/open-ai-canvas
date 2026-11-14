package database

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"testing"
	"yingce/backend/internal/model"
)

func TestImageBillingMigrationAddsOnlyNewColumns(t *testing.T) {
	db, err := gorm.Open(sqlite.New(sqlite.Config{DriverName: "sqlite", DSN: "file:image-billing-migration?mode=memory&cache=shared"}), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	for _, query := range []string{"CREATE TABLE channel_model_price_tiers (id TEXT PRIMARY KEY)", "CREATE TABLE billing_orders (id TEXT PRIMARY KEY, amount_microcredits INTEGER)", "CREATE TABLE logical_models (id TEXT PRIMARY KEY)", "INSERT INTO billing_orders (id, amount_microcredits) VALUES ('old', 123)"} {
		if err := db.Exec(query).Error; err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := migrateImageUsageBilling(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, column := range []string{"image_pricing", "cost_image_pricing", "image_usage", "image_input_images", "image_max_output_images"} {
		if !db.Migrator().HasColumn(&model.BillingOrder{}, column) {
			t.Fatalf("missing column %s", column)
		}
	}
	var result struct {
		Amount  int64
		Inputs  int64
		Pricing *string
	}
	if err := db.Raw("SELECT amount_microcredits AS amount, image_input_images AS inputs, image_pricing AS pricing FROM billing_orders WHERE id = 'old'").Scan(&result).Error; err != nil {
		t.Fatal(err)
	}
	if result.Amount != 123 || result.Inputs != 0 || result.Pricing != nil {
		t.Fatalf("historical order changed: %#v", result)
	}
}
