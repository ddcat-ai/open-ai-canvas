package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestAPIKeyLifecyclePersistsOnlyHashAndIsolatesOwners(t *testing.T) {
	s, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.APIKey{}); err != nil {
		t.Fatal(err)
	}
	ensureTestUsers(t, db, "alice", "bob")
	issued, err := s.CreateAPIKey("alice", CreateAPIKeyRequest{Name: "automation"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(issued.Key, "yc_") || len(issued.Key) < 45 {
		t.Fatalf("weak key: %q", issued.Key)
	}
	var stored model.APIKey
	if err := db.First(&stored, "id = ?", issued.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.TokenHash == "" || strings.Contains(stored.TokenHash, issued.Key) {
		t.Fatal("plaintext or absent hash")
	}
	encoded, _ := json.Marshal(stored)
	if strings.Contains(string(encoded), stored.TokenHash) || strings.Contains(string(encoded), issued.Key) {
		t.Fatal("secret serialized")
	}
	user, err := s.AuthenticateAPIKey(issued.Key)
	if err != nil || user.ID != "alice" {
		t.Fatalf("authenticate: %v", err)
	}
	keys, err := s.APIKeys("bob")
	if err != nil || len(keys) != 0 {
		t.Fatalf("cross-owner list: %v", err)
	}
	if err := s.RevokeAPIKey("bob", issued.ID); err == nil {
		t.Fatal("cross-owner revoke allowed")
	}
	if err := s.RevokeAPIKey("alice", issued.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.RevokeAPIKey("alice", issued.ID); err != nil {
		t.Fatal("revoke must be idempotent", err)
	}
	if _, err := s.AuthenticateAPIKey(issued.Key); err == nil {
		t.Fatal("revoked key accepted")
	}
	keys, err = s.APIKeys("alice")
	if err != nil || len(keys) != 1 || keys[0].RevokedAt == nil {
		t.Fatal("missing revocation metadata", err)
	}
}

func TestAPIKeyRejectsExpiredDisabledAndMalformedCredentials(t *testing.T) {
	s, db := newChannelModelTestService(t)
	if err := db.AutoMigrate(&model.APIKey{}); err != nil {
		t.Fatal(err)
	}
	ensureTestUsers(t, db, "alice")
	past := time.Now().Add(-time.Hour)
	if _, err := s.CreateAPIKey("alice", CreateAPIKeyRequest{Name: "expired", ExpiresAt: &past}); err == nil {
		t.Fatal("past expiry allowed")
	}
	issued, err := s.CreateAPIKey("alice", CreateAPIKeyRequest{Name: "test"})
	if err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"", "yc_short", issued.Key + "x", " " + issued.Key} {
		if _, err := s.AuthenticateAPIKey(raw); err == nil {
			t.Fatal("invalid key accepted")
		}
	}
	if err := db.Model(&model.APIKey{}).Where("id = ?", issued.ID).Update("expires_at", past).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.AuthenticateAPIKey(issued.Key); err == nil {
		t.Fatal("expired key accepted")
	}
	if err := db.Model(&model.APIKey{}).Where("id = ?", issued.ID).Update("expires_at", nil).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", "alice").Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.AuthenticateAPIKey(issued.Key); err == nil {
		t.Fatal("disabled user authenticated")
	}
	if _, err := s.CreateAPIKey("alice", CreateAPIKeyRequest{Name: "test"}); err == nil {
		t.Fatal("disabled user issued key")
	}
}
