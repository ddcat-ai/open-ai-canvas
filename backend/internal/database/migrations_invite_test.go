package database

import (
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func TestInviteMigrationPreservesSchema57DataAndMigrationHistory(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = connection.Close() })
	assertInviteMigrationProtectsHistoricalData(t, db)
}

func TestPostgresInviteMigrationPreservesSchema57Data(t *testing.T) {
	dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	base, err := Open(Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatal(err)
	}
	baseSQL, err := base.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer baseSQL.Close()
	schemaName := fmt.Sprintf("invite_migration_%d", time.Now().UnixNano())
	if err := base.Exec(`CREATE SCHEMA "` + schemaName + `"`).Error; err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := base.Exec(`DROP SCHEMA IF EXISTS "` + schemaName + `" CASCADE`).Error; err != nil {
			t.Errorf("drop test schema: %v", err)
		}
	}()
	testDSN, err := postgresDSNWithSearchPath(dsn, schemaName)
	if err != nil {
		t.Fatal(err)
	}
	db, err := Open(Config{Driver: "postgres", DSN: testDSN})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	assertInviteMigrationProtectsHistoricalData(t, db)
}

func assertInviteMigrationProtectsHistoricalData(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, user := range []model.User{
		{ID: "keep-admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		{ID: "keep-user", Username: "member", Role: model.UserRoleUser, Status: model.UserStatusActive},
	} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	account := model.CreditAccount{UserID: "keep-admin", AvailableMicrocredits: 110_000_000, ReservedMicrocredits: 5_000_000}
	bill := model.BillingOrder{ID: "bill", UserID: account.UserID, IdempotencyKey: "bill", Status: model.BillingStatusSettled, ActualAmountMicrocredits: 1234}
	ledger := model.CreditLedgerEntry{ID: "ledger", UserID: account.UserID, Type: model.CreditLedgerConsume,
		AmountMicrocredits: -1234, AvailableDeltaMicrocredits: -1234, AvailableAfterMicrocredits: account.AvailableMicrocredits,
		BillingOrderID: bill.ID, Note: "Historical charge"}
	canvas := model.CanvasProject{ID: "canvas", UserID: account.UserID, Title: "Keep canvas",
		PayloadJSON: `{"nodes":{},"connections":[]}`, Revision: 7}
	for _, item := range []any{&account, &bill, &ledger, &canvas} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.First(&account, "user_id = ?", account.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&ledger, "id = ?", ledger.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&canvas, "id = ?", canvas.ID).Error; err != nil {
		t.Fatal(err)
	}
	entities := []any{&model.InviteRecord{}, &model.RewardAccount{}, &model.InviteRewardRecord{},
		&model.WithdrawRequest{}, &model.WithdrawAccount{}, &model.TransferRecord{}}
	for _, entity := range entities {
		if err := db.Migrator().DropTable(entity); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec("DROP INDEX IF EXISTS idx_users_invite_code_nonempty").Error; err != nil {
		t.Fatal(err)
	}
	for _, entity := range []any{&model.User{}, &model.OAuthState{}} {
		if err := db.Migrator().DropColumn(entity, "InviteCode"); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Where("version = ?", 58).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	var before []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	var issuedCodes []string
	for attempt := 0; attempt < 2; attempt++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
		if err := RequireSchemaVersion(db); err != nil {
			t.Fatal(err)
		}
		var after []schemaMigration
		if err := db.Where("version <= ?", 57).Order("version").Find(&after).Error; err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(before, after) {
			t.Fatal("schema 1-57 history was rewritten")
		}
		var codes []string
		if err := db.Model(&model.User{}).Order("id").Pluck("invite_code", &codes).Error; err != nil {
			t.Fatal(err)
		}
		if len(codes) != 2 || len(codes[0]) != 8 || len(codes[1]) != 8 || codes[0] == codes[1] {
			t.Fatalf("invalid backfilled invite codes: %v", codes)
		}
		if attempt == 0 {
			issuedCodes = codes
		} else if !reflect.DeepEqual(issuedCodes, codes) {
			t.Fatal("rerunning migrations changed invite codes")
		}
		var migratedAccount model.CreditAccount
		if err := db.First(&migratedAccount, "user_id = ?", account.UserID).Error; err != nil ||
			!reflect.DeepEqual(account, migratedAccount) {
			t.Fatalf("credit account changed: %+v err=%v", migratedAccount, err)
		}
		var migratedLedger model.CreditLedgerEntry
		if err := db.First(&migratedLedger, "id = ?", ledger.ID).Error; err != nil ||
			!reflect.DeepEqual(ledger, migratedLedger) {
			t.Fatalf("credit ledger changed: %+v err=%v", migratedLedger, err)
		}
		var migratedCanvas model.CanvasProject
		if err := db.First(&migratedCanvas, "id = ?", canvas.ID).Error; err != nil ||
			!reflect.DeepEqual(canvas, migratedCanvas) {
			t.Fatalf("canvas changed: %+v err=%v", migratedCanvas, err)
		}
	}
	for _, entity := range entities {
		if !db.Migrator().HasTable(entity) {
			t.Fatalf("missing invite table %T", entity)
		}
	}
	if err := db.Model(&model.User{}).Where("id = ?", "keep-user").UpdateColumn("invite_code", issuedCodes[0]).Error; err == nil {
		t.Fatal("duplicate invite codes were accepted")
	}
}
