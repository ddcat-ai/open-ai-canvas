package database

import (
	"bytes"
	"testing"
	"yingce/backend/internal/model"
)

func TestProfileMigrationUpgradesLegacyIdentityRows(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, email TEXT, password_hash TEXT, status TEXT)`,
		`INSERT INTO users VALUES ('legacy','legacy','legacy@example.com','preserved-hash','active')`,
		`CREATE TABLE auth_sessions (id TEXT PRIMARY KEY,user_id TEXT,token_hash TEXT,expires_at DATETIME)`,
		`INSERT INTO auth_sessions VALUES ('legacy-session','legacy','preserved-token','2099-01-01')`,
		`CREATE TABLE o_auth_states (id TEXT PRIMARY KEY,provider TEXT,state_hash TEXT)`,
		`INSERT INTO o_auth_states VALUES ('legacy-state','linuxdo','preserved-state')`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	var migration *migration
	for i := range schemaMigrations {
		if schemaMigrations[i].version == 51 {
			migration = &schemaMigrations[i]
		}
	}
	if migration == nil {
		t.Fatal("profile migration absent")
	}
	for i := 0; i < 2; i++ {
		if err := db.Transaction(migration.apply); err != nil {
			t.Fatal(err)
		}
	}
	for _, field := range []string{"AvatarMode", "AvatarVersion"} {
		if !db.Migrator().HasColumn(&model.User{}, field) {
			t.Fatalf("missing %s", field)
		}
	}
	if !db.Migrator().HasColumn(&model.AuthSession{}, "ReauthenticatedAt") || !db.Migrator().HasColumn(&model.OAuthState{}, "ReauthUserID") || !db.Migrator().HasColumn(&model.OAuthState{}, "ReauthSessionID") || !db.Migrator().HasColumn(&model.AuthVerification{}, "SessionID") || !db.Migrator().HasColumn(&model.AuthVerification{}, "CredentialHash") || !db.Migrator().HasTable(&model.UserAvatar{}) {
		t.Fatal("profile schema incomplete")
	}
	var user model.User
	var session model.AuthSession
	var state model.OAuthState
	if err := db.First(&user, "id = ?", "legacy").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&session, "id = ?", "legacy-session").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&state, "id = ?", "legacy-state").Error; err != nil {
		t.Fatal(err)
	}
	if user.PasswordHash != "preserved-hash" || user.Email != "legacy@example.com" || session.TokenHash != "preserved-token" || session.ReauthenticatedAt != nil || state.StateHash != "preserved-state" || state.ReauthUserID != "" || state.ReauthSessionID != "" {
		t.Fatal("legacy credentials or verification changed")
	}
	for _, m := range Models() {
		if _, ok := m.(*model.UserAvatar); ok {
			return
		}
	}
	t.Fatal("avatar missing from Models")
}

func TestAvatarPresetMigrationUpgradesV51WithoutChangingUsersOrBlobs(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	// Reconstruct the already applied v51 shape and migration ledger. The new
	// migration must add one column without replaying or changing v51 metadata.
	if err := db.Migrator().DropColumn(&model.User{}, "AvatarPreset"); err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&schemaMigration{}, "version = ?", 52).Error; err != nil {
		t.Fatal(err)
	}
	var v51Before schemaMigration
	if err := db.First(&v51Before, "version = ?", 51).Error; err != nil {
		t.Fatal(err)
	}
	if v51Before.Name != "personal_profile_security" || v51Before.Checksum != "sha256:personal-profile-security-v51-20261012" {
		t.Fatal("existing v51 identity changed")
	}
	user := model.User{ID: "preset-migration-user", Username: "preset-user", Email: "preset@example.com", DisplayName: "Creator", PasswordHash: "preserved-hash", Status: model.UserStatusActive, AvatarMode: "custom", AvatarVersion: "preserved-avatar-version"}
	if err := db.Omit("AvatarPreset").Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	payload := []byte("preserved-avatar-payload")
	if err := db.Create(&model.UserAvatar{UserID: user.ID, Data: payload}).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	if !db.Migrator().HasColumn(&model.User{}, "AvatarPreset") {
		t.Fatal("missing avatar preset column")
	}
	var migrated model.User
	var avatar model.UserAvatar
	var v51After schemaMigration
	var v52 schemaMigration
	if err := db.First(&migrated, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&avatar, "user_id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&v51After, "version = ?", 51).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&v52, "version = ?", 52).Error; err != nil {
		t.Fatal(err)
	}
	if migrated.PasswordHash != user.PasswordHash || migrated.Email != user.Email || migrated.DisplayName != user.DisplayName || migrated.AvatarMode != "custom" || migrated.AvatarVersion != user.AvatarVersion || migrated.AvatarPreset != "" || !bytes.Equal(avatar.Data, payload) {
		t.Fatal("v52 migration changed existing profile or custom avatar")
	}
	if v51After != v51Before || v52.Name != "user_avatar_presets" || v52.Checksum == v51Before.Checksum {
		t.Fatal("migration identity was rewritten or new checksum was reused")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("current schema status: %#v, %v", status, err)
	}
}
