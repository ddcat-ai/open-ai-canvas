package database

import (
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func TestMCPSecurityMigrationRevokesLegacyConnectionsAndKeepsReceipts(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "mcp-security.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := migrateAgentMCP(db); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for _, scope := range []string{"platform", "user"} {
		row := model.MCPConnection{ID: scope, UserID: scope, Scope: scope, Name: "existing", Transport: "streamable_http", ServerURL: "https://mcp.example.com", ParametersCiphertext: "existing-encrypted-value", Enabled: true, ToolsJSON: `[{"name":"read"}]`, AllowedToolsJSON: `["read"]`, Revision: 7, LastTestAt: &now}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	receipt := model.MCPToolExecution{ID: "receipt", UserID: "user", RunID: "run", ConnectionID: "user", Fingerprint: "immutable", Status: "completed", ResultJSON: `{"ok":true}`}
	if err := db.Create(&receipt).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return migrateMCPTenantBoundaries(tx) }); err != nil {
		t.Fatal(err)
	}
	var rows []model.MCPConnection
	if err := db.Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if row.Enabled || row.Revision != 8 || row.LastTestAt != nil || row.ToolsJSON != "[]" || row.AllowedToolsJSON != "[]" || row.AllowedUserIDsJSON != "[]" || row.ParametersCiphertext != "existing-encrypted-value" {
			t.Fatalf("legacy connection not safely revoked: %+v", row)
		}
		var usage model.MCPStorageUsage
		if err := db.First(&usage, "user_id = ?", row.UserID).Error; err != nil || usage.Bytes <= 0 {
			t.Fatalf("missing legacy quota: %+v %v", usage, err)
		}
	}
	var preserved model.MCPToolExecution
	if err := db.First(&preserved, "id = ?", receipt.ID).Error; err != nil || preserved.Fingerprint != receipt.Fingerprint || preserved.ResultJSON != receipt.ResultJSON {
		t.Fatalf("receipt lost: %+v %v", preserved, err)
	}
	var grants int64
	if err := db.Model(&model.MCPConnectionGrant{}).Count(&grants).Error; err != nil || grants != 0 {
		t.Fatalf("migration silently granted users: %d %v", grants, err)
	}
}
