package auth

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"

	"gorm.io/gorm"
)

// Commit the administrator's change after the login read, before its user update.
func disableBeforeLoginWrite(t *testing.T, db *gorm.DB, userID string) *bool {
	t.Helper()
	fired := false
	if err := db.Callback().Update().Before("gorm:begin_transaction").Register("test:disable_before_login_write", func(tx *gorm.DB) {
		if fired || tx.Statement.Schema == nil || tx.Statement.Schema.Table != "users" {
			return
		}
		fired = true
		if err := db.Exec("UPDATE users SET status = ?, display_name = ? WHERE id = ?", model.UserStatusDisabled, "Admin Edit", userID).Error; err != nil {
			tx.AddError(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	return &fired
}

func assertLoginPreservesDisable(t *testing.T, svc *Service, db *gorm.DB, fired *bool, result *AuthSessionResult) {
	t.Helper()
	if !*fired {
		t.Fatal("concurrent disable was not injected")
	}
	var user model.User
	if err := db.First(&user, "id = ?", "member").Error; err != nil {
		t.Fatal(err)
	}
	if user.Status != model.UserStatusDisabled {
		t.Errorf("status after login = %q, want disabled", user.Status)
	}
	if user.DisplayName != "Admin Edit" {
		t.Errorf("display name after login = %q, want Admin Edit", user.DisplayName)
	}
	if user.LastLoginAt == nil || user.UpdatedAt.Before(*user.LastLoginAt) {
		t.Error("login timestamps were not updated")
	}
	if _, err := svc.CurrentUser(result.Session); err == nil {
		t.Error("disabled user can use the completed login session")
	}
}

func TestPasswordLoginPreservesConcurrentDisable(t *testing.T) {
	svc, db := newRegistrationTestService(t)
	hash, err := HashPassword("password")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "member", Username: "member", DisplayName: "Before", PasswordHash: hash, Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	fired := disableBeforeLoginWrite(t, db, "member")
	result, err := svc.Login(LoginRequest{Username: "member", Password: "password"})
	if err != nil {
		t.Fatal(err)
	}
	assertLoginPreservesDisable(t, svc, db, fired, result)
}

func TestLinuxDOLoginPreservesConcurrentDisable(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	// Exercise the OAuth HTTP path over an in-memory connection, without sockets.
	transport := outbound.OutboundHTTPClient(time.Second).Transport.(*http.Transport)
	transport.CloseIdleConnections()
	previousDial := transport.DialContext
	transport.DialContext = func(context.Context, string, string) (net.Conn, error) {
		client, server := net.Pipe()
		go func() {
			defer server.Close()
			req, err := http.ReadRequest(bufio.NewReader(server))
			if err != nil {
				t.Error(err)
				return
			}
			defer req.Body.Close()
			if _, err := io.Copy(io.Discard, req.Body); err != nil {
				t.Error(err)
				return
			}
			body := `{"id":"42","username":"member"}`
			if req.URL.Path == "/token" {
				body = `{"access_token":"test-token"}`
			}
			_, _ = fmt.Fprintf(server, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(body), body)
		}()
		return client, nil
	}
	t.Cleanup(func() { transport.CloseIdleConnections(); transport.DialContext = previousDial })
	svc, db := newRegistrationTestService(t)
	if err := svc.repo.CreateOAuthUser(&model.User{ID: "member", Username: "member", DisplayName: "Before", Role: model.UserRoleUser, Status: model.UserStatusActive}, &model.UserIdentity{ID: "identity", UserID: "member", Provider: "linuxdo", Subject: "42"}); err != nil {
		t.Fatal(err)
	}
	setting, err := json.Marshal(linuxDOSettingValue{Enabled: true, ClientID: "client", TokenURL: "http://127.0.0.1/token", UserInfoURL: "http://127.0.0.1/profile"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: linuxDOSettingKey, ValueJSON: string(setting)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.OAuthState{ID: "state", Provider: "linuxdo", StateHash: HashToken("state-value"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	fired := disableBeforeLoginWrite(t, db, "member")
	result, err := svc.CompleteLinuxDOLogin("state-value", "code")
	if err != nil {
		t.Fatal(err)
	}
	assertLoginPreservesDisable(t, svc, db, fired, result.Session)
}
