package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestMigrateSchemaV80BackfillsPaymentOrderCharge(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-payment-order-charge-v80?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"ChargeAmountFen", "ChargeCurrency", "ExchangeRateMicros", "PaymentMethod"} {
		if err := db.Migrator().DropColumn(&model.PaymentOrder{}, field); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`INSERT INTO payment_orders (id, user_id, idempotency_key, merchant_order_no, amount_fen, currency, status) VALUES ('legacy', 'user', 'key', 'merchant', 1234, 'CNY', 'credited')`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 80).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("upgrade from v79: %v", err)
	}
	var order model.PaymentOrder
	if err := db.First(&order, "id = ?", "legacy").Error; err != nil {
		t.Fatal(err)
	}
	if order.ChargeAmountFen != 1234 || order.ChargeCurrency != "CNY" || order.ExchangeRateMicros != 0 || order.PaymentMethod != "" {
		t.Fatalf("legacy order charge snapshot = %+v", order)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected upgraded schema status: %+v, %v", status, err)
	}
}
