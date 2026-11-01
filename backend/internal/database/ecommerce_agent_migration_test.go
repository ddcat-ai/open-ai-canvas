package database

import (
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/model"
)

func TestEcommerceAgentSchemaMigration72(t *testing.T) {
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
