package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestWechatMigrationSkipsMissingOAuthStateTable(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	for _, item := range schemaMigrations {
		if item.version != 102 || item.name != "wechat_oauth" {
			continue
		}
		for i := 0; i < 2; i++ {
			if err := db.Transaction(item.apply); err != nil {
				t.Fatal(err)
			}
		}
		if db.Migrator().HasTable(&model.OAuthState{}) {
			t.Fatal("column-only migration created an unrelated OAuth state table")
		}
		return
	}
	t.Fatal("wechat migration absent")
}

func TestWechatMigrationPreservesExistingOAuthState(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.Exec(`CREATE TABLE o_auth_states (id TEXT PRIMARY KEY, provider TEXT, state_hash TEXT, code_verifier TEXT, next_path TEXT, accepted_terms NUMERIC)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO o_auth_states VALUES ('legacy','linuxdo','hash','verifier','/create',1)`).Error; err != nil {
		t.Fatal(err)
	}
	var target migration
	for _, item := range schemaMigrations {
		if item.version == 102 && item.name == "wechat_oauth" {
			target = item
			break
		}
	}
	if target.apply == nil {
		t.Fatal("wechat migration absent")
	}
	for i := 0; i < 2; i++ {
		if err := target.apply(db); err != nil {
			t.Fatal(err)
		}
	}
	for _, field := range []string{"Purpose", "ClientID", "ProfileJSON"} {
		if !db.Migrator().HasColumn(&model.OAuthState{}, field) {
			t.Fatalf("missing OAuth state field %s", field)
		}
	}
	var state model.OAuthState
	if err := db.First(&state, "id = ?", "legacy").Error; err != nil {
		t.Fatal(err)
	}
	if state.ID != "legacy" || state.Provider != "linuxdo" || state.StateHash != "hash" || state.CodeVerifier != "verifier" || state.NextPath != "/create" || !state.AcceptedTerms || state.Purpose != "" || state.ProfileJSON != "" || state.ClientID != "" {
		t.Fatalf("legacy state changed %#v", state)
	}
}
