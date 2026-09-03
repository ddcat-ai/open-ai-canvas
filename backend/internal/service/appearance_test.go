package service

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAppearanceDefaultsPreserveBuiltInBrand(t *testing.T) {
	svc, _, _, _ := newAppearanceTestService(t)

	appearance, err := svc.Appearance()
	if err != nil {
		t.Fatal(err)
	}
	if appearance.Configured || appearance.SchemaVersion != appearanceSchemaVersion || appearance.BrandName != defaultAppearanceBrandName || appearance.BrandSlug != defaultAppearanceBrandSlug || appearance.AuthHeroTitle != defaultAppearanceHeroTitle || appearance.AuthHeroDescription != "" || appearance.LogoURL != defaultAppearanceLogoURL || appearance.DarkLogoURL != defaultAppearanceLogoURL || !appearance.LogoFrameEnabled || appearance.AuthVideoURL != defaultAppearanceVideoURL || appearance.AuthVideoPosterURL != defaultAppearancePosterURL || appearance.SkinID != defaultAppearanceSkinID || appearance.SEOTitle != defaultAppearanceBrandName || !strings.Contains(appearance.SEODescription, defaultAppearanceBrandName) || !strings.Contains(appearance.FooterCopyright, defaultAppearanceBrandName) || appearance.ICPFilingEnabled {
		t.Fatalf("Appearance() = %#v", appearance)
	}
	if appearance.LogoConfigured || appearance.DarkLogoConfigured || appearance.AuthVideoConfigured || appearance.AuthVideoPosterConfigured || appearance.Revision != "builtin" {
		t.Fatalf("Appearance() configured state = %#v", appearance)
	}
	if appearance.ActiveSkin.ID != defaultAppearanceSkinID || !appearance.ActiveSkin.Locked {
		t.Fatalf("Appearance() active skin = %#v", appearance.ActiveSkin)
	}
	if appearance.ActiveSkin.Tokens.Light.SwitchChecked == appearance.ActiveSkin.Tokens.Light.SwitchUnchecked || appearance.ActiveSkin.Tokens.Dark.SwitchChecked == appearance.ActiveSkin.Tokens.Dark.SwitchUnchecked || appearance.ActiveSkin.Tokens.Light.DangerForeground == "" {
		t.Fatalf("Appearance() state colors = %#v", appearance.ActiveSkin.Tokens)
	}
	adminAppearance, err := svc.AdminAppearance(&model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	if len(adminAppearance.SkinThemes) != 4 || !adminAppearance.SkinThemes[0].Locked {
		t.Fatalf("AdminAppearance() skin library = %#v", adminAppearance.SkinThemes)
	}
}

func TestAppearanceBackfillsVersionSixFieldsForExistingSetting(t *testing.T) {
	svc, db, _, _ := newAppearanceTestService(t)
	legacy := model.SystemSetting{Key: appearanceSettingKey, ValueJSON: `{"schemaVersion":1,"brandName":"旧品牌","skinId":"classic"}`}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}

	appearance, err := svc.Appearance()
	if err != nil {
		t.Fatal(err)
	}
	if appearance.SchemaVersion != appearanceSchemaVersion || appearance.BrandName != "旧品牌" || appearance.BrandSlug != defaultAppearanceBrandSlug || appearance.AuthHeroTitle != defaultAppearanceHeroTitle || appearance.AuthHeroDescription != "" || appearance.DarkLogoURL != defaultAppearanceLogoURL || !appearance.LogoFrameEnabled || appearance.SEOTitle != "旧品牌" || !strings.Contains(appearance.SEODescription, "旧品牌") || !strings.Contains(appearance.FooterCopyright, "旧品牌") || appearance.ActiveSkin.ID != "classic" {
		t.Fatalf("legacy appearance = %#v", appearance)
	}
}

