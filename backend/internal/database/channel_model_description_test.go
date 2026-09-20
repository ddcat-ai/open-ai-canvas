package database

import "testing"

func TestChannelModelDescriptionMigration(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`CREATE TABLE channel_models (id TEXT PRIMARY KEY, model_key TEXT, channel_label TEXT, unit_price_microcredits INTEGER)`,
		`INSERT INTO channel_models VALUES ('model-a', 'seedance-2.0', '优惠渠道-993', 300000)`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := migrateChannelModelDescription(db); err != nil {
			t.Fatal(err)
		}
	}
	var row struct {
		ModelKey, ChannelLabel, Description string
		UnitPriceMicrocredits               int64
	}
	if err := db.Table("channel_models").Where("id = ?", "model-a").First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.ModelKey != "seedance-2.0" || row.ChannelLabel != "优惠渠道-993" || row.UnitPriceMicrocredits != 300000 || row.Description != "" {
		t.Fatalf("migration changed existing data: %#v", row)
	}
	if err := db.Exec(`INSERT INTO channel_models (id) VALUES ('model-b')`).Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Table("channel_models").Where("description = ''").Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("description default missing: count=%d err=%v", count, err)
	}
}
