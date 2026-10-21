package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"yingce/backend/internal/invite"
	"yingce/backend/internal/model"
)

func TestRegistrationBindsNormalizedInviteWithoutBypassingVerification(t *testing.T) {
	for _, tc := range []struct {
		name, code string
		enabled    bool
		wantBound  bool
	}{
		{"valid", " bbbb2345 ", true, true},
		{"invalid", "invalid-code", true, false},
		{"disabled", "BBBB2345", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, db := newRegistrationTestService(t)
			if err := db.AutoMigrate(&model.InviteRecord{}); err != nil {
				t.Fatal(err)
			}
			for _, user := range []model.User{
				{ID: "grand", Username: "grand", InviteCode: "AAAA2345", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
				{ID: "parent", Username: "parent", InviteCode: "BBBB2345", Role: model.UserRoleUser, Status: model.UserStatusActive},
			} {
				if err := db.Create(&user).Error; err != nil {
					t.Fatal(err)
				}
			}
			policy := invite.DefaultInvitePolicy()
			policy.Enabled, policy.Level = true, 2
			if _, bound, err := svc.repo.AttachInviteRecord("parent", "AAAA2345", policy); err != nil || !bound {
				t.Fatalf("parent invite bound=%v err=%v", bound, err)
			}
			policy.Enabled = tc.enabled
			encoded, _ := json.Marshal(policy)
			for _, setting := range []model.SystemSetting{
				{Key: invite.SettingKey, ValueJSON: string(encoded)},
				{Key: registrationSettingKey, ValueJSON: `{"enabled":true}`},
			} {
				if err := db.Create(&setting).Error; err != nil {
					t.Fatal(err)
				}
			}
			var code string
			svc.SetMailSender(func(_ EmailSettingValue, _, _ string, body string) error {
				code = codeFromEmailBody(body)
				return nil
			})
			if err := svc.SendRegistrationEmailCode("member@example.com"); err != nil {
				t.Fatal(err)
			}
			req := RegisterRequest{Username: "member", Email: "member@example.com", EmailCode: code,
				Password: "password", AcceptedTerms: true, InviteCode: tc.code}
			bad := req
			bad.EmailCode = "bad"
			if _, err := svc.Register(bad); err == nil {
				t.Fatal("invite code bypassed email verification")
			}
			result, err := svc.Register(req)
			if err != nil {
				t.Fatal(err)
			}
			if result.User.InviteCode == "" || invite.ValidateInviteCode(result.User.InviteCode) != nil {
				t.Fatalf("new user has invalid invite code %q", result.User.InviteCode)
			}
			record, err := svc.repo.InviteRecord(result.User.ID)
			if err != nil {
				t.Fatal(err)
			}
			if tc.wantBound {
				if record == nil || record.L1InviterID != "parent" || record.L2InviterID != "grand" || record.CodeUsed != "BBBB2345" {
					t.Fatalf("registration invite=%+v", record)
				}
			} else if record != nil {
				t.Fatalf("unexpected invite=%+v", record)
			}
		})
	}
}

func TestLinuxDOInviteStateOnlyBindsNewUsers(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/token":
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "mock-token"})
		case "/profile":
			_ = json.NewEncoder(w).Encode(map[string]string{"id": "42", "username": "linux-member"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	svc, db := newRegistrationTestService(t)
	if err := db.AutoMigrate(&model.InviteRecord{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "parent", Username: "parent", InviteCode: "AAAA2345", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	config, _ := json.Marshal(linuxDOSettingValue{Enabled: true, ClientID: "client",
		AuthorizationURL: server.URL + "/authorize", TokenURL: server.URL + "/token",
		UserInfoURL: server.URL + "/profile", RedirectURL: "https://example.com/callback"})
	policy := invite.DefaultInvitePolicy()
	policy.Enabled = true
	encoded, _ := json.Marshal(policy)
	for _, setting := range []model.SystemSetting{
		{Key: linuxDOSettingKey, ValueJSON: string(config)},
		{Key: registrationSettingKey, ValueJSON: `{"enabled":true}`},
		{Key: invite.SettingKey, ValueJSON: string(encoded)},
	} {
		if err := db.Create(&setting).Error; err != nil {
			t.Fatal(err)
		}
	}
	start := func(inviteCode string) string {
		t.Helper()
		target, err := svc.BeginLinuxDOLogin("/create", true, LinuxDOLoginOptions{InviteCode: inviteCode})
		if err != nil {
			t.Fatal(err)
		}
		parsed, err := url.Parse(target)
		if err != nil {
			t.Fatal(err)
		}
		state := parsed.Query().Get("state")
		var saved model.OAuthState
		if err := db.Where("state_hash = ?", HashToken(state)).First(&saved).Error; err != nil ||
			!saved.AcceptedTerms || saved.InviteCode != "AAAA2345" {
			t.Fatalf("saved OAuth state=%+v err=%v", saved, err)
		}
		return state
	}
	state := start(" aaaa2345 ")
	first, err := svc.CompleteLinuxDOLogin(state, "mock-code", "")
	if err != nil {
		t.Fatal(err)
	}
	record, err := svc.repo.InviteRecord(first.Session.User.ID)
	if err != nil || record == nil || record.L1InviterID != "parent" || record.CodeUsed != "AAAA2345" {
		t.Fatalf("OAuth registration invite=%+v err=%v", record, err)
	}
	if _, err := svc.CompleteLinuxDOLogin(state, "mock-code", ""); err == nil {
		t.Fatal("OAuth callback replay should fail")
	}
	if err := svc.repo.DeleteInviteRecord(first.Session.User.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompleteLinuxDOLogin(start("AAAA2345"), "mock-code", ""); err != nil {
		t.Fatal(err)
	}
	record, err = svc.repo.InviteRecord(first.Session.User.ID)
	if err != nil || record != nil {
		t.Fatalf("existing login attached a new invite=%+v err=%v", record, err)
	}
}
