package database

import "testing"

func TestChannelPresentationMigrationPreservesExistingRows(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:channel-presentation-migration?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`CREATE TABLE model_channels (id TEXT PRIMARY KEY, name TEXT, api_key TEXT)`,
		`CREATE TABLE channel_models (id TEXT PRIMARY KEY, price_version INTEGER, unit_price_microcredits INTEGER)`,
		`INSERT INTO model_channels VALUES ('existing', '原渠道', 'synthetic-key')`,
		`INSERT INTO channel_models VALUES ('existing', 7, 12345)`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := migrateChannelPresentation(db); err != nil {
			t.Fatal(err)
		}
	}
	var channel struct {
		Name, APIKey, PublicAlias string
		SortOrder                 int
	}
	if err := db.Table("model_channels").First(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if channel.Name != "原渠道" || channel.APIKey != "synthetic-key" || channel.PublicAlias != "" || channel.SortOrder != 0 {
		t.Fatalf("channel migration: %#v", channel)
	}
	var cm struct{ PriceVersion, UnitPriceMicrocredits, SortOrder int }
	if err := db.Table("channel_models").First(&cm).Error; err != nil {
		t.Fatal(err)
	}
	if cm.PriceVersion != 7 || cm.UnitPriceMicrocredits != 12345 || cm.SortOrder != 0 {
		t.Fatalf("model migration: %#v", cm)
	}
}
