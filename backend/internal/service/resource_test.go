package service

import (
	"bytes"
	"encoding/json"
	"hash/crc64"
	"io"
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

func TestSignedOSSObjectURLSupportsTencentCOS(t *testing.T) {
	value, err := signedOSSObjectURL(ossSettingValue{
		Provider: tencentCOSProvider, Region: "ap-guangzhou", Bucket: "private-bucket-1250000000",
		AccessKeyID: "secret-id", AccessKeySecret: "secret-key",
	}, "users/u-1/image/test image.png", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("signedOSSObjectURL() error = %v", err)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if parsed.Host != "private-bucket-1250000000.cos.ap-guangzhou.myqcloud.com" || query.Get("q-sign-algorithm") != "sha1" || query.Get("q-ak") != "secret-id" || query.Get("q-signature") == "" {
		t.Fatalf("signed COS URL = %q", value)
	}
	if strings.Contains(value, "secret-key") {
		t.Fatalf("signed COS URL leaked secret key: %q", value)
	}
}

func TestSignedOSSObjectURLUsesAliyunCDNBaseURLForDownloads(t *testing.T) {
	value, err := signedOSSObjectURL(ossSettingValue{
		Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-test.aliyuncs.com", CDNBaseURL: "https://media.example.com",
		Bucket: "private-bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	}, "users/u-1/image/test image.png", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("signedOSSObjectURL() error = %v", err)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Host != "media.example.com" || parsed.Path != "/users/u-1/image/test image.png" || parsed.RawQuery != "" || !strings.Contains(value, "test%20image.png") {
		t.Fatalf("Aliyun OSS CDN URL = %q", value)
	}
}

func TestAliyunOSSUploadRequestStillUsesEndpointWhenCDNConfigured(t *testing.T) {
	req, err := newOSSRequest(http.MethodPut, ossSettingValue{
		Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-test.aliyuncs.com", CDNBaseURL: "https://media.example.com",
		Bucket: "private-bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	}, "users/u-1/image/test.png", "image/png", strings.NewReader("payload"))
	if err != nil {
		t.Fatal(err)
	}
	if req.URL.Host != "private-bucket.oss-cn-test.aliyuncs.com" || req.URL.Path != "/users/u-1/image/test.png" {
		t.Fatalf("Aliyun OSS upload URL = %q", req.URL.String())
	}
}

func TestSignedOSSObjectURLUsesTencentCOSCDNBaseURLWithoutCOSSignature(t *testing.T) {
	value, err := signedOSSObjectURL(ossSettingValue{
		Provider: tencentCOSProvider, Region: "ap-guangzhou", Bucket: "private-bucket-1250000000",
		CDNBaseURL: "https://media.example.com", AccessKeyID: "secret-id", AccessKeySecret: "secret-key",
	}, "users/u-1/image/test image.png", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("signedOSSObjectURL() error = %v", err)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Host != "media.example.com" || parsed.Path != "/users/u-1/image/test image.png" || parsed.RawQuery != "" || !strings.Contains(value, "test%20image.png") {
		t.Fatalf("signed COS CDN URL = %q", value)
	}
}

func TestPutOSSObjectSupportsTencentCOS(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	payload := []byte("cos upload payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/users/u-1/image/test.png" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Content-Type") != "image/png" {
			t.Errorf("Content-Type = %q", r.Header.Get("Content-Type"))
		}
		authorization := r.Header.Get("Authorization")
		if !strings.Contains(authorization, "q-sign-algorithm=sha1") || !strings.Contains(authorization, "q-ak=secret-id") {
			t.Errorf("Authorization = %q", authorization)
		}
		data, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		if !bytes.Equal(data, payload) {
			t.Errorf("body = %q", data)
		}
		w.Header().Set("ETag", `"cos-etag"`)
		w.Header().Set("x-cos-hash-crc64ecma", strconv.FormatUint(crc64.Checksum(data, crc64.MakeTable(crc64.ECMA)), 10))
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	etag, err := putOSSObject(ossSettingValue{
		Provider: tencentCOSProvider, Endpoint: server.URL, Bucket: "private-bucket-1250000000",
		CDNBaseURL: "https://media.example.com", AccessKeyID: "secret-id", AccessKeySecret: "secret-key",
	}, "users/u-1/image/test.png", "image/png", int64(len(payload)), bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if etag != "cos-etag" {
		t.Fatalf("ETag = %q", etag)
	}
}

func TestGetOSSObjectRangeSupportsTencentCOS(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "bytes=0-3" {
			t.Errorf("Range = %q", r.Header.Get("Range"))
		}
		authorization := r.Header.Get("Authorization")
		if !strings.Contains(authorization, "q-sign-algorithm=sha1") || !strings.Contains(authorization, "q-ak=secret-id") {
			t.Errorf("Authorization = %q", authorization)
		}
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Range", "bytes 0-3/7")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("data"))
	}))
	defer server.Close()

	stream, err := getOSSObjectRange(ossSettingValue{
		Provider: tencentCOSProvider, Endpoint: server.URL, Bucket: "private-bucket-1250000000",
		AccessKeyID: "secret-id", AccessKeySecret: "secret-key",
	}, "users/u-1/image/test.png", "bytes=0-3")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.body.Close()
	data, err := io.ReadAll(stream.body)
	if err != nil {
		t.Fatal(err)
	}
	if stream.statusCode != http.StatusPartialContent || stream.contentRange != "bytes 0-3/7" || string(data) != "data" {
		t.Fatalf("stream = %#v, data = %q", stream, data)
	}
}

func TestGetOSSObjectRangeUsesTencentCOSCDNBaseURL(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "bytes=0-3" {
			t.Errorf("Range = %q", r.Header.Get("Range"))
		}
		if r.Header.Get("Authorization") != "" || r.URL.RawQuery != "" {
			t.Errorf("Tencent CDN request should not carry COS authentication: header %q, query %q", r.Header.Get("Authorization"), r.URL.RawQuery)
		}
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Range", "bytes 0-3/7")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("data"))
	}))
	defer server.Close()

	stream, err := getOSSObjectRange(ossSettingValue{
		Provider: tencentCOSProvider, Endpoint: "https://cos.ap-guangzhou.myqcloud.com", CDNBaseURL: server.URL,
		Bucket: "private-bucket-1250000000", AccessKeyID: "secret-id", AccessKeySecret: "secret-key",
	}, "users/u-1/image/test.png", "bytes=0-3")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.body.Close()
	data, err := io.ReadAll(stream.body)
	if err != nil {
		t.Fatal(err)
	}
	if stream.statusCode != http.StatusPartialContent || stream.contentRange != "bytes 0-3/7" || string(data) != "data" {
		t.Fatalf("stream = %#v, data = %q", stream, data)
	}
}

func TestGetOSSObjectRangeUsesAliyunCDNBaseURLWithoutOSSSignature(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "bytes=0-3" {
			t.Errorf("Range = %q", r.Header.Get("Range"))
		}
		if r.Header.Get("Authorization") != "" || r.URL.RawQuery != "" {
			t.Errorf("Aliyun CDN request should not carry OSS authentication: header %q, query %q", r.Header.Get("Authorization"), r.URL.RawQuery)
		}
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Range", "bytes 0-3/7")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("data"))
	}))
	defer server.Close()

	stream, err := getOSSObjectRange(ossSettingValue{
		Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-test.aliyuncs.com", CDNBaseURL: server.URL,
		Bucket: "private-bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	}, "users/u-1/image/test.png", "bytes=0-3")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.body.Close()
	data, err := io.ReadAll(stream.body)
	if err != nil {
		t.Fatal(err)
	}
	if stream.statusCode != http.StatusPartialContent || stream.contentRange != "bytes 0-3/7" || string(data) != "data" {
		t.Fatalf("stream = %#v, data = %q", stream, data)
	}
}

func TestTencentCOSSettingDerivesEndpointAndDoesNotReuseAliyunSecret(t *testing.T) {
	normalized := normalizeOSSSetting(ossSettingValue{Provider: tencentCOSProvider, Region: "ap-shanghai"})
	if normalized.Endpoint != "https://cos.ap-shanghai.myqcloud.com" {
		t.Fatalf("Endpoint = %q", normalized.Endpoint)
	}

	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	_, err := ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: tencentCOSProvider, Endpoint: server.URL, Bucket: "private-bucket-1250000000", AccessKeyID: "secret-id",
	}, ossSettingValue{Provider: aliyunOSSProvider, AccessKeySecret: "aliyun-secret"})
	if err == nil || !strings.Contains(err.Error(), "AccessKey Secret") {
		t.Fatalf("ossSettingFromRequest() error = %v", err)
	}
	next, err := ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: tencentCOSProvider, Endpoint: server.URL, CDNBaseURL: server.URL,
		Bucket: "private-bucket-1250000000", AccessKeyID: "secret-id", AccessKeySecret: "secret-key",
	}, ossSettingValue{})
	if err != nil || next.CDNBaseURL != server.URL {
		t.Fatalf("Tencent COS CDN setting = %#v, %v", next, err)
	}
}

