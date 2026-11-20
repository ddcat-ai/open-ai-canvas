package database

import (
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func agentMCPMigrationFixture(t *testing.T) (*gorm.DB, migration, []schemaMigration) {
	t.Helper()
	var target migration
	for _, item := range schemaMigrations {
		if item.version == 100 {
			target = item
			break
		}
	}
	if CurrentSchemaVersion < 100 || target.name != "agent_mcp_connections" || target.checksum != "sha256:agent-mcp-connections-v100" || target.apply == nil {
		t.Fatalf("missing or changed MCP migration: version=%d migration=%+v", CurrentSchemaVersion, target)
	}
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "mcp-migration.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	// Record the published v99 ledger without rerunning unrelated historical
	// business conversions. No MCP table exists before this upgrade.
	stamp := time.Date(2026, 11, 10, 12, 30, 45, 123456000, time.UTC)
	for _, item := range schemaMigrations {
		if item.version >= target.version {
			continue
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: stamp}).Error; err != nil {
			t.Fatal(err)
		}
	}
	var ledger []schemaMigration
	if err := db.Order("version").Find(&ledger).Error; err != nil {
		t.Fatal(err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || status.Current != 99 || status.Ready {
		t.Fatalf("expected v99 fixture, got %+v err=%v", status, err)
	}
	for _, entity := range []any{&model.MCPServerTemplate{}, &model.MCPConnection{}, &model.MCPToolExecution{}} {
		if db.Migrator().HasTable(entity) {
			t.Fatalf("v99 fixture already contains %T", entity)
		}
	}
	return db, target, ledger
}

func TestAgentMCPMigration100Upgrades99WithUnconfiguredCatalog(t *testing.T) {
	db, target, before := agentMCPMigrationFixture(t)
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade v99 to v100: %v", err)
	}
	if err := RequireSchemaVersion(db); err != nil {
		t.Fatal(err)
	}
	for _, entity := range []any{&model.MCPServerTemplate{}, &model.MCPConnection{}, &model.MCPToolExecution{}} {
		if !db.Migrator().HasTable(entity) {
			t.Fatalf("missing migrated table for %T", entity)
		}
		registered := 0
		for _, item := range Models() {
			if reflect.TypeOf(item) == reflect.TypeOf(entity) {
				registered++
			}
		}
		if registered != 1 {
			t.Fatalf("Models registrations for %T = %d", entity, registered)
		}
	}
	for _, entity := range []any{&model.MCPConnection{}, &model.MCPToolExecution{}} {
		var count int64
		if err := db.Model(entity).Count(&count).Error; err != nil || count != 0 {
			t.Fatalf("migration must not create installed credentials or executions: %T count=%d err=%v", entity, count, err)
		}
	}
	var templates []model.MCPServerTemplate
	if err := db.Order("id").Find(&templates).Error; err != nil {
		t.Fatal(err)
	}
	if len(templates) != 2 || templates[0].ID != "builtin-feishu" || templates[1].ID != "builtin-github" {
		t.Fatalf("unexpected built-in templates: %+v", templates)
	}
	for _, row := range templates {
		var definition struct {
			Name       string            `json:"name"`
			Transport  string            `json:"transport"`
			ServerURL  string            `json:"serverUrl"`
			Headers    map[string]string `json:"headers"`
			Parameters []struct {
				Name         string `json:"name"`
				Type         string `json:"type"`
				DefaultValue string `json:"defaultValue"`
			} `json:"parameters"`
		}
		if err := json.Unmarshal([]byte(row.Definition), &definition); err != nil {
			t.Fatal(err)
		}
		if !row.Published || definition.Name == "" || definition.Transport != "streamable_http" || len(definition.Parameters) != 1 {
			t.Fatalf("invalid catalog definition: id=%s definition=%+v", row.ID, definition)
		}
		parameter := definition.Parameters[0]
		if parameter.Name != "token" || parameter.Type != "secret" || parameter.DefaultValue != "" || !reflect.DeepEqual(definition.Headers, map[string]string{"Authorization": "Bearer {{token}}"}) {
			t.Fatalf("catalog must contain a secret parameter declaration without installed credentials: id=%s", row.ID)
		}
		if row.ID == "builtin-feishu" && definition.ServerURL != "" {
			t.Fatal("Feishu catalog must require the user's remote service address")
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal([]byte(row.Definition), &fields); err != nil {
			t.Fatal(err)
		}
		for key := range fields {
			switch key {
			case "name", "description", "homepage", "transport", "serverUrl", "headers", "parameters", "published":
			default:
				t.Fatalf("catalog includes non-template field %q", key)
			}
		}
	}
	var oldAfter []schemaMigration
	if err := db.Where("version < ?", target.version).Order("version").Find(&oldAfter).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, oldAfter) {
		t.Fatal("MCP migration rewrote historical ledger names, checksums, or timestamps")
	}
	var applied schemaMigration
	if err := db.First(&applied, "version = ?", target.version).Error; err != nil {
		t.Fatal(err)
	}
	if applied.Name != target.name || applied.Checksum != target.checksum || applied.AppliedAt.IsZero() {
		t.Fatalf("invalid v100 ledger entry: %+v", applied)
	}
}

func TestAgentMCPMigration100RepeatPreservesAdminDataAndLedger(t *testing.T) {
	db, target, _ := agentMCPMigrationFixture(t)
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 11, 11, 5, 6, 7, 123456000, time.UTC)
	customDefinition := `{"name":"管理员自定义服务","description":"保留管理员选择","transport":"sse","serverUrl":"https://mcp.example.invalid/events","headers":{},"parameters":[],"published":false}`
	if err := db.Model(&model.MCPServerTemplate{}).Where("id = ?", "builtin-github").Updates(map[string]any{
		"definition": customDefinition, "published": false, "updated_at": stamp,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.MCPServerTemplate{ID: "admin-custom", Definition: customDefinition, Published: false, CreatedAt: stamp, UpdatedAt: stamp}).Error; err != nil {
		t.Fatal(err)
	}
	connection := model.MCPConnection{
		ID: "installed", UserID: "fixture-user", Scope: "user", TemplateID: "admin-custom", Name: "已安装连接",
		Transport: "sse", ServerURL: "https://mcp.example.invalid/events", ParametersCiphertext: "synthetic-ciphertext-for-migration-test",
		Enabled: true, ToolsJSON: `[{"name":"lookup","inputSchema":{"type":"object"}}]`, AllowedToolsJSON: `["lookup"]`,
		Revision: 7, LastTestAt: &stamp, CreatedAt: stamp, UpdatedAt: stamp,
	}
	if err := db.Create(&connection).Error; err != nil {
		t.Fatal(err)
	}
	execution := model.MCPToolExecution{
		ID: "completed-receipt", UserID: connection.UserID, RunID: "fixture-run", ConnectionID: connection.ID,
		Fingerprint: "fixture-fingerprint", Status: "completed", ResultJSON: `{"isError":false,"message":"done"}`,
		CreatedAt: stamp, UpdatedAt: stamp,
	}
	if err := db.Create(&execution).Error; err != nil {
		t.Fatal(err)
	}
	var templatesBefore []model.MCPServerTemplate
	var ledgerBefore []schemaMigration
	if err := db.Order("id").Find(&templatesBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Order("version").Find(&ledgerBefore).Error; err != nil {
		t.Fatal(err)
	}
	// Reload timestamps as the database stores them before comparing exact rows.
	if err := db.First(&connection, "id = ?", connection.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&execution, "id = ?", execution.ID).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := db.Transaction(target.apply); err != nil {
			t.Fatalf("repeat MCP DDL/seeding: %v", err)
		}
		if err := MigrateSchema(db); err != nil {
			t.Fatalf("repeat schema migration: %v", err)
		}
	}
	var templatesAfter []model.MCPServerTemplate
	var ledgerAfter []schemaMigration
	var connectionsAfter []model.MCPConnection
	var executionsAfter []model.MCPToolExecution
	for _, destination := range []any{&templatesAfter, &ledgerAfter, &connectionsAfter, &executionsAfter} {
		order := "id"
		if _, ledger := destination.(*[]schemaMigration); ledger {
			order = "version"
		}
		if err := db.Order(order).Find(destination).Error; err != nil {
			t.Fatal(err)
		}
	}
	if !reflect.DeepEqual(templatesBefore, templatesAfter) {
		t.Fatal("repeat migration replaced administrator template edits, publication state, or timestamps")
	}
	if !reflect.DeepEqual(ledgerBefore, ledgerAfter) {
		t.Fatal("repeat migration changed the schema ledger")
	}
	if !reflect.DeepEqual(connectionsAfter, []model.MCPConnection{connection}) {
		t.Fatal("repeat migration changed installed credentials, grants, revision, or test timestamp")
	}
	if !reflect.DeepEqual(executionsAfter, []model.MCPToolExecution{execution}) {
		t.Fatal("repeat migration changed durable execution receipts")
	}
}
