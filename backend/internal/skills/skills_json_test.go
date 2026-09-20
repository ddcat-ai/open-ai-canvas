package skills

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSkillItemJSONUsesCamelCaseAndRFC3339(t *testing.T) {
	checked := time.Date(2026, 9, 9, 3, 26, 0, 0, time.UTC)
	item := SkillItem{
		SkillID: "skill-1", SkillName: "镜头拆解", VersionID: "v1", ContentHash: "hash",
		CreatedAt: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC), UpdatedAt: time.Date(2026, 1, 3, 4, 5, 6, 0, time.UTC),
		LastCheckedAt: &checked, EffectiveUser: SkillEffectiveUser{Name: "用户", AvatarURL: "https://example.com/a.png", UID: "u1"},
		ShowcaseMedia: []SkillShowcaseMedia{{Type: "image", ShowcaseURI: "uri", ShowcaseURL: "https://example.com/m.png"}},
	}
	body, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	text := string(body)
	for _, key := range []string{
		`"skill_id"`, `"skill_name"`, `"version_id"`, `"content_hash"`, `"create_time"`, `"update_time"`,
		`"last_checked_at"`, `"showcase_uri"`, `"showcase_url"`, `"avatar_url"`, `"is_private"`, `"owner_uid"`,
	} {
		if strings.Contains(text, key) {
			t.Fatalf("legacy key %s still encoded: %s", key, text)
		}
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(body, &object); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"skillId", "skillName", "versionId", "contentHash", "createdAt", "updatedAt", "lastCheckedAt", "showcaseMedia", "effectiveUser"} {
		if _, found := object[key]; !found {
			t.Fatalf("missing %s: %s", key, text)
		}
	}
	if got := strings.Trim(string(object["createdAt"]), `"`); got != "2026-01-02T03:04:05Z" {
		t.Fatalf("createdAt = %s", got)
	}
}

func TestParseShowcaseMediaAcceptsStoredSnakeCase(t *testing.T) {
	items, err := parseShowcaseMedia(`[{"type":"image","showcase_uri":"uri-1","showcase_url":"https://example.com/a.png"}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ShowcaseURI != "uri-1" || items[0].ShowcaseURL != "https://example.com/a.png" {
		t.Fatalf("unexpected legacy parse: %+v", items)
	}
	items, err = parseShowcaseMedia(`[{"type":"video","showcaseUri":"uri-2","showcaseUrl":"https://example.com/b.mp4"}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ShowcaseURI != "uri-2" {
		t.Fatalf("unexpected camelCase parse: %+v", items)
	}
}
