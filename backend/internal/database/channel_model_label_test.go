package database

import "testing"

func TestChannelModelLabelMigrationPreservesIdentityAndPricing(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`CREATE TABLE channel_models (id TEXT PRIMARY KEY, channel_id TEXT, model_key TEXT, provider_model_key TEXT, price_version INTEGER, unit_price_microcredits INTEGER)`,
		`INSERT INTO channel_models VALUES ('model-a', 'channel-a', 'seedance-2.0', 'upstream-v2', 7, 300000)`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := migrateChannelModelLabel(db); err != nil {
			t.Fatal(err)
		}
	}
	var row struct {
		ID, ChannelID, ModelKey, ProviderModelKey, ChannelLabel string
		PriceVersion, UnitPriceMicrocredits                     int64
	}
	if err := db.Table("channel_models").First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.ID != "model-a" || row.ChannelID != "channel-a" || row.ModelKey != "seedance-2.0" || row.ProviderModelKey != "upstream-v2" || row.ChannelLabel != "" || row.PriceVersion != 7 || row.UnitPriceMicrocredits != 300000 {
		t.Fatalf("migration changed existing identity/pricing: %#v", row)
	}
	if err := db.Exec(`INSERT INTO channel_models (id) VALUES ('model-b')`).Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Table("channel_models").Where("channel_label = ''").Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("empty label default missing: count=%d err=%v", count, err)
	}
}
