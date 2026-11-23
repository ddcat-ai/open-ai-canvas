package database

import (
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func migrateAgentStorageLimits(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.AgentStorageUsage{}); err != nil {
		return err
	}
	return reconcileAgentStorageUsage(tx)
}

func reconcileAgentStorageUsage(tx *gorm.DB) error {
	// Schema 104 created the ledger without backfilling existing Agent rows.
	// Reconcile missing owners before the platform-wide hot-pool limit starts
	// using the ledger. Existing rows remain authoritative so this is safe to
	// run again on a repaired installation.
	length := func(column string) string {
		if tx.Dialector.Name() == "postgres" {
			return "octet_length(COALESCE(" + column + ", ''))"
		}
		return "length(CAST(COALESCE(" + column + ", '') AS BLOB))"
	}
	rows := make([]string, 0, 5)
	for _, source := range []struct {
		table  string
		column string
	}{
		{table: "cloud_agent_executions", column: "state_json"},
		{table: "cloud_agent_pi_sessions", column: "session_jsonl"},
		{table: "cloud_agent_event_records", column: "event_json"},
		{table: "cloud_agent_message_records", column: "message_json"},
		{table: "cloud_agent_canvas_mutations", column: "before_json"},
	} {
		if tx.Migrator().HasTable(source.table) {
			rows = append(rows, "SELECT user_id, "+length(source.column)+" AS bytes FROM "+source.table)
		}
	}
	if len(rows) == 0 {
		return nil
	}
	query := "INSERT INTO agent_storage_usages (user_id, stored_bytes, updated_at) SELECT user_id, SUM(bytes), CURRENT_TIMESTAMP FROM (" + strings.Join(rows, " UNION ALL ") + ") AS usage_rows GROUP BY user_id ON CONFLICT (user_id) DO NOTHING"
	return tx.Exec(query).Error
}
