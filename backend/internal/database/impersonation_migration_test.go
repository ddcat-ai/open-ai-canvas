package database

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestMigrateSchemaV20PreservesExistingSessions(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropIndex(&model.AuthSession{}, "ImpersonatorUserID"); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.AuthSession{}, "ImpersonatorUserID"); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version = ?", 20).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO auth_sessions (id, user_id, token_hash) VALUES (?, ?, ?)", "existing", "user", "hash").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	var session model.AuthSession
	if err := db.First(&session, "id = ?", "existing").Error; err != nil {
		t.Fatal(err)
	}
	if session.ImpersonatorUserID != "" || session.UserID != "user" || session.TokenHash != "hash" {
		t.Fatalf("changed existing session: %#v", session)
	}
	if !db.Migrator().HasIndex(&model.AuthSession{}, "ImpersonatorUserID") {
		t.Fatal("missing impersonator index")
	}
	if err := db.Exec("UPDATE auth_sessions SET impersonator_user_id = NULL WHERE id = ?", "existing").Error; err == nil {
		t.Fatal("impersonator must not be NULL")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("schema status: %+v, %v", status, err)
	}
}
