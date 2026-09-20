package service

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestAppearanceInstallationPreservesSavedContentAcrossStartupAndReset(t *testing.T) {
	svc, db, dataDir, admin := newAppearanceTestService(t)
	initial := defaultAppearanceSetting()
	initial.BrandName = "本站品牌"
	initial.StudioLabel = "MY STUDIO"
	if _, err := svc.UpdateAppearance(admin, initial); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureAppearance(); err != nil {
		t.Fatal(err)
	}
	before, err := svc.repo.SystemSetting(appearanceBaselineKey)
	if err != nil {
		t.Fatal(err)
	}
	edited := initial
	edited.BrandName = "编辑后的品牌"
	edited.NoticeEnabled, edited.NoticeText = true, "第一行\n第二行"
	edited.NoticeLinkText, edited.NoticeLinkURL = "查看", "/projects"
	if _, err := svc.UpdateAppearance(admin, edited); err != nil {
		t.Fatal(err)
	}
	active, err := svc.repo.SystemSetting(appearanceSettingKey)
	if err != nil {
		t.Fatal(err)
	}

	restarted := New(repository.New(db), dataDir)
	if err := restarted.EnsureAppearance(); err != nil {
		t.Fatal(err)
	}
	after, _ := restarted.repo.SystemSetting(appearanceBaselineKey)
	afterActive, _ := restarted.repo.SystemSetting(appearanceSettingKey)
	if after.ValueJSON != before.ValueJSON || afterActive.ValueJSON != active.ValueJSON || !afterActive.UpdatedAt.Equal(active.UpdatedAt) {
		t.Fatal("startup overwrote saved configuration")
	}
	public, err := restarted.Appearance()
	if err != nil {
		t.Fatal(err)
	}
	if public.BrandName != edited.BrandName || public.StudioLabel != edited.StudioLabel || public.NoticeText != edited.NoticeText || public.NoticeLinkURL != "/projects" {
		t.Fatalf("lost saved content: %+v", public)
	}
	reset, err := restarted.ResetAppearance(admin)
	if err != nil {
		t.Fatal(err)
	}
	if reset.BrandName != initial.BrandName || reset.StudioLabel != initial.StudioLabel || reset.NoticeEnabled || !reset.Configured {
		t.Fatalf("reset did not restore installation: %+v", reset)
	}
	if err := restarted.EnsureAppearance(); err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.DefaultAppearanceLogo("unexpected"); err == nil {
		t.Fatal("invalid theme accepted")
	}
}

func TestAppearanceInstallationSnapshotsDefaultsAndProtectsBaselineResources(t *testing.T) {
	svc, db, dataDir, admin := newAppearanceTestService(t)
	resources := []model.Resource{{ID: "initial-logo", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "initial.png", MimeType: "image/png"}}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}
	writeAppearanceResourceFixtures(t, dataDir, resources)
	initial := defaultAppearanceSetting()
	initial.LogoResourceID = resources[0].ID
	if _, err := svc.UpdateAppearance(admin, initial); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureAppearance(); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateAppearance(admin, defaultAppearanceSetting()); err != nil {
		t.Fatal(err)
	}
	if len(svc.appearanceResourceReferences([]string{resources[0].ID})[resources[0].ID]) == 0 {
		t.Fatal("initial logo is not protected from deletion")
	}
	// Simulate a new binary shipping different defaults: the saved SVG wins.
	baseline, err := svc.appearanceInstallation()
	if err != nil {
		t.Fatal(err)
	}
	baseline.LightLogo = "<svg>saved installation mark</svg>"
	encoded, _ := json.Marshal(baseline)
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: appearanceBaselineKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureAppearance(); err != nil {
		t.Fatal(err)
	}
	logo, err := svc.DefaultAppearanceLogo("light")
	if err != nil || string(logo) != baseline.LightLogo {
		t.Fatalf("logo overwritten: %s, %v", logo, err)
	}
	reset, err := svc.ResetAppearance(admin)
	if err != nil || reset.LogoResourceID != resources[0].ID {
		t.Fatalf("initial upload not restored: %+v, %v", reset, err)
	}
}

func TestAppearanceNoticeValidationDraftPrivacyAndPermissions(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	if err := svc.EnsureAppearance(); err != nil {
		t.Fatal(err)
	}
	value := defaultAppearanceSetting()
	value.NoticeText, value.NoticeLinkText, value.NoticeLinkURL = "未发布草稿", "内部链接", "https://example.com/draft"
	saved, err := svc.UpdateAppearance(admin, value)
	if err != nil {
		t.Fatal(err)
	}
	if saved.NoticeText != value.NoticeText || saved.Public.NoticeText != "" || saved.Public.NoticeLinkURL != "" || saved.Public.NoticeLinkText != "" {
		t.Fatal("draft privacy or persistence failed")
	}
	for _, link := range []string{"javascript:alert(1)", "//evil.example", "/\\evil.example", "http://example.com", "https://user:pass@example.com", "https://example.com\n/path"} {
		value.NoticeLinkURL = link
		if _, err := svc.UpdateAppearance(admin, value); err == nil {
			t.Errorf("accepted unsafe link %q", link)
		}
	}
	value.NoticeLinkURL = "/projects"
	value.NoticeEnabled, value.NoticeText = true, ""
	if _, err := svc.UpdateAppearance(admin, value); err == nil {
		t.Fatal("accepted empty enabled notice")
	}
	value.NoticeText = strings.Repeat("字", 301)
	if _, err := svc.UpdateAppearance(admin, value); err == nil {
		t.Fatal("accepted oversized notice")
	}
	for _, actor := range []*model.User{nil, {ID: "regular", Role: model.UserRoleUser, Status: model.UserStatusActive}} {
		if _, err := svc.UpdateAppearance(actor, defaultAppearanceSetting()); err == nil {
			t.Fatal("non-admin update accepted")
		}
		if _, err := svc.ResetAppearance(actor); err == nil {
			t.Fatal("non-admin reset accepted")
		}
	}
}
