package database

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestOAuthStateAcceptedTermsMigration(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`CREATE TABLE o_auth_states (id TEXT PRIMARY KEY, provider TEXT, state_hash TEXT, code_verifier TEXT, next_path TEXT)`,
		`INSERT INTO o_auth_states VALUES ('legacy', 'linuxdo', 'old-hash', 'old-verifier', '/create')`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := migrateOAuthStateAcceptedTerms(db); err != nil {
			t.Fatal(err)
		}
	}
	var state model.OAuthState
	if err := db.First(&state, "id = ?", "legacy").Error; err != nil {
		t.Fatal(err)
	}
	if state.AcceptedTerms || state.Provider != "linuxdo" || state.StateHash != "old-hash" || state.CodeVerifier != "old-verifier" || state.NextPath != "/create" {
		t.Fatalf("migration changed existing state: %#v", state)
	}
	if err := db.Exec(`INSERT INTO o_auth_states (id) VALUES ('new-state')`).Error; err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.OAuthState{}).Where("accepted_terms = ?", false).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("default consent count=%d err=%v", count, err)
	}
	if err := db.Model(&state).Update("accepted_terms", true).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateOAuthStateAcceptedTerms(db); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&state, "id = ?", "legacy").Error; err != nil || !state.AcceptedTerms {
		t.Fatalf("repeat migration lost saved consent: %#v err=%v", state, err)
	}
}
