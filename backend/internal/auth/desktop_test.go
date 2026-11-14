package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestDesktopAuthorizationCodePKCEIsSingleUse(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	if err := db.AutoMigrate(&model.DesktopAuthorizationCode{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "desktop-user", Username: "desktop-user", DisplayName: "Creator", Role: model.UserRoleUser, Status: model.UserStatusActive, PasswordHash: "password-hash"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	verifier := strings.Repeat("v", 43)
	challengeHash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(challengeHash[:])
	redirectURI := "http://127.0.0.1:49152/oauth/callback"
	issued, err := svc.AuthorizeDesktop(&user, DesktopAuthorizationRequest{ClientID: DesktopClientID, RedirectURI: redirectURI, CodeChallenge: challenge})
	if err != nil {
		t.Fatal(err)
	}
	var stored model.DesktopAuthorizationCode
	if err := db.First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.CodeHash == issued.Code || stored.CodeHash != HashToken(issued.Code) || stored.ExpiresAt.Sub(stored.CreatedAt) != desktopAuthorizationCodeTTL {
		t.Fatalf("authorization code storage leaked raw code or has invalid expiry: %#v", stored)
	}
	if _, err := svc.ExchangeDesktopAuthorizationCode(DesktopTokenRequest{ClientID: DesktopClientID, RedirectURI: redirectURI, Code: issued.Code, Verifier: strings.Repeat("x", 43)}); err == nil {
		t.Fatal("wrong verifier unexpectedly exchanged code")
	}
	result, err := svc.ExchangeDesktopAuthorizationCode(DesktopTokenRequest{ClientID: DesktopClientID, RedirectURI: redirectURI, Code: issued.Code, Verifier: verifier})
	if err != nil {
		t.Fatal(err)
	}
	if result.User.ID != user.ID || result.Session == "" || result.MaxAgeSecs <= 0 {
		t.Fatalf("unexpected session result: %#v", result)
	}
	if _, err := svc.ExchangeDesktopAuthorizationCode(DesktopTokenRequest{ClientID: DesktopClientID, RedirectURI: redirectURI, Code: issued.Code, Verifier: verifier}); err == nil {
		t.Fatal("authorization code was reusable")
	}
	if err := db.First(&stored, "id = ?", stored.ID).Error; err != nil || stored.UsedAt == nil {
		t.Fatalf("authorization code was not marked consumed: record=%#v err=%v", stored, err)
	}
}

func TestDesktopAuthorizationRejectsNonLoopbackRedirects(t *testing.T) {
	for _, redirectURI := range []string{
		"https://127.0.0.1:49152/oauth/callback",
		"http://localhost:49152/oauth/callback",
		"http://127.0.0.2:49152/oauth/callback",
		"http://127.0.0.1:49152/oauth/callback?next=https://example.com",
		"http://127.0.0.1:49152/other",
		"http://127.0.0.1/oauth/callback",
		"http://user@127.0.0.1:49152/oauth/callback",
	} {
		if validDesktopRedirectURI(redirectURI) {
			t.Errorf("redirect URI accepted: %s", redirectURI)
		}
	}
	if !validDesktopRedirectURI("http://127.0.0.1:49152/oauth/callback") {
		t.Fatal("valid dynamic loopback redirect URI was rejected")
	}
}

func TestDesktopAuthorizationExpires(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	if err := db.AutoMigrate(&model.DesktopAuthorizationCode{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "desktop-expired-user", Username: "desktop-expired-user", DisplayName: "Creator", Role: model.UserRoleUser, Status: model.UserStatusActive, PasswordHash: "password-hash"}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	verifier := strings.Repeat("v", 43)
	challengeHash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(challengeHash[:])
	issued, err := svc.AuthorizeDesktop(&user, DesktopAuthorizationRequest{ClientID: DesktopClientID, RedirectURI: "http://127.0.0.1:49153/oauth/callback", CodeChallenge: challenge})
	if err != nil {
		t.Fatal(err)
	}
	updated := db.Model(&model.DesktopAuthorizationCode{}).Where("code_hash = ?", HashToken(issued.Code)).Update("expires_at", time.Now().UTC().Add(-time.Second))
	if updated.Error != nil {
		t.Fatal(updated.Error)
	}
	if updated.RowsAffected != 1 {
		t.Fatalf("expected to expire one authorization code, got %d", updated.RowsAffected)
	}
	_, err = svc.ExchangeDesktopAuthorizationCode(DesktopTokenRequest{ClientID: DesktopClientID, RedirectURI: "http://127.0.0.1:49153/oauth/callback", Code: issued.Code, Verifier: verifier})
	if err == nil || errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expired code should return a public auth error, got %v", err)
	}
}