func TestUpdateAppearancePersistsAuditsAndUsesVersionedPublicAssets(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	resources := []model.Resource{
		{ID: "brand-logo", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "brand/logo.png", MimeType: "image/png"},
		{ID: "brand-logo-dark", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "brand/logo-dark.png", MimeType: "image/png"},
		{ID: "brand-video", UserID: admin.ID, Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "brand/video.mp4", MimeType: "video/mp4"},
		{ID: "brand-poster", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "brand/poster.jpg", MimeType: "image/jpeg"},
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}

	updated, err := svc.UpdateAppearance(admin, AppearanceSetting{
		BrandName:                 "HIMA Studio",
		BrandSlug:                 "hima-studio",
		AuthHeroTitle:             "把灵感，\n变成可见的故事。",
		AuthHeroDescription:       "从画布开始，持续推进你的创作。",
		LogoResourceID:            "brand-logo",
		DarkLogoResourceID:        "brand-logo-dark",
		LogoFrameEnabled:          false,
		AuthVideoResourceID:       "brand-video",
		AuthVideoPosterResourceID: "brand-poster",
		SkinID:                    "studio-indigo",
		SEOTitle:                  "HIMA Studio - AI 影视工作台",
		SEODescription:            "面向 Agent、图片、视频、画布与短剧生产的一体化 AI 创作工作台。",
		SEOKeywords:               "AI 影视,短剧,画布",
		FooterCopyright:           "© 2026 HIMA Studio. All rights reserved.",
		ICPFilingEnabled:          true,
		ICPFilingNumber:           "蜀ICP备2026000000号-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !updated.Configured || updated.BrandName != "HIMA Studio" || updated.BrandSlug != "hima-studio" || updated.Public.BrandSlug != "hima-studio" || updated.AuthHeroTitle != "把灵感，\n变成可见的故事。" || updated.Public.AuthHeroDescription != "从画布开始，持续推进你的创作。" || !updated.Public.LogoConfigured || !updated.Public.DarkLogoConfigured || updated.Public.LogoFrameEnabled || !updated.Public.AuthVideoConfigured || !updated.Public.AuthVideoPosterConfigured || updated.Public.SkinID != "studio-indigo" || updated.Public.SEOTitle != "HIMA Studio - AI 影视工作台" || updated.Public.SEOKeywords != "AI 影视,短剧,画布" || !updated.Public.ICPFilingEnabled || updated.Public.ICPFilingNumber != "蜀ICP备2026000000号-1" {
		t.Fatalf("UpdateAppearance() = %#v", updated)
	}
	for _, assetURL := range []string{updated.Public.LogoURL, updated.Public.DarkLogoURL, updated.Public.AuthVideoURL, updated.Public.AuthVideoPosterURL} {
		if !strings.HasPrefix(assetURL, "/api/public/appearance/assets/") || !strings.Contains(assetURL, "?v=") {
			t.Fatalf("versioned asset URL = %q", assetURL)
		}
	}
	encodedPublic, err := json.Marshal(updated.Public)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encodedPublic), "brand-logo") || strings.Contains(string(encodedPublic), "brand-logo-dark") || strings.Contains(string(encodedPublic), "brand-video") || strings.Contains(string(encodedPublic), "brand-poster") {
		t.Fatalf("public appearance leaked resource IDs: %s", encodedPublic)
	}
	if strings.Contains(string(encodedPublic), "skinThemes") {
		t.Fatalf("public appearance leaked the complete skin library: %s", encodedPublic)
	}
	var auditCount int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ?", "appearance.update").Count(&auditCount).Error; err != nil {
		t.Fatal(err)
	}
	if auditCount != 1 {
		t.Fatalf("audit count = %d, want 1", auditCount)
	}
}

