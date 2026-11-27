package repository

import (
	"context"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"path/filepath"
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestDatabaseBackupWholeSQLiteAndLease(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "live.sqlite")+"?_journal_mode=WAL"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	if err = db.AutoMigrate(&model.SystemSetting{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.ModelChannel{}, &model.ChannelModel{}); err != nil {
		t.Fatal(err)
	}
	values := []any{
		&model.SystemSetting{Key: "operations", ValueJSON: `{"discount":0.9}`},
		&model.CreditAccount{UserID: "customer", AvailableMicrocredits: 123456789, ReservedMicrocredits: 3456},
		&model.CreditLedgerEntry{ID: "ledger", UserID: "customer", AmountMicrocredits: 123456789},
		&model.ModelChannel{ID: "channel", Name: "restore-channel", APIKey: "test-only-secret", ModelsJSON: `["model-a"]`},
	}
	for _, v := range values {
		if err = db.Create(v).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Unknown future/plugin tables must be preserved without adding them to an allowlist.
	if err = db.Exec("CREATE TABLE extension_business (id TEXT PRIMARY KEY, value TEXT)").Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Exec("INSERT INTO extension_business VALUES ('sentinel','future-business')").Error; err != nil {
		t.Fatal(err)
	}
	r := New(db)
	now := time.Now().UTC()
	if ok, err := r.ClaimDatabaseBackup("first", now); err != nil || !ok {
		t.Fatalf("claim: %v %v", ok, err)
	}
	if ok, err := r.ClaimDatabaseBackup("second", now); err != nil || ok {
		t.Fatalf("concurrent: %v %v", ok, err)
	}
	if err := r.ReleaseDatabaseBackup("wrong"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := r.ClaimDatabaseBackup("third", now); ok {
		t.Fatal("wrong token released lock")
	}
	if ok, err := r.ClaimDatabaseBackup("takeover", now.Add(31*time.Minute)); err != nil || !ok {
		t.Fatalf("stale lease: %v %v", ok, err)
	}
	if err := r.ReleaseDatabaseBackup("first"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := r.ClaimDatabaseBackup("blocked", now.Add(31*time.Minute)); ok {
		t.Fatal("old owner released new lease")
	}
	if ok, err := r.ClaimDatabaseBackupDay("2026-10-28"); err != nil || !ok {
		t.Fatal("first day claim failed")
	}
	if ok, err := r.ClaimDatabaseBackupDay("2026-10-28"); err != nil || ok {
		t.Fatal("duplicate day claim succeeded")
	}
	target := filepath.Join(t.TempDir(), "restore.sqlite")
	if err := r.SnapshotDatabase(context.Background(), target); err != nil {
		t.Fatal(err)
	}
	restored, err := gorm.Open(sqlite.Open(target), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	restoredSQL, err := restored.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer restoredSQL.Close()
	var integrity string
	if err = restored.Raw("PRAGMA integrity_check").Scan(&integrity).Error; err != nil || integrity != "ok" {
		t.Fatalf("integrity: %s %v", integrity, err)
	}
	var account model.CreditAccount
	if err = restored.First(&account, "user_id = ?", "customer").Error; err != nil || account.AvailableMicrocredits != 123456789 || account.ReservedMicrocredits != 3456 {
		t.Fatalf("credit restore failed: %+v %v", account, err)
	}
	var channel model.ModelChannel
	if err = restored.First(&channel, "id = ?", "channel").Error; err != nil || channel.APIKey != "test-only-secret" || channel.ModelsJSON != `["model-a"]` {
		t.Fatal("channel configuration lost")
	}
	var ledger model.CreditLedgerEntry
	if err = restored.First(&ledger, "id = ?", "ledger").Error; err != nil || ledger.AmountMicrocredits != 123456789 {
		t.Fatal("credit ledger lost")
	}
	originalTables, err := r.DatabaseBackupTables()
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range originalTables {
		if !restored.Migrator().HasTable(table) {
			t.Fatalf("missing table %s", table)
		}
	}
	var value string
	if err = restored.Raw("SELECT value FROM extension_business WHERE id = 'sentinel'").Scan(&value).Error; err != nil || value != "future-business" {
		t.Fatal("extension data lost")
	}
}
