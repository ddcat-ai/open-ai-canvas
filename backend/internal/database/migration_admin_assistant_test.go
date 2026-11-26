package database

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestAssistantMigrationSQLite(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "assistant.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err = MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err = MigrateSchema(db); err != nil {
		t.Fatal("migration not repeatable", err)
	}
	if err = RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
	for _, entity := range []any{&model.AssistantCredential{}, &model.AssistantOAuthClient{}, &model.AssistantOAuthCode{}, &model.AssistantGrant{}, &model.AssistantRefreshUse{}, &model.AssistantInvocation{}, &model.AssistantAttachment{}} {
		if !db.Migrator().HasTable(entity) {
			t.Errorf("missing table for %T", entity)
		}
	}
	if !db.Migrator().HasIndex(&model.AssistantInvocation{}, "assistant_call_key") {
		t.Fatal("missing credential/idempotency unique index")
	}
}

func TestAssistantApprovalModeUpgradePreservesExistingAuthorization(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "approval-mode.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	for _, table := range []string{"assistant_credentials", "assistant_oauth_codes", "assistant_grants", "mcp_connections"} {
		if err = db.Exec("CREATE TABLE " + table + " (id TEXT PRIMARY KEY)").Error; err != nil {
			t.Fatal(err)
		}
		if err = db.Exec("INSERT INTO " + table + " (id) VALUES ('existing')").Error; err != nil {
			t.Fatal(err)
		}
	}
	if err = migrateAdminAssistantApprovalMode(db); err != nil {
		t.Fatal(err)
	}
	if err = migrateAdminAssistantApprovalMode(db); err != nil {
		t.Fatal("upgrade not repeatable", err)
	}
	for _, table := range []string{"assistant_credentials", "assistant_oauth_codes", "assistant_grants", "mcp_connections"} {
		var mode string
		if err = db.Table(table).Select("approval_mode").Where("id = 'existing'").Scan(&mode).Error; err != nil || mode != "request_approval" {
			t.Fatalf("%s mode=%q err=%v", table, mode, err)
		}
	}
}
func TestAssistantMigrationPostgres(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := Open(Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, _ := base.DB()
	defer baseSQL.Close()
	schemaName := fmt.Sprintf("assistant_migration_%d", time.Now().UnixNano())
	if err = base.Exec(`CREATE SCHEMA "` + schemaName + `"`).Error; err != nil {
		t.Fatal(err)
	}
	defer base.Exec(`DROP SCHEMA "` + schemaName + `" CASCADE`)
	testDSN, err := postgresDSNWithSearchPath(dsn, schemaName)
	if err != nil {
		t.Fatal(err)
	}
	db, err := Open(Config{Driver: "postgres", DSN: testDSN})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err = migrateAdminAssistant(db); err != nil {
		t.Fatal(err)
	}
	if err = migrateAdminAssistant(db); err != nil {
		t.Fatal(err)
	}
	var protected int64
	if err = db.Raw(`SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname=? AND c.relrowsecurity`, schemaName).Scan(&protected).Error; err != nil {
		t.Fatal(err)
	}
	if protected != 7 {
		t.Fatalf("RLS protected %d tables, expected 7", protected)
	}
	row := model.AssistantInvocation{ID: "first", UserID: "admin", CredentialID: "credential", IdempotencyKey: "unique", Status: "ready", CreatedAt: time.Now(), ExpiresAt: time.Now().Add(time.Minute)}
	if err = db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	row.ID = "second"
	if err = db.Transaction(func(tx *gorm.DB) error { return tx.Create(&row).Error }); err == nil {
		t.Fatal("missing unique idempotency constraint")
	}
}