func TestAppearanceReusesSingleLogoAcrossThemes(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	resources := []model.Resource{
		{ID: "only-light", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "brand/light.png", MimeType: "image/png"},
		{ID: "only-dark", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "brand/dark.png", MimeType: "image/png"},
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}

	lightOnly, err := svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: defaultAppearanceHeroTitle, LogoResourceID: "only-light", LogoFrameEnabled: true, SkinID: defaultAppearanceSkinID})
	if err != nil {
		t.Fatal(err)
	}
	if lightOnly.Public.LogoURL != lightOnly.Public.DarkLogoURL || !lightOnly.Public.LogoConfigured || lightOnly.Public.DarkLogoConfigured {
		t.Fatalf("light-only appearance = %#v", lightOnly.Public)
	}

	darkOnly, err := svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: defaultAppearanceHeroTitle, DarkLogoResourceID: "only-dark", LogoFrameEnabled: true, SkinID: defaultAppearanceSkinID})
	if err != nil {
		t.Fatal(err)
	}
	if darkOnly.Public.LogoURL != darkOnly.Public.DarkLogoURL || !darkOnly.Public.LogoConfigured || !darkOnly.Public.DarkLogoConfigured {
		t.Fatalf("dark-only appearance = %#v", darkOnly.Public)
	}
}

func TestResetAppearanceRestoresBuiltInBrandWithoutDeletingResources(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	resource := model.Resource{ID: "brand-logo", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "brand/logo.png", MimeType: "image/png"}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateAppearance(admin, AppearanceSetting{
		BrandName:      "HIMA Studio",
		BrandSlug:      "hima-studio",
		AuthHeroTitle:  "把灵感变成故事",
		LogoResourceID: resource.ID,
		SkinID:         defaultAppearanceSkinID,
	}); err != nil {
		t.Fatal(err)
	}

	reset, err := svc.ResetAppearance(admin)
	if err != nil {
		t.Fatal(err)
	}
	if reset.Configured || reset.BrandName != defaultAppearanceBrandName || reset.BrandSlug != defaultAppearanceBrandSlug || reset.AuthHeroTitle != defaultAppearanceHeroTitle || reset.LogoResourceID != "" || reset.DarkLogoResourceID != "" || !reset.LogoFrameEnabled || reset.Public.Revision != "builtin" || reset.Public.LogoConfigured || reset.Public.DarkLogoConfigured {
		t.Fatalf("ResetAppearance() = %#v", reset)
	}
	var resourceCount int64
	if err := db.Model(&model.Resource{}).Where("id = ?", resource.ID).Count(&resourceCount).Error; err != nil {
		t.Fatal(err)
	}
	if resourceCount != 1 {
		t.Fatalf("resource count = %d, want 1", resourceCount)
	}
	var auditCount int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ?", "appearance.reset").Count(&auditCount).Error; err != nil {
		t.Fatal(err)
	}
	if auditCount != 1 {
		t.Fatalf("reset audit count = %d, want 1", auditCount)
	}
}

func TestUpdateAppearanceRejectsAnotherUsersNewResource(t *testing.T) {
	svc, db, _, admin := newAppearanceTestService(t)
	resource := model.Resource{ID: "foreign-logo", UserID: "another-admin", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "brand/logo.png", MimeType: "image/png"}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}

	_, err := svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: defaultAppearanceHeroTitle, LogoResourceID: resource.ID, SkinID: defaultAppearanceSkinID})
	if err == nil || !strings.Contains(err.Error(), "当前管理员上传") {
		t.Fatalf("UpdateAppearance() error = %v", err)
	}
}

func TestOpenAppearanceAssetOnlyServesConfiguredSlot(t *testing.T) {
	svc, db, dataDir, admin := newAppearanceTestService(t)
	resource := model.Resource{ID: "brand-logo", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "brand/logo.png", MimeType: "image/png"}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	filePath := filepath.Join(dataDir, "resources", filepath.FromSlash(resource.ObjectKey))
	if err := os.MkdirAll(filepath.Dir(filePath), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filePath, []byte("brand-bytes"), 0o640); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: defaultAppearanceHeroTitle, LogoResourceID: resource.ID, SkinID: defaultAppearanceSkinID}); err != nil {
		t.Fatal(err)
	}

	stream, err := svc.OpenAppearanceAsset(AppearanceAssetLogo, "")
	if err != nil {
		t.Fatal(err)
	}
	stream.Body.Close()
	if stream.Resource.ID != resource.ID {
		t.Fatalf("served resource = %q", stream.Resource.ID)
	}
	if _, err := svc.OpenAppearanceAsset(AppearanceAssetVideo, ""); err == nil {
		t.Fatal("unconfigured video slot unexpectedly served a resource")
	}
}

