package database

import (
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestChannelWebsiteMigrationPreservesChannelsAndSeparatesEndpoints(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:channel-websites-migration?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.ModelChannel{}); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
	rows := []model.ModelChannel{
		{ID: "a", Scope: model.ChannelScopeSystem, Name: "A", BaseURL: "https://EXAMPLE.com:443/v1", APIFormat: "openai", APIKey: "fixture-a", UpdatedAt: stamp},
		{ID: "b", Scope: model.ChannelScopeSystem, Name: "B", BaseURL: "https://example.com/v1", APIFormat: "openai", APIKey: "fixture-b", UpdatedAt: stamp},
		{ID: "path", Scope: model.ChannelScopeSystem, Name: "Path", BaseURL: "https://example.com/v1beta", APIFormat: "openai", UpdatedAt: stamp},
		{ID: "format", Scope: model.ChannelScopeSystem, Name: "Format", BaseURL: "https://example.com/v1", APIFormat: "gemini", UpdatedAt: stamp},
		{ID: "private", Scope: model.ChannelScopeSystem, Name: "Private", BaseURL: "https://example.com/v1", APIFormat: "openai", HeadersJSON: `[{"name":"X-Token","value":"fixture"}]`, UpdatedAt: stamp},
		{ID: "private2", Scope: model.ChannelScopeSystem, Name: "Private2", BaseURL: "https://example.com/v1", APIFormat: "openai", HeadersJSON: `[{"name":"X-Token","value":"fixture"}]`, UpdatedAt: stamp},
	}
	for i := range rows {
		if err := db.Create(&rows[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Order("id").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateChannelWebsites(db); err != nil {
		t.Fatal(err)
	}
	var after []model.ModelChannel
	if err := db.Order("id").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	byID := map[string]model.ModelChannel{}
	for _, row := range after {
		byID[row.ID] = row
	}
	if byID["a"].WebsiteID == "" || byID["a"].WebsiteID != byID["b"].WebsiteID {
		t.Fatal("equivalent endpoints not grouped")
	}
	for _, id := range []string{"path", "format", "private", "private2"} {
		if byID[id].WebsiteID == byID["a"].WebsiteID {
			t.Fatalf("unsafe grouping: %s", id)
		}
	}
	if byID["private"].WebsiteID == byID["private2"].WebsiteID {
		t.Fatal("unknown credential header grouped")
	}
	for _, before := range rows {
		current := byID[before.ID]
		current.WebsiteID = ""
		if !reflect.DeepEqual(before, current) {
			t.Fatalf("channel business data changed for %s", before.ID)
		}
	}
	var count int64
	db.Model(&model.ChannelWebsite{}).Count(&count)
	if err := migrateChannelWebsites(db); err != nil {
		t.Fatal(err)
	}
	var again int64
	db.Model(&model.ChannelWebsite{}).Count(&again)
	if count != again {
		t.Fatal("migration is not idempotent")
	}
}

func TestChannelWebsiteMigrationUpgradesVersion96(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:channel-websites-v96?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&schemaMigration{}, &model.ModelChannel{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.ModelChannel{}, "WebsiteID"); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	row := model.ModelChannel{ID: "legacy-channel", Scope: model.ChannelScopeSystem, Name: "Legacy", BaseURL: "https://example.com/v1", APIFormat: "openai", APIKey: "synthetic-key", UpdatedAt: stamp}
	if err := db.Omit("WebsiteID").Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&row, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	for _, migration := range schemaMigrations {
		if migration.version >= 97 {
			continue
		}
		if err := db.Create(&schemaMigration{Version: migration.version, Name: migration.name, Checksum: migration.checksum, AppliedAt: stamp}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for run := 0; run < 2; run++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
		if err := RequireSchemaVersion(db); err != nil {
			t.Fatal(err)
		}
	}
	var after model.ModelChannel
	if err := db.First(&after, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.WebsiteID == "" {
		t.Fatal("version 97 did not assign a website")
	}
	after.WebsiteID = ""
	if !reflect.DeepEqual(row, after) {
		t.Fatal("version 97 altered existing channel data")
	}
	var sites int64
	if err := db.Model(&model.ChannelWebsite{}).Count(&sites).Error; err != nil || sites != 1 {
		t.Fatalf("website count=%d err=%v", sites, err)
	}
}
