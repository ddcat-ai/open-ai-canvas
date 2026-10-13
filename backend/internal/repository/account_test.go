package repository

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func profileRepositoryDB(t *testing.T) (*gorm.DB, string) {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "profile.db") + "?_busy_timeout=5000&_journal_mode=WAL"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.AuthVerification{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db, dsn
}

func TestProfilePasswordConcurrentChangeUsesCredentialCompare(t *testing.T) {
	db, dsn := profileRepositoryDB(t)
	now := time.Now()
	u := &model.User{ID: "one", Username: "one", Status: model.UserStatusActive, PasswordHash: "old-hash"}
	session := &model.AuthSession{ID: "session", UserID: u.ID, TokenHash: "token-hash", ExpiresAt: now.Add(time.Hour)}
	if err := db.Create(u).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(session).Error; err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, newHash := range []string{"new-one", "new-two"} {
		peer, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, _ := peer.DB()
		t.Cleanup(func() { _ = sqlDB.Close() })
		wg.Add(1)
		go func() { defer wg.Done(); <-start; results <- New(peer).ChangeProfilePassword(u, session, newHash, now) }()
	}
	close(start)
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else if !errors.Is(err, ErrProfileAuthorization) {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("successful changes=%d", success)
	}
	var count int64
	db.Model(&model.AuthSession{}).Count(&count)
	if count != 0 {
		t.Fatal("session remained")
	}
}

func TestLinuxDOReauthenticationPersistsAcrossSessionTimezones(t *testing.T) {
	for _, offset := range []int{-12, 14} {
		t.Run(time.FixedZone("session", offset*3600).String(), func(t *testing.T) {
			db, _ := profileRepositoryDB(t)
			now := time.Now().UTC()
			u := &model.User{ID: "one", Username: "one", Status: model.UserStatusActive}
			session := &model.AuthSession{ID: "session", UserID: u.ID, TokenHash: "token", ExpiresAt: now.Add(time.Hour).In(time.FixedZone("session", offset*3600))}
			identity := &model.UserIdentity{ID: "identity", UserID: u.ID, Provider: "linuxdo", Subject: "subject"}
			for _, row := range []any{u, session, identity} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := New(db).ReauthenticateLinuxDOSession(u, session, identity.Subject, now); err != nil {
				t.Fatal(err)
			}
			var stored model.AuthSession
			if err := db.First(&stored, "id = ?", session.ID).Error; err != nil {
				t.Fatal(err)
			}
			if stored.ReauthenticatedAt == nil || !stored.ReauthenticatedAt.Equal(now) {
				t.Fatal("successful reauthentication did not persist its timestamp")
			}
		})
	}
}

func TestProfileEmailConcurrentCanonicalCollisionDoesNotConsumeLoser(t *testing.T) {
	db, dsn := profileRepositoryDB(t)
	now := time.Now()
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i, id := range []string{"one", "two"} {
		u := &model.User{ID: id, Username: id, Status: model.UserStatusActive, PasswordHash: "hash"}
		session := &model.AuthSession{ID: id, UserID: id, TokenHash: "token", ExpiresAt: now.Add(time.Hour)}
		v := &model.AuthVerification{ID: id, UserID: id, SessionID: id, CredentialHash: ProfileCredentialHash("hash"), Purpose: "profile_email", Email: []string{"a.b+first@gmail.com", "ab+second@googlemail.com"}[i], Ready: true, ExpiresAt: now.Add(time.Hour)}
		for _, row := range []any{u, session, v} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
		peer, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, _ := peer.DB()
		t.Cleanup(func() { _ = sqlDB.Close() })
		wg.Add(1)
		go func() { defer wg.Done(); <-start; results <- New(peer).ChangeProfileEmail(u, session, v, now) }()
	}
	close(start)
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		} else if err.Error() != "邮箱已被注册" {
			t.Fatal(err)
		}
	}
	if success != 1 {
		t.Fatalf("successful changes=%d", success)
	}
	var count int64
	db.Model(&model.AuthVerification{}).Where("used_at IS NOT NULL").Count(&count)
	if count != 1 {
		t.Fatalf("consumed=%d", count)
	}
	db.Model(&model.AuthSession{}).Count(&count)
	if count != 1 {
		t.Fatalf("remaining sessions=%d", count)
	}
}

