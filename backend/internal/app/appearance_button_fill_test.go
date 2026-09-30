package app

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestAppearanceButtonFillRoundTripAndValidation(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	themes := defaultAppearanceSkinThemes()
	custom := cloneAppearanceSkin(themes[0], "custom-gradient", "渐变主题", "主按钮渐变")
	custom.Tokens.Buttons.Light.Angle = 45
	custom.Tokens.Buttons.Light.Start = "#123456"
	custom.Tokens.Buttons.Dark.Mode = "solid"
	themes = append(themes, custom)
	input := AppearanceSetting{BrandName: "测试站点", BrandSlug: "test", AuthHeroTitle: defaultAppearanceHeroTitle, SkinID: custom.ID, SkinThemes: themes}
	saved, err := svc.UpdateAppearance(admin, input)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Public.ActiveSkin.Tokens.Buttons != custom.Tokens.Buttons {
		t.Fatal("public projection lost button parameters")
	}
	loaded, err := svc.AdminAppearance(admin)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Public.ActiveSkin.Tokens.Buttons != custom.Tokens.Buttons {
		t.Fatal("stored button parameters changed")
	}
	for name, mutate := range map[string]func(*AppearanceSkinButtonFill){
		"mode":           func(fill *AppearanceSkinButtonFill) { fill.Mode = "image" },
		"negative angle": func(fill *AppearanceSkinButtonFill) { fill.Angle = -1 },
		"large angle":    func(fill *AppearanceSkinButtonFill) { fill.Angle = 361 },
		"css injection":  func(fill *AppearanceSkinButtonFill) { fill.End = "red; background:url(x)" },
		"missing color":  func(fill *AppearanceSkinButtonFill) { fill.Foreground = "" },
	} {
		t.Run(name, func(t *testing.T) {
			bad := input
			bad.SkinThemes = append([]AppearanceSkinTheme(nil), themes...)
			mutate(&bad.SkinThemes[len(themes)-1].Tokens.Buttons.Light)
			if _, err := svc.UpdateAppearance(admin, bad); err == nil {
				t.Fatal("invalid fill accepted")
			}
		})
	}
	input.SkinThemes[0].Tokens.Buttons.Light.Start = "#000000"
	overwritten, err := svc.UpdateAppearance(admin, input)
	if err != nil {
		t.Fatal(err)
	}
	if overwritten.SkinThemes[0].Tokens.Buttons != defaultClassicAppearanceSkin().Tokens.Buttons {
		t.Fatal("classic fill mutation was stored")
	}
}

func TestAppearanceLegacyButtonFills(t *testing.T) {
	themes := defaultAppearanceSkinThemes()
	for index := range themes {
		themes[index].Tokens.Buttons = AppearanceSkinButtons{}
	}
	migrated := normalizeAppearanceSkinThemes(themes)
	if err := validateAppearanceSkinThemes(migrated, "classic"); err != nil {
		t.Fatal(err)
	}
	for _, skin := range migrated {
		expected := "solid"
		if skin.ID == "classic" {
			expected = "gradient"
		}
		if skin.Tokens.Buttons.Light.Mode != expected || skin.Tokens.Buttons.Dark.Mode != expected {
			t.Fatalf("wrong fill for %s", skin.ID)
		}
	}
	var fill AppearanceSkinButtonFill
	if err := json.Unmarshal([]byte(`{"angle":1.5}`), &fill); err == nil {
		t.Fatal("fractional angle accepted")
	}
}

func TestAppearanceReadsLegacyButtonFillsByStoredIdentity(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	classic := defaultClassicAppearanceSkin()
	custom := cloneAppearanceSkin(classic, "custom-legacy", "旧主题", "保持纯色")
	encoded, err := json.Marshal([]AppearanceSkinTheme{custom, classic})
	if err != nil {
		t.Fatal(err)
	}
	var themes []map[string]any
	if err := json.Unmarshal(encoded, &themes); err != nil {
		t.Fatal(err)
	}
	for _, skin := range themes {
		delete(skin["tokens"].(map[string]any), "buttons")
	}
	encoded, err = json.Marshal(map[string]any{"schemaVersion": 7, "skinId": custom.ID, "skinThemes": themes})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: appearanceSettingKey, ValueJSON: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.AdminAppearance(admin)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Public.ActiveSkin.Tokens.Buttons.Light.Mode != "solid" || loaded.SkinThemes[1].Tokens.Buttons.Light.Mode != "gradient" {
		t.Fatal("legacy fields inherited another theme's fill")
	}
	if err := validateAppearanceSkinThemes(loaded.SkinThemes, custom.ID); err != nil {
		t.Fatal(err)
	}
}
