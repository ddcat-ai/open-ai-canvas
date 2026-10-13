package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

type profileTestHost struct{ nopHost }

func (profileTestHost) SettingsEncryptionKey() ([]byte, error) {
	return []byte("profile-test-key-32-bytes-long!!!"), nil
}

func newProfileTestService(t *testing.T) (*Service, *gorm.DB, *model.User, string) {
	t.Helper()
	s, db := newPasswordResetTestService(t)
	s.host = profileTestHost{}
	if err := db.AutoMigrate(&model.AuthVerification{}, &model.NotificationQuota{}, &model.UserIdentity{}, &model.OAuthState{}); err != nil {
		t.Fatal(err)
	}
	hash, err := HashPassword("old-password")
	if err != nil {
		t.Fatal(err)
	}
	u := &model.User{ID: "profile-user", Username: "profile-user", Email: "old@example.com", Status: model.UserStatusActive, PasswordHash: hash}
	if err := db.Create(u).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"session-one", "session-two"} {
		if err := db.Create(&model.AuthSession{ID: id, UserID: u.ID, TokenHash: HashToken("token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, db, u, "session-one.token"
}

func TestProfilePasswordRequiresCurrentCredentialsAndRevokesAllSessions(t *testing.T) {
	s, db, u, cookie := newProfileTestService(t)
	if err := s.ChangeProfilePassword(u, cookie, ProfilePasswordRequest{CurrentPassword: "wrong", NewPassword: "new-password"}); err == nil {
		t.Fatal("wrong password accepted")
	}
	if err := s.ChangeProfilePassword(u, cookie, ProfilePasswordRequest{CurrentPassword: "old-password", NewPassword: "new-password"}); err != nil {
		t.Fatal(err)
	}
	var updated model.User
	db.First(&updated, "id = ?", u.ID)
	if !verifyPassword("new-password", updated.PasswordHash) {
		t.Fatal("password not changed")
	}
	var count int64
	db.Model(&model.AuthSession{}).Where("user_id = ?", u.ID).Count(&count)
	if count != 0 {
		t.Fatal("sessions not revoked")
	}
	if err := s.ChangeProfilePassword(u, cookie, ProfilePasswordRequest{CurrentPassword: "old-password", NewPassword: "third-password"}); err == nil {
		t.Fatal("stale actor/session accepted")
	}
}

func TestProfileOAuthAccountNeedsRecentSameSessionReauthentication(t *testing.T) {
	s, db, u, cookie := newProfileTestService(t)
	db.Model(u).Update("password_hash", "")
	u.PasswordHash = ""
	if err := s.ChangeProfilePassword(u, cookie, ProfilePasswordRequest{NewPassword: "new-password"}); err == nil {
		t.Fatal("OAuth account accepted without reauthentication")
	}
	now := time.Now()
	db.Model(&model.AuthSession{}).Where("id = ?", "session-two").Update("reauthenticated_at", now)
	if err := s.ChangeProfilePassword(u, cookie, ProfilePasswordRequest{NewPassword: "new-password"}); err == nil {
		t.Fatal("another session reauthentication accepted")
	}
	expired := now.Add(-6 * time.Minute)
	db.Model(&model.AuthSession{}).Where("id = ?", "session-one").Update("reauthenticated_at", expired)
	if err := s.ChangeProfilePassword(u, cookie, ProfilePasswordRequest{NewPassword: "new-password"}); err == nil {
		t.Fatal("expired reauthentication accepted")
	}
	db.Model(&model.AuthSession{}).Where("id = ?", "session-one").Update("reauthenticated_at", now)
	if err := s.ChangeProfilePassword(u, cookie, ProfilePasswordRequest{NewPassword: "new-password"}); err != nil {
		t.Fatal(err)
	}
}

func TestProfileEmailTicketBoundToSessionAndReportsOldMailFailure(t *testing.T) {
	s, db, u, cookie := newProfileTestService(t)
	var code string
	s.SetMailSender(func(_ EmailSettingValue, to, subject, body string) error {
		if to == "new@external.example" {
			code = codeFromEmailBody(body)
			return nil
		}
		return errors.New("mail unavailable")
	})
	ticket, err := s.SendProfileEmailCode(context.Background(), u, cookie, ProfileEmailCodeRequest{Email: "new@external.example", CurrentPassword: "old-password"})
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != 6 {
		t.Fatal("missing code")
	}
	req := ProfileEmailChangeRequest{Ticket: ticket.Ticket, EmailCode: code, CurrentPassword: "old-password"}
	if _, err := s.ChangeProfileEmail(u, "session-two.token", req); err == nil {
		t.Fatal("another session used ticket")
	}
	result, err := s.ChangeProfileEmail(u, cookie, req)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Changed || result.NotificationStatus != "failed" {
		t.Fatalf("result %#v", result)
	}
	var updated model.User
	db.First(&updated, "id = ?", u.ID)
	if updated.Email != "new@external.example" || updated.EmailVerifiedAt == nil {
		t.Fatalf("updated user %#v", updated)
	}
	var count int64
	db.Model(&model.AuthSession{}).Where("user_id = ?", u.ID).Count(&count)
	if count != 0 {
		t.Fatal("sessions remain")
	}
	if _, err := s.ChangeProfileEmail(u, cookie, req); err == nil {
		t.Fatal("reused ticket accepted")
	}
}

func TestProfileEmailDisabledAndDuplicateAreRejected(t *testing.T) {
	s, db, u, cookie := newProfileTestService(t)
	db.Create(&model.User{ID: "other", Username: "other", Email: "used@example.com", Status: model.UserStatusActive})
	if _, err := s.SendProfileEmailCode(context.Background(), u, cookie, ProfileEmailCodeRequest{Email: "used@example.com", CurrentPassword: "old-password"}); err == nil {
		t.Fatal("duplicate email accepted")
	}
	db.Model(&model.SystemSetting{}).Where("key = ?", emailSettingKey).Update("value_json", `{"enabled":false}`)
	if _, err := s.SendProfileEmailCode(context.Background(), u, cookie, ProfileEmailCodeRequest{Email: "new@example.com", CurrentPassword: "old-password"}); err == nil {
		t.Fatal("disabled SMTP accepted")
	}
}

func TestProfileLinuxDOReauthenticationRequiresMatchingSubjectAndSession(t *testing.T) {
	for _, mode := range []string{"matching", "wrong-subject", "wrong-session", "expired-session"} {
		t.Run(mode, func(t *testing.T) {
			s, db, u, cookie := newProfileTestService(t)
			subject := "linked-subject"
			if mode == "wrong-subject" {
				subject = "another-person"
			}
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
			upstreamCalls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				upstreamCalls++
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					w.Write([]byte(`{"access_token":"test-access-token"}`))
					return
				}
				json.NewEncoder(w).Encode(map[string]string{"id": subject})
			}))
			defer server.Close()
			setting, err := json.Marshal(linuxDOSettingValue{Enabled: true, ClientID: "test", AuthorizationURL: server.URL + "/authorize", TokenURL: server.URL + "/token", UserInfoURL: server.URL + "/userinfo", RedirectURL: "http://localhost/callback"})
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.SystemSetting{Key: linuxDOSettingKey, ValueJSON: string(setting)}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.UserIdentity{ID: "identity", UserID: u.ID, Provider: "linuxdo", Subject: "linked-subject"}).Error; err != nil {
				t.Fatal(err)
			}
			location, err := s.BeginLinuxDOReauthentication(u, cookie)
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := url.Parse(location)
			if err != nil {
				t.Fatal(err)
			}
			state := parsed.Query().Get("state")
			isReauth, err := s.LinuxDOReauthenticationState(state)
			if err != nil || !isReauth {
				t.Fatalf("state marker %v %v", isReauth, err)
			}
			if mode == "wrong-session" {
				cookie = "session-two.token"
			}
			if mode == "expired-session" {
				db.Model(&model.AuthSession{}).Where("id = ?", "session-one").Update("expires_at", time.Now().Add(-time.Minute))
			}
			result, err := s.CompleteLinuxDOLogin(state, "test-code", cookie)
			if mode == "matching" {
				if err != nil {
					t.Fatal(err)
				}
				if !result.Reauthenticated || result.Session != nil || result.Next != "/settings?section=profile&reauth=success" {
					t.Fatalf("result %#v", result)
				}
			} else if err == nil {
				t.Fatal("invalid reauthentication accepted")
			}
			if (mode == "wrong-session" || mode == "expired-session") && upstreamCalls != 0 {
				t.Fatal("invalid session contacted provider")
			}
			var session model.AuthSession
			if err := db.First(&session, "id = ?", "session-one").Error; err != nil {
				t.Fatal(err)
			}
			if (session.ReauthenticatedAt != nil) != (mode == "matching") {
				t.Fatal("incorrect reauthentication marker")
			}
			var count int64
			db.Model(&model.AuthSession{}).Count(&count)
			if count != 2 {
				t.Fatal("reauthentication created a session")
			}
			db.Model(&model.User{}).Count(&count)
			if count != 1 {
				t.Fatal("reauthentication created a user")
			}
			if _, err := s.CompleteLinuxDOLogin(state, "test-code", cookie); err == nil {
				t.Fatal("OAuth state reused")
			}
		})
	}
}
