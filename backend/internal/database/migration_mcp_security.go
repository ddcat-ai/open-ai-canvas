package database

import (
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func migrateMCPTenantBoundaries(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.MCPConnection{}, &model.MCPConnectionGrant{}, &model.MCPStorageUsage{}); err != nil {
		return err
	}
	// Old installations have no tenant grants or bounded discovery snapshots.
	// Require re-discovery for every connection; platform grants start empty.
	// Credentials and execution receipts remain available for reconciliation.
	if err := tx.Model(&model.MCPConnection{}).Where("1 = 1").Updates(map[string]any{
		"enabled": false, "tools_json": "[]", "tools_summary_json": "[]",
		"allowed_tools_json": "[]", "allowed_user_ids_json": "[]", "tool_policies_json": "{}",
		"last_test_at": nil, "revision": gorm.Expr("revision + 1"),
	}).Error; err != nil {
		return err
	}
	length := func(column string) string {
		if tx.Dialector.Name() == "postgres" {
			return "octet_length(COALESCE(" + column + ", ''))"
		}
		return "length(CAST(COALESCE(" + column + ", '') AS BLOB))"
	}
	connectionBytes := "CASE WHEN scope = 'platform' THEN 32768 ELSE 1024 END"
	for _, column := range []string{"parameters_ciphertext", "tools_json", "tools_summary_json", "allowed_tools_json", "allowed_user_ids_json", "tool_policies_json", "name", "server_url"} {
		connectionBytes += " + " + length(column)
	}
	resultBytes := length("result_json")
	receiptBytes := "1024 + CASE WHEN status = 'running' AND " + resultBytes + " < 49152 THEN 49152 ELSE " + resultBytes + " END"
	// Initialize existing owners before template revocation can free their bytes.
	return tx.Exec("INSERT INTO mcp_storage_usages (user_id, bytes) SELECT user_id, SUM(bytes) FROM (SELECT user_id, " + connectionBytes + " AS bytes FROM mcp_connections UNION ALL SELECT user_id, " + receiptBytes + " AS bytes FROM mcp_tool_executions) AS usage_rows GROUP BY user_id ON CONFLICT (user_id) DO NOTHING").Error
}
