package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSignedOSSObjectURLUsesExpiringQuerySignature(t *testing.T) {
	expiresAt := time.Unix(1800000000, 0)
	value, err := signedOSSObjectURL(ossSettingValue{
		Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "private-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	}, "users/u-1/image/test image.png", expiresAt)
	if err != nil {
		t.Fatalf("signedOSSObjectURL() error = %v", err)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if parsed.Host != "private-bucket.oss-cn-test.aliyuncs.com" || query.Get("OSSAccessKeyId") != "access-id" || query.Get("Expires") != "1800000000" || query.Get("Signature") == "" {
		t.Fatalf("signed URL = %q", value)
	}
	if strings.Contains(value, "secret-value") {
		t.Fatalf("signed URL leaked access key secret: %q", value)
	}
}

func TestDirectResourceURLChecksOwnershipAndSignsOSSResource(t *testing.T) {
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: "aliyun", Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "private-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "resource-direct", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: "aliyun", Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "private-bucket",
		ObjectKey: "users/user-1/image/direct.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	value, err := svc.DirectResourceURL("user-1", resource.ID)
	if err != nil || !strings.Contains(value, "Signature=") {
		t.Fatalf("DirectResourceURL() = %q, %v", value, err)
	}
	if _, err := svc.DirectResourceURL("other-user", resource.ID); err == nil {
		t.Fatal("DirectResourceURL() allowed another user's resource")
	}
}

func TestNormalizeSingleByteRange(t *testing.T) {
	tests := map[string]string{
		"bytes=0-1023":       "bytes=0-1023",
		"bytes=1024-":        "bytes=1024-",
		"bytes=-2048":        "bytes=-2048",
		"bytes=0-1,10-20":    "",
		"items=0-10":         "",
		"bytes=invalid-1024": "",
	}
	for input, expected := range tests {
		if actual := normalizeSingleByteRange(input); actual != expected {
			t.Fatalf("normalizeSingleByteRange(%q) = %q, want %q", input, actual, expected)
		}
	}
}

func TestHydrateNewAPIChannel1ResourceUsesSignedOSSURL(t *testing.T) {
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: "aliyun", Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "private-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "resource-1", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: "aliyun", Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "private-bucket",
		ObjectKey: "users/user-1/image/reference.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	media := providerMedia{StorageKey: "resource:resource-1", DataURL: "data:image/png;base64,old"}
	if err := svc.hydrateProviderMedia("user-1", &media, true); err != nil {
		t.Fatalf("hydrateProviderMedia() error = %v", err)
	}
	if !strings.HasPrefix(media.URL, "https://private-bucket.oss-cn-test.aliyuncs.com/") || media.DataURL != "" || !strings.Contains(media.URL, "Signature=") {
		t.Fatalf("media = %#v", media)
	}
	if err := svc.hydrateProviderMedia("other-user", &providerMedia{StorageKey: "resource:resource-1"}, true); err == nil {
		t.Fatal("hydrateProviderMedia() allowed another user's resource")
	}
}

func TestHydrateNewAPIChannel1ResourceUsesSignedLocalURL(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{Provider: "aliyun", PublicBaseURL: server.URL})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "resource-local", UserID: "user-1", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "local.png"}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	media := providerMedia{StorageKey: "resource:resource-local"}
	if err := svc.hydrateProviderMedia("user-1", &media, true); err != nil {
		t.Fatalf("hydrateProviderMedia() error = %v", err)
	}
	if !strings.HasPrefix(media.URL, server.URL+"/api/public/resources/resource-local/file?") || !strings.Contains(media.URL, "signature=") || media.DataURL != "" {
		t.Fatalf("media = %#v", media)
	}
	stored, err := svc.repo.Resource("resource-local")
	if err != nil || stored.Provider != "local" {
		t.Fatalf("resource provider changed: %#v, %v", stored, err)
	}
}

func TestPublicResourceSignatureRejectsExpiredAndAlteredLinks(t *testing.T) {
	svc := newResourceTestService(t)
	expires := strconv.FormatInt(time.Now().Add(time.Minute).Unix(), 10)
	signature, err := svc.signPublicResource("resource-local", expires)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.verifyPublicResourceSignature("resource-local", expires, signature); err != nil {
		t.Fatalf("verifyPublicResourceSignature() error = %v", err)
	}
	if err := svc.verifyPublicResourceSignature("resource-other", expires, signature); err == nil {
		t.Fatal("verifyPublicResourceSignature() accepted another resource ID")
	}
	expired := strconv.FormatInt(time.Now().Add(-time.Minute).Unix(), 10)
	expiredSignature, err := svc.signPublicResource("resource-local", expired)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.verifyPublicResourceSignature("resource-local", expired, expiredSignature); err == nil {
		t.Fatal("verifyPublicResourceSignature() accepted an expired link")
	}
}

func TestUpdateOSSSettingRequiresLocalServerAddress(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	svc := newResourceTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	if _, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{Provider: "aliyun"}); err == nil || !strings.Contains(err.Error(), "服务器访问地址") {
		t.Fatalf("UpdateOSSSetting() error = %v", err)
	}
	if _, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{Provider: "aliyun", PublicBaseURL: server.URL + "/api"}); err == nil || !strings.Contains(err.Error(), "不要包含 /api") {
		t.Fatalf("UpdateOSSSetting(/api) error = %v", err)
	}
	setting, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{Provider: "aliyun", PublicBaseURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	if setting.Enabled || setting.PublicBaseURL != server.URL {
		t.Fatalf("setting = %#v", setting)
	}
}

