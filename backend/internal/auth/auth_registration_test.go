package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func newRegistrationTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	svc, db := newPasswordResetTestService(t)
	if err := db.AutoMigrate(&model.UserIdentity{}, &model.OAuthState{}, &model.CreditAccount{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return svc, db
}

func TestRegisterRequiresAcceptedTermsBeforeWriting(t *testing.T) {
	for _, payload := range []string{
		`{"username":"new-user","password":"password"}`,
		`{"username":"new-user","password":"password","acceptedTerms":false}`,
	} {
		svc, db := newRegistrationTestService(t)
		var req RegisterRequest
		if err := json.Unmarshal([]byte(payload), &req); err != nil {
			t.Fatal(err)
		}
		_, err := svc.Register(req)
		var authErr *AuthError
		if !errors.As(err, &authErr) || authErr.Status != 400 || authErr.Message != "请先同意影策服务协议" {
			t.Fatalf("Register() error = %v", err)
		}
		for _, entity := range []any{&model.User{}, &model.AuthSession{}} {
			var count int64
			if err := db.Model(entity).Count(&count).Error; err != nil || count != 0 {
				t.Fatalf("unaccepted registration wrote %T: count=%d err=%v", entity, count, err)
			}
		}
	}
}

func TestRegisterAcceptedTermsCreatesFirstAdmin(t *testing.T) {
	svc, _ := newRegistrationTestService(t)
	result, err := svc.Register(RegisterRequest{Username: "new-user", Password: "password", AcceptedTerms: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.User.Username != "new-user" || result.User.Role != model.UserRoleAdmin || result.Session == "" {
		t.Fatalf("Register() result = %#v", result)
	}
}

func TestRegisterAcceptedTermsCreatesEmailUser(t *testing.T) {
	svc, db := newRegistrationTestService(t)
	if err := db.Create(&model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: registrationSettingKey, ValueJSON: `{"enabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	var code string
	svc.SetMailSender(func(_ EmailSettingValue, _, _ string, body string) error {
		code = codeFromEmailBody(body)
		return nil
	})
	if err := svc.SendRegistrationEmailCode("member@example.com"); err != nil {
		t.Fatal(err)
	}
	result, err := svc.Register(RegisterRequest{Username: "member", Email: "member@example.com", EmailCode: code, Password: "password", AcceptedTerms: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.User.Role != model.UserRoleUser || result.Session == "" {
		t.Fatalf("Register() result = %#v", result)
	}
}

func TestLinuxDORegistrationAgreement(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var payload any
		switch r.URL.Path {
		case "/token":
			payload = map[string]string{"access_token": "test-access-token"}
		case "/profile":
			payload = map[string]string{"id": "42", "username": "linux-user", "name": "Linux User"}
		default:
			http.NotFound(w, r)
			return
		}
		if err := json.NewEncoder(w).Encode(payload); err != nil {
			t.Error(err)
		}
	}))
	defer server.Close()
	for _, tc := range []struct {
		name         string
		accepted     bool
		existing     bool
		registration bool
		wantError    string
	}{
		{name: "new user without agreement", registration: true, wantError: "请先同意影策服务协议"},
		{name: "new user with agreement", accepted: true, registration: true},
		{name: "existing user without agreement", existing: true, registration: true},
		{name: "existing user with registration closed", existing: true},
		{name: "agreement does not bypass registration closure", accepted: true, wantError: "管理员未开放新用户注册"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, db := newRegistrationTestService(t)
			if err := db.Create(&model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
				t.Fatal(err)
			}
			setting, err := json.Marshal(linuxDOSettingValue{Enabled: true, ClientID: "client", AuthorizationURL: server.URL + "/authorize", TokenURL: server.URL + "/token", UserInfoURL: server.URL + "/profile", RedirectURL: "https://example.com/callback"})
			if err != nil {
				t.Fatal(err)
			}
			for _, value := range []model.SystemSetting{
				{Key: linuxDOSettingKey, ValueJSON: string(setting)},
				{Key: registrationSettingKey, ValueJSON: `{"enabled":` + strconv.FormatBool(tc.registration) + `}`},
			} {
				if err := db.Create(&value).Error; err != nil {
					t.Fatal(err)
				}
			}
			if tc.existing {
				if err := svc.repo.CreateOAuthUser(
					&model.User{ID: "existing-user", Username: "linux-user", Role: model.UserRoleUser, Status: model.UserStatusActive},
					&model.UserIdentity{ID: "identity", UserID: "existing-user", Provider: "linuxdo", Subject: "42"},
				); err != nil {
					t.Fatal(err)
				}
			}
			target, err := svc.BeginLinuxDOLogin("/create", tc.accepted)
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := url.Parse(target)
			if err != nil {
				t.Fatal(err)
			}
			stateValue := parsed.Query().Get("state")
			var saved model.OAuthState
			if err := db.Where("state_hash = ?", HashToken(stateValue)).First(&saved).Error; err != nil || saved.AcceptedTerms != tc.accepted {
				t.Fatalf("saved consent = %v, err=%v", saved.AcceptedTerms, err)
			}
			result, err := svc.CompleteLinuxDOLogin(stateValue, "test-code")
			wantUsers, wantRecords := int64(2), int64(1)
			if tc.wantError != "" {
				var authErr *AuthError
				if !errors.As(err, &authErr) || authErr.Message != tc.wantError {
					t.Fatalf("CompleteLinuxDOLogin() error = %v", err)
				}
				wantUsers, wantRecords = 1, 0
			} else if err != nil || result == nil || result.Session.Session == "" || result.Next != "/create" {
				t.Fatalf("CompleteLinuxDOLogin() result=%#v err=%v", result, err)
			}
			if count, err := svc.repo.UserCount(); err != nil || count != wantUsers {
				t.Fatalf("user count=%d want=%d err=%v", count, wantUsers, err)
			}
			for _, entity := range []any{&model.UserIdentity{}, &model.CreditAccount{}, &model.AuthSession{}} {
				var count int64
				if err := db.Model(entity).Count(&count).Error; err != nil || count != wantRecords {
					t.Fatalf("%T count=%d want=%d err=%v", entity, count, wantRecords, err)
				}
			}
			if _, err := svc.CompleteLinuxDOLogin(stateValue, "test-code"); err == nil {
				t.Fatal("consumed OAuth state was accepted twice")
			}
		})
	}
}
