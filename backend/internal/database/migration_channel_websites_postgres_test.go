package database

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestPostgresChannelWebsiteMigrationUpgradesVersion96(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := Open(Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	baseSQL, err := base.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQL.Close()
	schemaName := fmt.Sprintf("channel_website_migration_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schemaName + `"`).Error; err != nil {
		t.Fatalf("create isolated schema: %v", err)
	}
	defer func() {
		if err := base.Exec(`DROP SCHEMA IF EXISTS "` + schemaName + `" CASCADE`).Error; err != nil {
			t.Errorf("drop isolated schema: %v", err)
		}
	}()
	testDSN, err := postgresDSNWithSearchPath(dsn, schemaName)
	if err != nil {
		t.Fatal(err)
	}
	db, err := Open(Config{Driver: "postgres", DSN: testDSN})
	if err != nil {
		t.Fatal(err)
	}
	dbSQL, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer dbSQL.Close()

	// Recreate the v96 channel/pricing slice without website_id or the three
	// new tables; unrelated historical migrations are recorded, not rerun.
	if err := db.AutoMigrate(&schemaMigration{}, &model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.ModelChannel{}, "WebsiteID"); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2024, 1, 2, 3, 4, 5, 123456000, time.UTC)
	channels := []model.ModelChannel{
		{ID: "key-a", Scope: model.ChannelScopeSystem, Name: "Shared A", BaseURL: "https://EXAMPLE.invalid:443/v1", APIFormat: "openai", APIKey: "synthetic-a", SecretKey: "synthetic-secret-a", HeadersJSON: `[{"name":"OpenAI-Beta","value":"assistants=v2"}]`, Enabled: true, ModelsJSON: `["provider-model"]`, UpdatedAt: stamp},
		{ID: "key-b", Scope: model.ChannelScopeSystem, Name: "Shared B", BaseURL: "https://example.invalid/v1", APIFormat: "openai", APIKey: "synthetic-b", HeadersJSON: `[{"name":"OpenAI-Beta","value":"assistants=v2"}]`, UpdatedAt: stamp},
		{ID: "key-path", Scope: model.ChannelScopeSystem, Name: "Other Path", BaseURL: "https://example.invalid/v1beta", APIFormat: "openai", UpdatedAt: stamp},
		{ID: "key-private", Scope: model.ChannelScopeSystem, Name: "Private Header", BaseURL: "https://example.invalid/v1", APIFormat: "openai", HeadersJSON: `[{"name":"X-Token","value":"synthetic-private"}]`, UpdatedAt: stamp},
		{ID: "user-key", Scope: model.ChannelScopeUser, UserID: "synthetic-user", Name: "User Channel", BaseURL: "https://example.invalid/v1", APIFormat: "openai", APIKey: "synthetic-user-key", UpdatedAt: stamp},
	}
	if err := db.Omit("WebsiteID").Create(&channels).Error; err != nil {
		t.Fatal(err)
	}
	channelModel := model.ChannelModel{ID: "MODEL_000321", ChannelID: "key-a", ModelKey: "local-model", ProviderModelKey: "provider-model", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, BillingMode: "token", PriceConfigured: true, Enabled: true, PriceVersion: 7, CapabilityVersion: 4, InputTokenPriceMicrocredits: 1_000_000, OutputTokenPriceMicrocredits: 2_000_000, UpdatedAt: stamp}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	tier := model.ChannelModelPriceTier{ID: "PTIER_000456", ChannelModelID: channelModel.ID, SelectorKey: "{}", SelectorJSON: "{}", Resolution: "*", ProviderModelKey: "provider-model", BillingMode: "token", InputTokenPriceMicrocredits: 1_000_000, OutputTokenPriceMicrocredits: 2_000_000, PriceConfigured: true, Enabled: true, PriceVersion: 9, CostPricing: model.CreditCostPricing{Configured: true, InputTokenPriceMicrocredits: 100_000, OutputTokenPriceMicrocredits: 200_000}, UpdatedAt: stamp}
	if err := db.Create(&tier).Error; err != nil {
		t.Fatal(err)
	}
	for _, migration := range schemaMigrations {
		if migration.version < 97 {
			if err := db.Create(&schemaMigration{Version: migration.version, Name: migration.name, Checksum: migration.checksum, AppliedAt: stamp}).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	var oldRecords []schemaMigration
	if err := db.Order("version").Find(&oldRecords).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Order("id").Find(&channels).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&channelModel, "id = ?", channelModel.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&tier, "id = ?", tier.ID).Error; err != nil {
		t.Fatal(err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || status.Current != 96 || status.Ready {
		t.Fatalf("legacy schema status: %+v err=%v", status, err)
	}
	// Startup migrates a newly opened pool before reading channel rows. Keep
	// fixture SELECT * plans for the old schema out of that upgrade connection.
	if err := dbSQL.Close(); err != nil {
		t.Fatal(err)
	}
	db, err = Open(Config{Driver: "postgres", DSN: testDSN})
	if err != nil {
		t.Fatal(err)
	}
	dbSQL, err = db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer dbSQL.Close()
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("v96 to v97 migration: %v", err)
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
	var migrated []model.ModelChannel
	if err := db.Order("id").Find(&migrated).Error; err != nil {
		t.Fatal(err)
	}
	if len(migrated) != len(channels) {
		t.Fatal("channel count changed")
	}
	websites := make(map[string]string)
	for i, current := range migrated {
		websites[current.ID] = current.WebsiteID
		current.WebsiteID = ""
		if !reflect.DeepEqual(channels[i], current) {
			t.Fatalf("channel IDs, secrets, configuration or version changed: %s", current.ID)
		}
	}
	if websites["key-a"] == "" || websites["key-a"] != websites["key-b"] || websites["key-a"] == websites["key-path"] || websites["key-a"] == websites["key-private"] || websites["user-key"] != "" {
		t.Fatalf("website grouping changed channel boundaries: %+v", websites)
	}
	var sites []model.ChannelWebsite
	if err := db.Order("id").Find(&sites).Error; err != nil || len(sites) != 3 {
		t.Fatalf("website backfill: count=%d err=%v", len(sites), err)
	}
	if !db.Migrator().HasIndex(&model.ModelChannel{}, "WebsiteID") {
		t.Fatal("website_id index missing")
	}
	snapshot := model.ChannelCatalogSnapshot{ChannelID: "key-a", SourceDigest: strings.Repeat("a", 64), ModelsJSON: `["provider-model"]`, ReadAt: stamp}
	selection := model.ChannelProtocolSelection{WebsiteID: websites["key-a"], ProviderModelKey: "provider-model", Capability: "text", Protocol: "chat-completion", ChannelModelID: channelModel.ID, ActorID: "synthetic-admin", SelectedAt: stamp}
	if err := db.Create(&snapshot).Error; err != nil {
		t.Fatalf("write new catalog snapshot table: %v", err)
	}
	if err := db.Create(&selection).Error; err != nil || selection.ID == 0 {
		t.Fatalf("write new protocol selection table: id=%d err=%v", selection.ID, err)
	}
	if err := db.First(&snapshot, "channel_id = ?", snapshot.ChannelID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&selection, "id = ?", selection.ID).Error; err != nil {
		t.Fatal(err)
	}
	// Repeat the production migration entry with populated new tables; every
	// original row and every generated website ID must remain unchanged.
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("repeat v97 migration: %v", err)
	}
	var again []model.ModelChannel
	var againSites []model.ChannelWebsite
	var afterModel model.ChannelModel
	var afterTier model.ChannelModelPriceTier
	var afterSnapshot model.ChannelCatalogSnapshot
	var afterSelection model.ChannelProtocolSelection
	var records []schemaMigration
	for _, read := range []struct {
		target any
		order  string
	}{
		{&again, "id"}, {&againSites, "id"}, {&afterModel, "id"}, {&afterTier, "id"},
		{&afterSnapshot, "channel_id"}, {&afterSelection, "id"}, {&records, "version"},
	} {
		if err := db.Order(read.order).Find(read.target).Error; err != nil {
			t.Fatal(err)
		}
	}
	if !reflect.DeepEqual(migrated, again) || !reflect.DeepEqual(sites, againSites) {
		t.Fatal("repeat migration changed channel/website IDs or data")
	}
	if !reflect.DeepEqual(channelModel, afterModel) || !reflect.DeepEqual(tier, afterTier) {
		t.Fatal("migration changed model/price IDs, prices, costs or versions")
	}
	if !reflect.DeepEqual(snapshot, afterSnapshot) || !reflect.DeepEqual(selection, afterSelection) {
		t.Fatal("new catalog/protocol rows changed across repeat migration")
	}
	var applied []migration
	for _, entry := range schemaMigrations {
		if entry.version >= 97 {
			applied = append(applied, entry)
		}
	}
	if len(records) != len(oldRecords)+len(applied) || !reflect.DeepEqual(oldRecords, records[:len(oldRecords)]) {
		t.Fatal("migration changed historical schema records or reapplied an upgrade")
	}
	for i, entry := range applied {
		record := records[len(oldRecords)+i]
		if record.Version != entry.version || record.Name != entry.name || record.Checksum != entry.checksum || record.AppliedAt.IsZero() {
			t.Fatalf("unexpected upgrade record: %+v, want version %d (%s)", record, entry.version, entry.name)
		}
	}
}