func TestActiveResourceOSSSettingPrefersUserVersion(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	svc := newResourceTestService(t)
	systemJSON, _ := json.Marshal(ossSettingValue{Enabled: true, Provider: "aliyun", Endpoint: server.URL, Bucket: "system", AccessKeyID: "system-id", AccessKeySecret: "system-secret"})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(systemJSON)}); err != nil {
		t.Fatal(err)
	}
	actor := &model.User{ID: "user-1"}
	created, err := svc.UpdateUserOSSSetting(actor, OSSSettingRequest{Enabled: true, Provider: "aliyun", Endpoint: server.URL, Bucket: "user", AccessKeyID: "user-id", AccessKeySecret: "user-secret"})
	if err != nil {
		t.Fatal(err)
	}
	setting, settingID, useOSS, err := svc.activeResourceOSSSetting(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !useOSS || settingID == "" || setting.Bucket != "user" || !created.Enabled {
		t.Fatalf("activeResourceOSSSetting() = %#v, %q, %v", setting, settingID, useOSS)
	}
}

func TestUserOSSSettingVersionsKeepHistoricalSecrets(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	svc := newResourceTestService(t)
	actor := &model.User{ID: "user-1"}
	if _, err := svc.UpdateUserOSSSetting(actor, OSSSettingRequest{Enabled: true, Provider: "aliyun", Endpoint: server.URL, Bucket: "old", AccessKeyID: "old-id", AccessKeySecret: "old-secret"}); err != nil {
		t.Fatal(err)
	}
	oldSetting, _, err := svc.readUserOSSSetting(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateUserOSSSetting(actor, OSSSettingRequest{Enabled: true, Provider: "aliyun", Endpoint: server.URL, Bucket: "new", AccessKeyID: "new-id", AccessKeySecret: "new-secret"}); err != nil {
		t.Fatal(err)
	}
	_, oldValue, err := svc.readUserOSSSettingByID(actor.ID, oldSetting.ID)
	if err != nil {
		t.Fatal(err)
	}
	if oldValue.Bucket != "old" || oldValue.AccessKeySecret != "old-secret" {
		t.Fatalf("historical setting = %#v", oldValue)
	}
}

func newResourceTestService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.UserDailyUploadUsage{}, &model.Resource{}, &model.SessionFile{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: t.TempDir()}
}

func TestLegacyMediaMigrationSkipsInvalidDataURL(t *testing.T) {
	svc := &Service{}
	input := map[string]interface{}{
		"history": []interface{}{
			map[string]interface{}{"content": "data:video/mp4;base64,broken"},
		},
	}

	result, err := svc.persistLegacyGeneratedMediaResult("user-1", input)
	if err != nil {
		t.Fatalf("persistLegacyGeneratedMediaResult() error = %v", err)
	}
	history := result["history"].([]interface{})
	content := history[0].(map[string]interface{})["content"]
	if content != "data:video/mp4;base64,broken" {
		t.Fatalf("invalid legacy content changed to %v", content)
	}
}

func TestGeneratedMediaRejectsInvalidDataURL(t *testing.T) {
	svc := &Service{}
	_, err := svc.persistGeneratedMediaResult("user-1", map[string]interface{}{
		"content": "data:video/mp4;base64,broken",
	})
	if err == nil {
		t.Fatal("persistGeneratedMediaResult() error = nil, want invalid data URL error")
	}
}

func TestPersistGeneratedMediaAppliesStoredFileQuota(t *testing.T) {
	svc := newResourceTestService(t)
	if err := svc.repo.Create(&model.Resource{
		ID:     "existing",
		UserID: "user-1",
		Status: model.ResourceStatusReady,
		Size:   gigabytes(defaultRuntimePolicy().Resource.StoredFileGB) - 1,
	}); err != nil {
		t.Fatal(err)
	}

	_, err := svc.persistGeneratedMediaResult("user-1", map[string]interface{}{
		"image": map[string]interface{}{"dataUrl": "data:image/png;base64,YQ=="},
	})
	if err == nil || !strings.Contains(err.Error(), "2GB 上限") {
		t.Fatalf("persistGeneratedMediaResult() error = %v", err)
	}
}
