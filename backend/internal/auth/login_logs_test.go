package auth

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestLoginLogMasksAttemptedContacts(t *testing.T) {
	for _, account := range []string{"unknown@example.com", "+8613812345678", "1234567", "\n1234567\t"} {
		masked := MaskLoginAccount(account)
		if !strings.Contains(masked, "*") || strings.Contains(masked, "unknown") || strings.Contains(masked, "1234567") || strings.ContainsAny(masked, "\n\t") {
			t.Fatalf("contact not masked: %q", masked)
		}
	}
}

func TestLoginLogsExcludeIncompleteProfileReauthentication(t *testing.T) {
	s, db, user, cookie := newProfileTestService(t)
	state := model.OAuthState{ID: "reauth-state", Provider: "linuxdo", StateHash: HashToken("profile-reauth-state"), ReauthUserID: user.ID, ReauthSessionID: "session-one", ExpiresAt: time.Now().Add(time.Hour)}
	if err := db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.CompleteLinuxDOLogin("profile-reauth-state", "", cookie); err == nil {
		t.Fatal("missing code accepted")
	}
	var count int64
	if err := db.Model(&model.LoginLog{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("profile reauthentication logged as login: %d %v", count, err)
	}
}

func TestLoginLogRegistrationSource(t *testing.T) {
	s, db := newRegistrationTestService(t)
	result, err := s.Register(RegisterRequest{Username: "creator", Password: "test-password", AcceptedTerms: true, LoginContext: LoginContext{IP: "192.0.2.2", UserAgent: "test-client"}})
	if err != nil {
		t.Fatal(err)
	}
	var event model.LoginLog
	if err := db.First(&event).Error; err != nil {
		t.Fatal(err)
	}
	if event.Source != "registration" || event.Result != "success" || event.UserID == nil || *event.UserID != result.User.ID || event.IP != "192.0.2.2" {
		t.Fatalf("registration log: %#v", event)
	}
	if event.SessionRef == "" || strings.Contains(result.Session, event.SessionRef) {
		t.Fatal("session ref exposes cookie identifier")
	}
}

func TestLoginLogVerificationMethodsAndInvalidCode(t *testing.T) {
	for _, method := range []string{"email", "sms"} {
		for _, valid := range []bool{true, false} {
			t.Run(method+map[bool]string{true: "/success", false: "/failure"}[valid], func(t *testing.T) {
				s, db, u, _ := newProfileTestService(t)
				policy := VerificationPolicy{SMSLogin: true, EmailLogin: true}
				raw, _ := json.Marshal(policy)
				if err := db.Create(&model.SystemSetting{Key: authPolicyKey, ValueJSON: string(raw)}).Error; err != nil {
					t.Fatal(err)
				}
				secret := strings.Repeat("s", 64)
				v := model.AuthVerification{ID: "login-verification", TokenHash: HashToken(secret), Purpose: "login", Method: method, UserID: u.ID, CredentialHash: repository.ProfileCredentialHash(u.PasswordHash), PolicyHash: policy.hash(), Ready: true, ExpiresAt: time.Now().Add(time.Hour)}
				if method == "email" {
					v.Email = u.Email
					v.EmailHash, _ = s.verificationHash(v.ID + ":email:" + v.Email + ":123456")
					if err := db.Model(u).Update("email_verified_at", time.Now()).Error; err != nil {
						t.Fatal(err)
					}
				} else {
					v.Phone = "+8613812345678"
					v.PhoneHash, _ = s.verificationHash(v.ID + ":sms:" + v.Phone + ":123456")
					if err := db.Model(u).Updates(map[string]any{"phone": v.Phone, "phone_verified_at": time.Now()}).Error; err != nil {
						t.Fatal(err)
					}
				}
				if err := db.Create(&v).Error; err != nil {
					t.Fatal(err)
				}
				code := "123456"
				if !valid {
					code = "000000"
				}
				_, err := s.LoginVerification(VerificationConfirm{Ticket: v.ID + "." + secret, EmailCode: code, SMSCode: code, LoginContext: LoginContext{IP: "192.0.2.3"}})
				if (err == nil) != valid {
					t.Fatalf("verification error: %v", err)
				}
				var event model.LoginLog
				if err := db.First(&event).Error; err != nil {
					t.Fatal(err)
				}
				want := "success"
				if !valid {
					want = "failed"
				}
				if event.Method != method || event.Result != want || event.UserID == nil || *event.UserID != u.ID {
					t.Fatalf("verification log: %#v", event)
				}
			})
		}
	}
}