func TestUpdateAppearanceValidatesLoginCopy(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)

	_, err := svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: "", SkinID: defaultAppearanceSkinID})
	if err == nil || !strings.Contains(err.Error(), "主标题") {
		t.Fatalf("empty title error = %v", err)
	}
	_, err = svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: defaultAppearanceHeroTitle, AuthHeroDescription: strings.Repeat("文", 161), SkinID: defaultAppearanceSkinID})
	if err == nil || !strings.Contains(err.Error(), "160") {
		t.Fatalf("long description error = %v", err)
	}
	_, err = svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: "标题\t注入", SkinID: defaultAppearanceSkinID})
	if err == nil || !strings.Contains(err.Error(), "控制字符") {
		t.Fatalf("control character error = %v", err)
	}
	_, err = svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "HIMA Studio", AuthHeroTitle: defaultAppearanceHeroTitle, SkinID: defaultAppearanceSkinID})
	if err == nil || !strings.Contains(err.Error(), "英文品牌标识") {
		t.Fatalf("invalid slug error = %v", err)
	}
	_, err = svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: defaultAppearanceHeroTitle, SkinID: "unknown-skin"})
	if err == nil || !strings.Contains(err.Error(), "皮肤主题") {
		t.Fatalf("invalid skin error = %v", err)
	}
	_, err = svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: defaultAppearanceHeroTitle, SkinID: defaultAppearanceSkinID, ICPFilingEnabled: true})
	if err == nil || !strings.Contains(err.Error(), "备案号") {
		t.Fatalf("missing ICP number error = %v", err)
	}
}

func TestAppearanceSkinLibrarySupportsEditableCopiesAndProtectsClassic(t *testing.T) {
	svc, _, _, admin := newAppearanceTestService(t)
	themes := defaultAppearanceSkinThemes()
	custom := cloneAppearanceSkin(themes[0], "custom-editorial", "片场夜蓝", "自定义控件与明暗色")
	custom.Tokens.Light.Primary = "#123456"
	custom.Tokens.Light.PrimaryHover = "#234567"
	custom.Tokens.Dark.Primary = "#abcdef"
	custom.Tokens.Components.ButtonRadius = 14
	themes = append(themes, custom)
	legacyCustom := custom
	legacyCustom.Tokens.Light.SwitchChecked = ""
	legacyCustom.Tokens.Light.SwitchCheckedHover = ""
	legacyCustom.Tokens.Light.SwitchCheckedHandle = ""
	legacyCustom.Tokens.Light.SwitchUnchecked = ""
	legacyCustom.Tokens.Light.SwitchUncheckedHover = ""
	legacyCustom.Tokens.Light.SwitchUncheckedHandle = ""
	legacyCustom.Tokens.Light.DangerHover = ""
	legacyCustom.Tokens.Light.DangerActive = ""
	legacyCustom.Tokens.Light.DangerForeground = ""
	backfilled := normalizeAppearanceSkinThemes([]AppearanceSkinTheme{legacyCustom})[0]
	if backfilled.Tokens.Light.SwitchChecked != "#123456" || backfilled.Tokens.Light.SwitchCheckedHover != "#234567" || backfilled.Tokens.Light.SwitchUnchecked != legacyCustom.Tokens.Light.ControlBorder || backfilled.Tokens.Light.DangerHover != legacyCustom.Tokens.Light.Danger {
		t.Fatalf("legacy skin state backfill = %#v", backfilled.Tokens.Light)
	}

	updated, err := svc.UpdateAppearance(admin, AppearanceSetting{
		BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: defaultAppearanceHeroTitle,
		SkinID: custom.ID, SkinThemes: themes,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Public.ActiveSkin.ID != custom.ID || updated.Public.ActiveSkin.Tokens.Light.Primary != "#123456" || updated.Public.ActiveSkin.Tokens.Components.ButtonRadius != 14 || len(updated.SkinThemes) != 5 {
		t.Fatalf("custom skin round trip = %#v", updated)
	}

	withoutClassic := append([]AppearanceSkinTheme(nil), themes[1:]...)
	_, err = svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: defaultAppearanceHeroTitle, SkinID: custom.ID, SkinThemes: withoutClassic})
	if err == nil || !strings.Contains(err.Error(), "不能修改或删除") {
		t.Fatalf("missing classic error = %v", err)
	}

	mutatedClassic := append([]AppearanceSkinTheme(nil), themes...)
	mutatedClassic[0].Name = "改名"
	_, err = svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: defaultAppearanceHeroTitle, SkinID: custom.ID, SkinThemes: mutatedClassic})
	if err == nil || !strings.Contains(err.Error(), "不能修改或删除") {
		t.Fatalf("mutated classic error = %v", err)
	}

	invalidColor := append([]AppearanceSkinTheme(nil), themes...)
	invalidColor[len(invalidColor)-1].Tokens.Light.Primary = "red; background:url(x)"
	_, err = svc.UpdateAppearance(admin, AppearanceSetting{BrandName: "HIMA Studio", BrandSlug: "hima-studio", AuthHeroTitle: defaultAppearanceHeroTitle, SkinID: custom.ID, SkinThemes: invalidColor})
	if err == nil || !strings.Contains(err.Error(), "十六进制") {
		t.Fatalf("invalid color error = %v", err)
	}
}

