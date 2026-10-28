package i18n

import (
	"testing"
)

func TestDefaultLanguagesCoverAllSixLocales(t *testing.T) {
	langs := DefaultLanguages()
	if len(langs) != 6 {
		t.Fatalf("expected 6 languages, got %d", len(langs))
	}
	expected := []string{LocaleZhCN, LocaleEnUS, LocaleZhTW, LocaleJaJP, LocaleKoKR, LocaleEsES}
	for i, code := range expected {
		if langs[i].Code != code || !langs[i].Enabled {
			t.Fatalf("language[%d] = %#v, want code %s enabled", i, langs[i], code)
		}
	}
}

func TestBuiltinEntriesHaveCompleteSixLanguageTranslations(t *testing.T) {
	entries := BuiltinEntries()
	if len(entries) < 80 {
		t.Fatalf("expected rich builtin dictionary, got %d entries", len(entries))
	}
	seenKeys := make(map[string]bool, len(entries))
	for _, item := range entries {
		if seenKeys[item.Key] {
			t.Fatalf("duplicate builtin key %q", item.Key)
		}
		seenKeys[item.Key] = true
		if item.SourceText == "" {
			t.Fatalf("entry %q has empty sourceText", item.Key)
		}
		for _, code := range SupportedLocaleCodes {
			if item.Translations[code] == "" {
				t.Fatalf("entry %q missing translation for %s", item.Key, code)
			}
		}
	}
}

func TestNormalizeSettingsRejectsZeroEnabledLanguages(t *testing.T) {
	settings := DefaultSettings()
	for i := range settings.Languages {
		settings.Languages[i].Enabled = false
	}
	if _, err := NormalizeSettings(settings); err == nil {
		t.Fatal("expected error when all languages are disabled")
	}
}

func TestUpsertAndMergeEntries(t *testing.T) {
	custom, count, err := UpsertEntries(nil, []Entry{
		{
			Key:        "nav.create",
			SourceText: "创作",
			Translations: map[string]string{
				LocaleEnUS: "Studio Create",
			},
		},
		{
			Key:        "custom.hello_world",
			Namespace:  "custom",
			SourceText: "你好世界",
			Translations: map[string]string{
				LocaleZhCN: "你好世界",
				LocaleEnUS: "Hello World",
				LocaleZhTW: "你好世界",
				LocaleJaJP: "こんにちは世界",
				LocaleKoKR: "안녕하세요 세계",
				LocaleEsES: "Hola Mundo",
			},
		},
	}, "admin-1")
	if err != nil {
		t.Fatalf("UpsertEntries failed: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 updated entries, got %d", count)
	}

	merged, customCount, modifiedCount := MergeEntries(custom)
	if customCount != 1 || modifiedCount != 1 {
		t.Fatalf("expected customCount=1, modifiedCount=1, got %d, %d", customCount, modifiedCount)
	}

	filtered := FilterEntries(merged, customCount, modifiedCount, EntryFilter{
		Keyword:  "Studio Create",
		Page:     1,
		PageSize: 20,
	})
	if filtered.Total != 1 || filtered.Items[0].Key != "nav.create" || filtered.Items[0].Origin != EntryOriginModified {
		t.Fatalf("unexpected filtered result: %#v", filtered)
	}

	afterDelete, removed := DeleteOrResetEntry(custom, "nav.create")
	if !removed {
		t.Fatal("expected nav.create override to be removed")
	}
	_, customCountAfter, modifiedCountAfter := MergeEntries(afterDelete)
	if customCountAfter != 1 || modifiedCountAfter != 0 {
		t.Fatalf("after reset expected custom=1 modified=0, got %d, %d", customCountAfter, modifiedCountAfter)
	}
}
