package database

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestMigrateSchemaV25PreservesHistoricalBillingOrders(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-video-token-formula-v25?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"VideoFormulaTokens", "UsageSource"} {
		if err := db.Migrator().DropColumn(&model.BillingOrder{}, field); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`INSERT INTO billing_orders (id, user_id, idempotency_key, capability, billing_mode, quantity, amount_microcredits, output_tokens, usage_available, status) VALUES ('legacy', 'user', 'task', 'video', 'token', 118800, 1900800, 108000, true, 'settled')`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 25).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatalf("upgrade to v25: %v", err)
		}
	}
	var order model.BillingOrder
	if err := db.First(&order, "id = ?", "legacy").Error; err != nil {
		t.Fatal(err)
	}
	if order.VideoFormulaTokens != 0 || order.UsageSource != "" || order.Quantity != 118800 || order.AmountMicrocredits != 1900800 || order.OutputTokens != 108000 || !order.UsageAvailable || order.Status != model.BillingStatusSettled {
		t.Fatalf("historical billing changed during migration: %+v", order)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("schema not ready after upgrade: %+v, %v", status, err)
	}
}