func TestValidateAppearanceUploadSniffsBytesInsteadOfDeclaredMIME(t *testing.T) {
	pngHeader := multipartFileHeader(t, "logo.png", "text/plain", append([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, bytes.Repeat([]byte{0}, 32)...))
	if mimeType, err := validateAppearanceUpload(AppearanceAssetLogo, pngHeader); err != nil || mimeType != "image/png" {
		t.Fatalf("validateAppearanceUpload(png) = %q, %v", mimeType, err)
	}
	darkPNGHeader := multipartFileHeader(t, "logo-dark.png", "text/plain", append([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, bytes.Repeat([]byte{0}, 32)...))
	if mimeType, err := validateAppearanceUpload(AppearanceAssetDarkLogo, darkPNGHeader); err != nil || mimeType != "image/png" {
		t.Fatalf("validateAppearanceUpload(dark png) = %q, %v", mimeType, err)
	}
	fakeImage := multipartFileHeader(t, "fake.png", "image/png", []byte("not an image"))
	if _, err := validateAppearanceUpload(AppearanceAssetLogo, fakeImage); err == nil {
		t.Fatal("declared image MIME accepted non-image bytes")
	}
	mp4Bytes := append([]byte{0x00, 0x00, 0x00, 0x14}, []byte("ftypisom\x00\x00\x00\x00isom")...)
	mp4Header := multipartFileHeader(t, "hero.mp4", "application/octet-stream", mp4Bytes)
	if mimeType, err := validateAppearanceUpload(AppearanceAssetVideo, mp4Header); err != nil || mimeType != "video/mp4" {
		t.Fatalf("validateAppearanceUpload(mp4) = %q, %v", mimeType, err)
	}
	fakeMP4 := multipartFileHeader(t, "fake.mp4", "video/mp4", append([]byte{0x00, 0x00, 0x10, 0x00}, []byte("ftypisom")...))
	if _, err := validateAppearanceUpload(AppearanceAssetVideo, fakeMP4); err == nil {
		t.Fatal("invalid MP4 box size accepted")
	}
}

func multipartFileHeader(t *testing.T, name string, contentType string, data []byte) *multipart.FileHeader {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="file"; filename="`+name+`"`)
	header.Set("Content-Type", contentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if err := req.ParseMultipartForm(int64(body.Len()) + 1024); err != nil {
		t.Fatal(err)
	}
	return req.MultipartForm.File["file"][0]
}

func newAppearanceTestService(t *testing.T) (*Service, *gorm.DB, string, *model.User) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "appearance-admin", Username: "appearance-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	return New(repository.New(db), dataDir), db, dataDir, admin
}