func TestProfileEmailRollbackWhenSessionRevocationFails(t *testing.T) {
	db, _ := profileRepositoryDB(t)
	now := time.Now()
	u := &model.User{ID: "one", Username: "one", Email: "old@example.com", PasswordHash: "hash", Status: model.UserStatusActive}
	session := &model.AuthSession{ID: "session", UserID: u.ID, TokenHash: "token", ExpiresAt: now.Add(time.Hour)}
	v := &model.AuthVerification{ID: "ticket", Purpose: "profile_email", UserID: u.ID, SessionID: session.ID, Email: "new@example.com", CredentialHash: ProfileCredentialHash("hash"), Ready: true, ExpiresAt: now.Add(time.Hour)}
	for _, row := range []any{u, session, v} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`CREATE TRIGGER fail_revoke BEFORE DELETE ON auth_sessions BEGIN SELECT RAISE(ABORT, 'revocation failed'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if err := New(db).ChangeProfileEmail(u, session, v, now); err == nil {
		t.Fatal("revocation failure ignored")
	}
	var stored model.User
	if err := db.First(&stored, "id = ?", u.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Email != u.Email || stored.EmailVerifiedAt != nil {
		t.Fatal("email update not rolled back")
	}
	var ticket model.AuthVerification
	if err := db.First(&ticket, "id = ?", v.ID).Error; err != nil {
		t.Fatal(err)
	}
	if ticket.UsedAt != nil {
		t.Fatal("ticket consumption not rolled back")
	}
}

func TestProfileCredentialChangeRejectsInFlightLoginSession(t *testing.T) {
	db, _ := profileRepositoryDB(t)
	u := &model.User{ID: "one", Username: "one", Status: model.UserStatusActive, PasswordHash: "old-hash", Email: "old@example.com"}
	if err := db.Create(u).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", u.ID).Update("password_hash", "new-hash").Error; err != nil {
		t.Fatal(err)
	}
	session := &model.AuthSession{ID: "new-session", UserID: u.ID, TokenHash: "token", ExpiresAt: time.Now().Add(time.Hour)}
	if err := New(db).CreateAuthSessionForUser(u, session); !errors.Is(err, ErrProfileAuthorization) {
		t.Fatalf("stale login accepted: %v", err)
	}
	var count int64
	db.Model(&model.AuthSession{}).Count(&count)
	if count != 0 {
		t.Fatal("stale login inserted session")
	}
}

func TestProfilePasswordRevocationSerializesWithConcurrentSessionIssuance(t *testing.T) {
	db, dsn := profileRepositoryDB(t)
	now := time.Now()
	u := &model.User{ID: "one", Username: "one", Status: model.UserStatusActive, PasswordHash: "old-hash"}
	oldSession := &model.AuthSession{ID: "old-session", UserID: u.ID, TokenHash: "old-token", ExpiresAt: now.Add(time.Hour)}
	if err := db.Create(u).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(oldSession).Error; err != nil {
		t.Fatal(err)
	}
	peer, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := peer.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	start := make(chan struct{})
	issued := make(chan error, 1)
	changed := make(chan error, 1)
	go func() {
		<-start
		issued <- New(peer).CreateAuthSessionForUser(u, &model.AuthSession{ID: "new-session", UserID: u.ID, TokenHash: "new-token", ExpiresAt: now.Add(time.Hour)})
	}()
	go func() { <-start; changed <- New(db).ChangeProfilePassword(u, oldSession, "new-hash", now) }()
	close(start)
	if err := <-changed; err != nil {
		t.Fatal(err)
	}
	if err := <-issued; err != nil && !errors.Is(err, ErrProfileAuthorization) {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.AuthSession{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("sessions surviving concurrent revocation=%d", count)
	}
}
