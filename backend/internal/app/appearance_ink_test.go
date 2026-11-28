package app

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func legacyInkFixture(t *testing.T) AppearanceSkinTheme {
	t.Helper()
	raw, err := os.ReadFile("testdata/longying-ink-v12.json")
	if err != nil {
		t.Fatal(err)
	}
	var skin AppearanceSkinTheme
	if err := json.Unmarshal(raw, &skin); err != nil {
		t.Fatal(err)
	}
	return skin
}

func storeAppearanceFixture(t *testing.T, db *gorm.DB, setting AppearanceSetting) {
	t.Helper()
	raw, err := json.Marshal(setting)
	if err != nil {
		t.Fatal(err)
	}
	row := model.SystemSetting{Key: appearanceSettingKey, ValueJSON: string(raw)}
	if err := db.Save(&row).Error; err != nil {
		t.Fatal(err)
	}
}

func TestAppearanceLegacyInkMatchIsExact(t *testing.T) {
	svc, db, _, _ := newAppearanceTestService(t)
	legacy := legacyInkFixture(t)
	for _, tc := range []struct {
		name    string
		edit    func(*AppearanceSkinTheme)
		upgrade bool
	}{
		{"hex case and site label", func(s *AppearanceSkinTheme) {
			s.Name, s.Description = "本地名称", "本地说明"
			s.Tokens.Light.Primary = strings.ToUpper(s.Tokens.Light.Primary)
			s.Tokens.Dark.IconMuted = strings.ToUpper(s.Tokens.Dark.IconMuted)
			s.Tokens.Buttons.Light.HoverEnd = strings.ToUpper(s.Tokens.Buttons.Light.HoverEnd)
		}, true},
		{"custom primary", func(s *AppearanceSkinTheme) { s.Tokens.Light.Primary = "#123456" }, false},
		{"custom dark canvas", func(s *AppearanceSkinTheme) { s.Tokens.Dark.Canvas = "#123456" }, false},
		{"explicit alpha", func(s *AppearanceSkinTheme) { s.Tokens.Light.Primary += "ff" }, false},
		{"custom radius", func(s *AppearanceSkinTheme) { s.Tokens.Components.CardRadius++ }, false},
		{"custom button angle", func(s *AppearanceSkinTheme) { s.Tokens.Buttons.Dark.Angle++ }, false},
		{"custom button fill", func(s *AppearanceSkinTheme) { s.Tokens.Buttons.Light.End = "#123456" }, false},
		{"local copy", func(s *AppearanceSkinTheme) { s.ID = "my-ink" }, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ink := legacy
			tc.edit(&ink)
			site := defaultAppearanceSetting()
			site.SkinID = ink.ID
			site.SkinThemes = []AppearanceSkinTheme{defaultClassicAppearanceSkin(), ink}
			storeAppearanceFixture(t, db, site)
			public, err := svc.Appearance()
			if err != nil {
				t.Fatal(err)
			}
			if tc.upgrade {
				ink.Tokens = appearanceThemePackSkins[0].Tokens
			}
			if public.ActiveSkin != ink {
				t.Fatal("returned skin does not match the expected site preset")
			}
		})
	}
}

func TestAppearanceLegacyInkWithExtraToken(t *testing.T) {
	svc, db, _, _ := newAppearanceTestService(t)
	raw, err := os.ReadFile("testdata/longying-ink-v12.json")
	if err != nil {
		t.Fatal(err)
	}
	var skin map[string]any
	if err := json.Unmarshal(raw, &skin); err != nil {
		t.Fatal(err)
	}
	skin["tokens"].(map[string]any)["siteAccent"] = "#123456"
	saved, err := json.Marshal(map[string]any{
		"schemaVersion": appearanceSchemaVersion, "skinId": skin["id"], "skinThemes": []any{skin},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: appearanceSettingKey, ValueJSON: string(saved)}).Error; err != nil {
		t.Fatal(err)
	}
	public, err := svc.Appearance()
	if err != nil {
		t.Fatal(err)
	}
	if public.ActiveSkin.Tokens != legacyInkFixture(t).Tokens {
		t.Fatal("a stored skin with an additional site token was mistaken for the bundled preset")
	}
}
