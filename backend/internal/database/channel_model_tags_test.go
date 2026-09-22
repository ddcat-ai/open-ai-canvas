package database

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestChannelModelTagsMigration(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE channel_models (id TEXT PRIMARY KEY, model_key TEXT, unit_price_microcredits INTEGER)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO channel_models VALUES ('a', 'test', 300000)`).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := migrateChannelModelTags(db); err != nil {
			t.Fatal(err)
		}
	}
	var row struct {
		ModelKey              string
		Tags                  string
		UnitPriceMicrocredits int64
	}
	if err := db.Table("channel_models").Where("id = ?", "a").First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Tags != "[]" || row.ModelKey != "test" || row.UnitPriceMicrocredits != 300000 {
		t.Fatalf("migration changed data: %#v", row)
	}
	if !db.Migrator().HasColumn(&model.ChannelModel{}, "Tags") {
		t.Fatal("tags column missing")
	}
}
