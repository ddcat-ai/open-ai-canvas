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

func TestTeamMigrationPreservesPersonalPayerAndHolds(t *testing.T) {
	t.Run("SQLite", func(t *testing.T) {
		db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "v105.db")})
		if err != nil {
			t.Fatal(err)
		}
		conn, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		verifyTeamMigration(t, db)
	})
	t.Run("PostgreSQL", func(t *testing.T) {
		dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
		if dsn == "" {
			t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
		}
		base, err := Open(Config{Driver: "postgres", DSN: dsn})
		if err != nil {
			t.Fatal(err)
		}
		conn, err := base.DB()
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		schema := fmt.Sprintf("test_team_migration_%d", time.Now().UnixNano())
		if err = base.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		defer func() {
			if err := base.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
				t.Error(err)
			}
		}()
		dsn, err = postgresDSNWithSearchPath(dsn, schema)
		if err != nil {
			t.Fatal(err)
		}
		db, err := Open(Config{Driver: "postgres", DSN: dsn})
		if err != nil {
			t.Fatal(err)
		}
		isolated, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		defer isolated.Close()
		verifyTeamMigration(t, db)
	})
}

func TestTeamMigrationKeepsExistingSpaceAsRoot(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "v106.db")})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if err := db.Exec(`CREATE TABLE teams (id varchar(36) PRIMARY KEY, name varchar(80) NOT NULL, owner_user_id varchar(36) NOT NULL, status varchar(16) NOT NULL, created_at datetime, updated_at datetime)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO teams (id,name,owner_user_id,status) VALUES ('existing','原工作室','owner','active')`).Error; err != nil {
		t.Fatal(err)
	}
	for _, step := range schemaMigrations {
		if step.version == 107 {
			if err := db.Transaction(step.apply); err != nil {
				t.Fatal(err)
			}
		}
	}
	var roots int64
	if err := db.Model(&model.Team{}).Where("id = ? AND owner_user_id = ? AND name = ? AND parent_id = ''", "existing", "owner", "原工作室").Count(&roots).Error; err != nil || roots != 1 {
		t.Fatalf("original space not preserved as root: count=%d err=%v", roots, err)
	}
}

func verifyTeamMigration(t *testing.T, db *gorm.DB) {
	t.Helper()
	for _, sql := range []string{
		`CREATE TABLE credit_accounts (user_id varchar(36) PRIMARY KEY, available_microcredits bigint, reserved_microcredits bigint, version bigint, created_at timestamp, updated_at timestamp)`,
		`INSERT INTO credit_accounts VALUES ('before',230,75,7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('debt',-8,0,3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
		`CREATE TABLE billing_orders (id varchar(36) PRIMARY KEY, user_id varchar(36), amount_microcredits bigint, reserved_amount_microcredits bigint, status varchar(24))`,
		`INSERT INTO billing_orders VALUES ('running','before',75,75,'running')`,
		`CREATE TABLE credit_ledger_entries (id varchar(36) PRIMARY KEY, user_id varchar(36), amount_microcredits bigint)`,
		`INSERT INTO credit_ledger_entries VALUES ('entry','before',75)`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Transaction(migrateTeamWorkspaces); err != nil {
		t.Fatal(err)
	}
	for _, pool := range []string{"team-a", "team-b"} {
		if err := db.Create(&model.CreditAccount{Kind: model.CreditAccountTeamPool, TeamID: pool}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Transaction(migrateTeamWorkspaces); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	for _, expected := range []model.CreditAccount{{UserID: "before", AvailableMicrocredits: 230, ReservedMicrocredits: 75, Version: 7}, {UserID: "debt", AvailableMicrocredits: -8, Version: 3}} {
		var account model.CreditAccount
		if err := db.Where("user_id = ?", expected.UserID).Take(&account).Error; err != nil {
			t.Fatal(err)
		}
		if account.ID != model.PersonalCreditAccountID(expected.UserID) || account.Kind != model.CreditAccountPersonal || account.AvailableMicrocredits != expected.AvailableMicrocredits || account.ReservedMicrocredits != expected.ReservedMicrocredits || account.Version != expected.Version {
			t.Fatalf("changed personal balance: %+v", account)
		}
	}
	var order model.BillingOrder
	var entry model.CreditLedgerEntry
	if err := db.First(&order, "id = ?", "running").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&entry, "id = ?", "entry").Error; err != nil {
		t.Fatal(err)
	}
	if order.BillingAccountID != model.PersonalCreditAccountID("before") || order.Status != model.BillingStatusRunning || order.ReservedAmountMicrocredits != 75 || entry.AccountID != order.BillingAccountID || entry.AmountMicrocredits != 75 {
		t.Fatalf("history changed: order=%+v entry=%+v", order, entry)
	}
}