func TestAliyunOSSSettingKeepsCDNBaseURL(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	next, err := ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, CDNBaseURL: server.URL,
		Bucket: "private-bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	}, ossSettingValue{})
	if err != nil || next.CDNBaseURL != server.URL {
		t.Fatalf("Aliyun OSS CDN setting = %#v, %v", next, err)
	}
}

func TestOSSCDNBaseURLRejectsNonDomainParts(t *testing.T) {
	for _, value := range []string{"ftp://media.example.com", "https://media.example.com/assets", "https://media.example.com?token=value", "https://user@media.example.com"} {
		if _, err := ossCDNBaseURL(value); err == nil {
			t.Fatalf("ossCDNBaseURL(%q) should fail", value)
		}
	}
}

func TestPlatformProviderSwitchKeepsHistoricalCredentials(t *testing.T) {
	current := ossSettingValue{Provider: aliyunOSSProvider, AccessKeyID: "aliyun-id", AccessKeySecret: "aliyun-secret"}
	next := archiveOSSProviderCredentials(ossSettingValue{Provider: tencentCOSProvider, AccessKeyID: "cos-id", AccessKeySecret: "cos-secret"}, current)
	historical, err := ossSettingForProvider(next, aliyunOSSProvider)
	if err != nil {
		t.Fatal(err)
	}
	if historical.Provider != aliyunOSSProvider || historical.AccessKeyID != "aliyun-id" || historical.AccessKeySecret != "aliyun-secret" {
		t.Fatalf("historical setting = %#v", historical)
	}
	if _, ok := next.ArchivedCredentials[tencentCOSProvider]; ok {
		t.Fatalf("active provider credentials were archived: %#v", next.ArchivedCredentials)
	}
}

func TestArchivedProviderCredentialsAreEncryptedAtRest(t *testing.T) {
	svc := &Service{dataDir: t.TempDir()}
	value := ossSettingValue{
		Provider: tencentCOSProvider, AccessKeyID: "cos-id", AccessKeySecret: "cos-secret",
		ArchivedCredentials: map[string]ossProviderCredentials{
			aliyunOSSProvider: {AccessKeyID: "aliyun-id", AccessKeySecret: "aliyun-secret"},
		},
	}
	stored, err := svc.encryptOSSSettingSecrets(value)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stored.AccessKeySecret, encryptedSettingPrefix) || !strings.HasPrefix(stored.ArchivedCredentials[aliyunOSSProvider].AccessKeySecret, encryptedSettingPrefix) {
		t.Fatalf("stored credentials are not encrypted: %#v", stored)
	}
	if _, err := svc.decryptOSSSettingSecrets(&stored); err != nil {
		t.Fatal(err)
	}
	if stored.AccessKeySecret != "cos-secret" || stored.ArchivedCredentials[aliyunOSSProvider].AccessKeySecret != "aliyun-secret" {
		t.Fatalf("decrypted credentials = %#v", stored)
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
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
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
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
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
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
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
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
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
