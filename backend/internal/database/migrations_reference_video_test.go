package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestMigrateReferenceVideoBillingKeepsExistingTokenVideoCharges(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-reference-video-billing-v88?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ChannelModel{}, &model.ChannelModelPriceTier{}, &model.BillingOrder{}); err != nil {
		t.Fatal(err)
	}
	models := []model.ChannelModel{
		{ID: "video-token", ChannelID: "c", ModelKey: "video-token", Capability: "video"},
		{ID: "video-mixed", ChannelID: "c", ModelKey: "video-mixed", Capability: "video"},
		{ID: "video-second", ChannelID: "c", ModelKey: "video-second", Capability: "video"},
		{ID: "text-token", ChannelID: "c", ModelKey: "text-token", Capability: "text"},
	}
	tiers := []model.ChannelModelPriceTier{
		{ID: "t1", ChannelModelID: "video-token", SelectorKey: "{}", BillingMode: "token", OutputTokenPriceMicrocredits: 16_000_000},
		{ID: "t2", ChannelModelID: "video-token", SelectorKey: `{"vquality":"1080p"}`, BillingMode: "token", OutputTokenPriceMicrocredits: 20_000_000},
		{ID: "t3", ChannelModelID: "video-mixed", SelectorKey: "{}", BillingMode: "token", OutputTokenPriceMicrocredits: 16_000_000},
		{ID: "t4", ChannelModelID: "video-mixed", SelectorKey: `{"vquality":"1080p"}`, BillingMode: "per_second", UnitPriceMicrocredits: 1_000_000},
		{ID: "t5", ChannelModelID: "video-second", SelectorKey: "{}", BillingMode: "per_second", UnitPriceMicrocredits: 1_000_000},
		{ID: "t6", ChannelModelID: "text-token", SelectorKey: "{}", BillingMode: "token", OutputTokenPriceMicrocredits: 3_000_000},
	}
	if err := db.Create(&models).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&tiers).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateReferenceVideoBilling(db); err != nil {
		t.Fatal(err)
	}
	if err := migrateReferenceVideoCostPrice(db); err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"cost_reference_video_unit_price_microcredits", "cost_reference_video_output_token_price_microcredits"} {
		if !db.Migrator().HasColumn(&model.ChannelModelPriceTier{}, column) || !db.Migrator().HasColumn(&model.BillingOrder{}, column) {
			t.Fatalf("missing cost column %s", column)
		}
	}
	wantEnabled := map[string]bool{"video-token": true}
	var saved []model.ChannelModel
	if err := db.Find(&saved).Error; err != nil {
		t.Fatal(err)
	}
	for _, item := range saved {
		if item.ReferenceVideoBilling != wantEnabled[item.ID] {
			t.Fatalf("%s referenceVideoBilling = %v", item.ID, item.ReferenceVideoBilling)
		}
	}
	var savedTiers []model.ChannelModelPriceTier
	if err := db.Find(&savedTiers).Error; err != nil {
		t.Fatal(err)
	}
	for _, tier := range savedTiers {
		want := int64(0)
		if tier.ChannelModelID == "video-token" {
			want = tier.OutputTokenPriceMicrocredits
		}
		if tier.ReferenceVideoOutputTokenPriceMicrocredits != want || tier.ReferenceVideoUnitPriceMicrocredits != 0 {
			t.Fatalf("tier %s reference prices = %d/%d, want token %d", tier.ID, tier.ReferenceVideoUnitPriceMicrocredits, tier.ReferenceVideoOutputTokenPriceMicrocredits, want)
		}
	}
}
