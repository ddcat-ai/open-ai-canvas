package database

import (
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/model"
)

func TestEcommerceAgentSchemaMigration79(t *testing.T) {
	db, err := gorm.Open(sqlite.Dialector{DriverName: "sqlite", DSN: filepath.Join(t.TempDir(), "schema.db")}, &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { sqlDB, _ := db.DB(); _ = sqlDB.Close() }()
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, table := range []any{&model.EcommerceAgentAnalysis{}, &model.EcommerceAgentRun{}, &model.EcommerceAgentPage{}, &model.EcommerceAgentCanvasVersion{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing agent table %T", table)
		}
	}
	if !db.Migrator().HasColumn(&model.EcommerceKnowledgeEntry{}, "KnowledgeDomain") {
		t.Fatal("missing ecommerce knowledge domain column after schema migration")
	}
	if !db.Migrator().HasIndex(&model.EcommerceKnowledgeEntry{}, "idx_ecommerce_knowledge_domain") {
		t.Fatal("missing ecommerce knowledge domain index after schema migration")
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}

func TestEcommerceAgentSchemaUpgradeFrom78PreservesMigrationHistory(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "upgrade.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version > 78 {
			break
		}
		if err := item.apply(db); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	ecommerceModels := []any{
		&model.EcommerceProject{}, &model.EcommerceKnowledgeSource{},
		&model.EcommerceKnowledgeEntry{}, &model.EcommerceCreativeRecommendation{},
		&model.EcommerceAgentAnalysis{}, &model.EcommerceAgentRun{},
		&model.EcommerceAgentPage{}, &model.EcommerceAgentCanvasVersion{},
	}
	// The baseline uses current models; remove new tables to restore the v78 schema.
	if err := db.Migrator().DropTable(ecommerceModels...); err != nil {
		t.Fatal(err)
	}
	var before []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	var legacy schemaMigration
	if err := db.First(&legacy, "version = ?", 78).Error; err != nil {
		t.Fatal(err)
	}
	if legacy.Name != "drama_cast_voice_looks" || legacy.Checksum != "sha256:drama-cast-voice-looks-v78-20261101" {
		t.Fatalf("v78 migration identity changed: %+v", legacy)
	}
	cast := model.DramaCast{ID: "existing-look", ProjectID: "existing-drama", Kind: "character", ParentID: "existing-character", LookName: "formal", LookFromChapter: 2, LookToChapter: 5, VoiceProfileID: "existing-voice", VoiceSampleResourceID: "existing-audio"}
	if err := db.Create(&cast).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&cast, "id = ?", cast.ID).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var after []schemaMigration
	if err := db.Where("version <= ?", 78).Order("version").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("existing migration ledger changed")
	}
	for _, table := range ecommerceModels {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing ecommerce table %T after upgrading from v78", table)
		}
	}
	if !db.Migrator().HasColumn(&model.EcommerceKnowledgeEntry{}, "KnowledgeDomain") || !db.Migrator().HasIndex(&model.EcommerceKnowledgeEntry{}, "idx_ecommerce_knowledge_domain") {
		t.Fatal("missing ecommerce knowledge domain column or index")
	}
	var added schemaMigration
	if err := db.First(&added, "version = ?", 79).Error; err != nil {
		t.Fatal(err)
	}
	if added.Name != "ecommerce_agent_and_knowledge" || added.Checksum != "sha256:ecommerce-agent-and-knowledge-v79-20261101" {
		t.Fatalf("unexpected v79 migration identity: %+v", added)
	}
	var stored model.DramaCast
	if err := db.First(&stored, "id = ?", cast.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(cast, stored) {
		t.Fatal("existing drama voice or look data changed")
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
}
