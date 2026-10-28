package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	supdancei18n "yingce/backend/internal/supdance/i18n"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSupDanceI18nPluginLifecycleAndDictionaryManagement(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.PluginPlatformState{}, &model.UserPluginState{}, &model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), pluginRuntime: center}
	user := &model.User{ID: "user-1", Role: model.UserRoleUser}
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}

	// 1. Default plugin state is platform available and globally effective.
	states, err := svc.PluginStatesForUser(user)
	if err != nil {
		t.Fatal(err)
	}
	state, ok := states[PluginSupDanceI18n]
	if !ok || !state.PlatformAvailable || !state.EffectiveEnabled {
		t.Fatalf("expected supdance-i18n to be available and effective by default, got %#v", state)
	}

	// 2. Non-admin cannot access admin i18n overview or update settings.
	if _, err := svc.AdminSupDanceI18nOverview(user); err == nil {
		t.Fatal("ordinary user accessed admin i18n overview")
	}

	// 3. Admin can update default locale and language toggles.
	overview, err := svc.AdminSupDanceI18nOverview(admin)
	if err != nil {
		t.Fatal(err)
	}
	if len(overview.LanguageStats) != 6 || !overview.PluginEnabled {
		t.Fatalf("unexpected initial overview: %#v", overview)
	}

	nextSettings := overview.Settings
	nextSettings.DefaultLocale = supdancei18n.LocaleEnUS
	updatedOverview, err := svc.UpdateAdminSupDanceI18nSettings(admin, nextSettings)
	if err != nil {
		t.Fatal(err)
	}
	if updatedOverview.Settings.DefaultLocale != supdancei18n.LocaleEnUS {
		t.Fatalf("expected defaultLocale=en-US, got %s", updatedOverview.Settings.DefaultLocale)
	}

	// 4. Admin can upsert custom and modified entries.
	_, count, err := svc.UpsertAdminSupDanceI18nEntries(admin, []supdancei18n.Entry{
		{
			Key:        "nav.create",
			SourceText: "创作",
			Translations: map[string]string{
				supdancei18n.LocaleEnUS: "AI Studio",
			},
		},
		{
			Key:        "custom.banner_greeting",
			Namespace:  "custom",
			SourceText: "欢迎体验多语言创作台",
			Translations: map[string]string{
				supdancei18n.LocaleZhCN: "欢迎体验多语言创作台",
				supdancei18n.LocaleEnUS: "Welcome to the Multi-Language Studio",
				supdancei18n.LocaleZhTW: "歡迎體驗多語言創作台",
				supdancei18n.LocaleJaJP: "多言語スタジオへようこそ",
				supdancei18n.LocaleKoKR: "다국어 스튜디오에 오신 것을 환영합니다",
				supdancei18n.LocaleEsES: "Bienvenido al Estudio Multilingüe",
			},
		},
	})
	if err != nil || count != 2 {
		t.Fatalf("UpsertAdminSupDanceI18nEntries count=%d err=%v", count, err)
	}

	bundle, err := svc.PublicSupDanceI18nBundle()
	if err != nil {
		t.Fatal(err)
	}
	if !bundle.PluginEnabled || len(bundle.CustomEntries) != 2 {
		t.Fatalf("unexpected public bundle: %#v", bundle)
	}

	// 5. Admin disables supdance-i18n in plugin management -> public bundle immediately reflects disabled state.
	adminState, err := svc.SetPluginPlatformAvailability(admin, PluginSupDanceI18n, false)
	if err != nil {
		t.Fatal(err)
	}
	if adminState.PlatformAvailable || adminState.EffectiveEnabled {
		t.Fatalf("expected supdance-i18n to be disabled, got %#v", adminState)
	}

	disabledBundle, err := svc.PublicSupDanceI18nBundle()
	if err != nil {
		t.Fatal(err)
	}
	if disabledBundle.PluginEnabled || len(disabledBundle.CustomEntries) != 0 {
		t.Fatalf("expected disabled public bundle to clear active overrides, got %#v", disabledBundle)
	}

	// 6. Re-enable plugin -> custom entries remain intact.
	if _, err := svc.SetPluginPlatformAvailability(admin, PluginSupDanceI18n, true); err != nil {
		t.Fatal(err)
	}
	restoredBundle, err := svc.PublicSupDanceI18nBundle()
	if err != nil {
		t.Fatal(err)
	}
	if !restoredBundle.PluginEnabled || len(restoredBundle.CustomEntries) != 2 {
		t.Fatalf("expected restored public bundle to have 2 custom entries, got %#v", restoredBundle)
	}
}
