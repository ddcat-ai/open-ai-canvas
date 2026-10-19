package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestCreationPreferencesAccountIsolationAndFieldMerge(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	user := &model.User{ID: "user"}
	if err := db.First(user, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	decode := func(raw string) map[string]any {
		var value map[string]any
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	first := decode(`{"models":{"imageModel":"chosen-image"},"agent":{"permissionMode":"auto","budget":{"maxCredits":12.5}}}`)
	if _, err := s.PatchCreationPreferences(user, user.ID, first); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PatchCreationPreferences(user, user.ID, decode(`{"agent":{"budget":{"maxVideoSeconds":0}},"image":{"ratio":"16:9"}}`)); err != nil {
		t.Fatal(err)
	}
	restored, err := s.CreationPreferences(user, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	budget := restored["agent"].(map[string]any)["budget"].(map[string]any)
	if budget["maxCredits"] != 12.5 || budget["maxVideoSeconds"] != float64(0) || restored["models"].(map[string]any)["imageModel"] != "chosen-image" {
		t.Fatalf("independent device patches overwrote preferences: %+v", restored)
	}
	if _, err := s.CreationPreferences(user, "other-user"); err == nil {
		t.Fatal("account mismatch accepted")
	}
	if _, err := s.PatchCreationPreferences(user, "other-user", first); err == nil {
		t.Fatal("cross-account write accepted")
	}
	for _, invalid := range []string{`{"apiKey":"secret"}`, `{"agent":{"permissionMode":"admin"}}`, `{"agent":{"budget":{"maxCredits":-1}}}`, `{"image":{"imageParameters":"secret"}}`, `{"activeConversationId":"draft"}`} {
		if _, err := s.PatchCreationPreferences(user, user.ID, decode(invalid)); err == nil {
			t.Fatalf("unsafe preference accepted: %s", invalid)
		}
	}
}

func TestCreationDefaultQualityDoesNotRejectUnsupportedOptionalParameter(t *testing.T) {
	resolved := map[string]any{"mode": "image", "config": map[string]any{}, "capabilityOptions": map[string]any{}}
	if err := validateCloudAgentResolvedMediaOptions(map[string]any{"quality": "auto"}, resolved); err != nil {
		t.Fatal(err)
	}
	if err := validateCloudAgentResolvedMediaOptions(map[string]any{"quality": "high"}, resolved); err == nil {
		t.Fatal("explicit unsupported quality silently discarded")
	}
}
