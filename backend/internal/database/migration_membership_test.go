package database

import (
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

// The legacy fixtures record already-applied migrations instead of replaying them.
// Provide the existing tables the subsequent additive membership migration alters.
func createPreMembershipTables(t *testing.T, db *gorm.DB) {
	t.Helper()
	for _, sql := range []string{
		"CREATE TABLE users (id text PRIMARY KEY,user_group text)",
		"CREATE TABLE topup_products (id text PRIMARY KEY,kind text)",
		"CREATE TABLE payment_orders (id text PRIMARY KEY,product_kind text,credits_microcredits bigint)",
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func TestMembershipMigrationPreservesExistingPurchases(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	createPreMembershipTables(t, db)
	for _, sql := range []string{
		"INSERT INTO users VALUES ('partner','studio')",
		"INSERT INTO topup_products VALUES ('space','storage')",
		"INSERT INTO payment_orders VALUES ('paid','credits',25000000)",
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := migrateMembershipCards(db); err != nil {
			t.Fatal(err)
		}
	}
	var user model.User
	var order model.PaymentOrder
	var product model.TopupProduct
	if err := db.Take(&user).Error; err != nil || user.UserGroup != "studio" || user.MembershipUntil != nil {
		t.Fatalf("user: %+v %v", user, err)
	}
	if err := db.Take(&order).Error; err != nil || order.CreditsMicrocredits != 25000000 || order.MembershipEndsAt != nil || order.ProductKind != model.TopupProductKindCredits {
		t.Fatalf("order: %+v %v", order, err)
	}
	if err := db.Take(&product).Error; err != nil || product.Kind != model.TopupProductKindStorage || product.MembershipGroup != "" {
		t.Fatalf("product: %+v %v", product, err)
	}
}
