package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"hash/crc64"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"testing/iotest"
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
	if parsed.Host != "private-bucket.oss-cn-test.aliyuncs.com" || parsed.Path != "/users/u-1/image/test image.png" || query.Get("OSSAccessKeyId") != "access-id" || query.Get("Expires") != "1800000000" || query.Get("Signature") == "" {
		t.Fatalf("signed URL = %q", value)
	}
	if strings.Contains(parsed.RawPath, "%2520") || strings.Contains(value, "%2520") {
		t.Fatalf("signed URL double-escaped object key: %q", value)
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

func TestSignedOSSObjectURLUsesAliyunOriginSignatureForDownloads(t *testing.T) {
	value, err := signedOSSObjectURL(ossSettingValue{
		Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-test.aliyuncs.com",
		Bucket: "private-bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	}, "users/u-1/image/test image.png", time.Now().Add(time.Hour), "resource-1.png")
	if err != nil {
		t.Fatalf("signedOSSObjectURL() error = %v", err)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Host != "private-bucket.oss-cn-test.aliyuncs.com" || parsed.Query().Get("response-content-disposition") != "attachment; filename=resource-1.png" || parsed.Query().Get("Signature") == "" {
		t.Fatalf("Aliyun OSS download URL = %q", value)
	}
}

func TestAliyunOSSUploadRequestUsesEndpoint(t *testing.T) {
	req, err := newOSSRequest(http.MethodPut, ossSettingValue{
		Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-test.aliyuncs.com",
		Bucket: "private-bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	}, "users/u-1/image/test.png", "image/png", strings.NewReader("payload"))
	if err != nil {
		t.Fatal(err)
	}
	if req.URL.Host != "private-bucket.oss-cn-test.aliyuncs.com" || req.URL.Path != "/users/u-1/image/test.png" {
		t.Fatalf("Aliyun OSS upload URL = %q", req.URL.String())
	}
}

func TestSignedOSSObjectURLUsesTencentCOSOriginSignatureForDownloads(t *testing.T) {
	value, err := signedOSSObjectURL(ossSettingValue{
		Provider: tencentCOSProvider, Region: "ap-guangzhou", Bucket: "private-bucket-1250000000",
		AccessKeyID: "secret-id", AccessKeySecret: "secret-key",
	}, "users/u-1/image/test image.png", time.Now().Add(time.Hour), "resource-1.png")
	if err != nil {
		t.Fatalf("signedOSSObjectURL() error = %v", err)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Host != "private-bucket-1250000000.cos.ap-guangzhou.myqcloud.com" || parsed.Query().Get("q-signature") == "" || parsed.Query().Get("response-content-disposition") != "attachment; filename=resource-1.png" {
		t.Fatalf("signed COS download URL = %q", value)
	}
}

func TestPutOSSObjectSupportsTencentCOS(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "localhost")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1,localhost")
	payload := []byte("cos upload payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/users/u-1/image/test.png" {
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Content-Type") != "image/png" {
			t.Errorf("Content-Type = %q", r.Header.Get("Content-Type"))
		}
		if r.Header.Get("Cache-Control") != immutableResourceCacheControl {
			t.Errorf("Cache-Control = %q", r.Header.Get("Cache-Control"))
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
		AccessKeyID: "secret-id", AccessKeySecret: "secret-key",
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

func TestGetOSSObjectRangeSupportsAliyunOSS(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "bytes=0-3" {
			t.Errorf("Range = %q", r.Header.Get("Range"))
		}
		if r.Header.Get("Authorization") == "" {
			t.Errorf("Aliyun origin request should carry OSS authorization")
		}
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Range", "bytes 0-3/7")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("data"))
	}))
	defer server.Close()

	stream, err := getOSSObjectRange(ossSettingValue{
		Provider: aliyunOSSProvider, Endpoint: server.URL,
		Bucket: "", AccessKeyID: "access-id", AccessKeySecret: "secret-value",
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
	if err == nil || !strings.Contains(err.Error(), "访问密钥 SecretKey") {
		t.Fatalf("ossSettingFromRequest() error = %v", err)
	}
	_, err = ossSettingFromRequest(OSSSettingRequest{
		Enabled: true, Provider: tencentCOSProvider, Endpoint: server.URL,
		Bucket: "private-bucket-1250000000", AccessKeyID: "secret-id", AccessKeySecret: "secret-key",
	}, ossSettingValue{})
	if err != nil {
		t.Fatalf("ossSettingFromRequest() error = %v", err)
	}
}

func TestSignedQiniuS3ObjectURL(t *testing.T) {
	value, err := signedQiniuObjectURL(ossSettingValue{
		Provider: qiniuKodoProvider, Endpoint: "https://up-z0.qiniup.com", Bucket: "private-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	}, "users/u-1/image/test image.png", time.Now().Add(time.Hour))
	if err != nil {
		t.Fatalf("signedQiniuObjectURL() error = %v", err)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if parsed.Host != "private-bucket.s3.cn-east-1.qiniucs.com" || parsed.Path != "/users/u-1/image/test image.png" || query.Get("X-Amz-Algorithm") != "AWS4-HMAC-SHA256" || query.Get("X-Amz-Credential") == "" || query.Get("X-Amz-Signature") == "" || query.Get("X-Amz-Expires") == "" {
		t.Fatalf("signed Qiniu S3 URL = %q", value)
	}
	if strings.Contains(value, "secret-value") {
		t.Fatalf("signed URL leaked access key secret: %q", value)
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
	downloadURL, proxy, err := svc.BrowserResourceDownloadURL("user-1", resource.ID)
	if err != nil || proxy {
		t.Fatalf("BrowserResourceDownloadURL() = %q, %v, %v", downloadURL, proxy, err)
	}
	parsedDownload, err := url.Parse(downloadURL)
	if err != nil || parsedDownload.Query().Get("response-content-disposition") != "attachment; filename=resource-direct.png" {
		t.Fatalf("BrowserResourceDownloadURL() = %q, want attachment disposition", downloadURL)
	}
	if _, err := svc.DirectResourceURL("other-user", resource.ID); err == nil {
		t.Fatal("DirectResourceURL() allowed another user's resource")
	}
	if _, err := svc.DirectResourceURL("user-1", "missing-resource"); !isAppErrorStatus(err, 404) {
		t.Fatalf("DirectResourceURL() missing resource error = %v, want a 404 app error", err)
	}
}

func TestOpenResourceRangeMapsMissingResourceToNotFound(t *testing.T) {
	svc := newResourceTestService(t)
	if _, err := svc.OpenResourceRange("user-1", "missing-resource", ""); !isAppErrorStatus(err, 404) {
		t.Fatalf("OpenResourceRange() missing resource error = %v, want a 404 app error", err)
	}
}

func TestBrowserResourceURLKeepsLocalResourcesOnAuthenticatedRoute(t *testing.T) {
	svc := newResourceTestService(t)
	resource := model.Resource{
		ID: "resource-local-browser", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: "local", ObjectKey: "users/user-1/image/local.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	value, proxy, err := svc.BrowserResourceURL("user-1", resource.ID)
	if err != nil || !proxy || value != "" {
		t.Fatalf("BrowserResourceURL() = %q, %v, %v", value, proxy, err)
	}
	if _, _, err := svc.BrowserResourceURL("other-user", resource.ID); err == nil {
		t.Fatal("BrowserResourceURL() allowed another user's resource")
	}
}

func TestBrowserResourceURLKeepsPrivateS3OnAuthenticatedRoute(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: s3Provider, Endpoint: "http://127.0.0.1:9000", Bucket: "private-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value", PathStyle: true,
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "resource-private-s3-browser", UserID: "user-1", Kind: "video", Status: model.ResourceStatusReady,
		Provider: s3Provider, Endpoint: "http://127.0.0.1:9000", Bucket: "private-bucket", ObjectKey: "users/user-1/video/private.mp4", MimeType: "video/mp4",
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	value, proxy, err := svc.BrowserResourceURL("user-1", resource.ID)
	if err != nil || !proxy || value != "" {
		t.Fatalf("BrowserResourceURL() = %q, %v, %v", value, proxy, err)
	}
}

func TestBrowserResourceURLKeepsPrivateAliyunOnAuthenticatedRoute(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: "http://127.0.0.1:9000", Bucket: "private-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "resource-private-aliyun-browser", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: aliyunOSSProvider, Endpoint: "http://127.0.0.1:9000", Bucket: "private-bucket", ObjectKey: "users/user-1/image/private.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	value, proxy, err := svc.BrowserResourceURL("user-1", resource.ID)
	if err != nil || !proxy || value != "" {
		t.Fatalf("BrowserResourceURL() = %q, %v, %v", value, proxy, err)
	}
}

func TestPrepareResourceDeliveryUsesShortLivedOriginSignature(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: tencentCOSProvider, Endpoint: "https://cos.ap-shanghai.myqcloud.com",
		Bucket: "private-bucket-1250000000", AccessKeyID: "secret-id", AccessKeySecret: "secret-key",
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "resource-cdn-delivery", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: tencentCOSProvider, Endpoint: "https://cos.ap-shanghai.myqcloud.com", Bucket: "private-bucket-1250000000",
		ObjectKey: "users/user-1/image/test image.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	delivery, err := svc.PrepareResourceDelivery("user-1", resource.ID, ResourceDeliveryOptions{ForceDirect: true})
	if err != nil {
		t.Fatal(err)
	}
	if delivery.Resource == nil || delivery.Resource.ID != resource.ID || delivery.RedirectURL == "" {
		t.Fatalf("PrepareResourceDelivery() = %#v", delivery)
	}
	parsed, err := url.Parse(delivery.RedirectURL)
	if err != nil || parsed.Host != "private-bucket-1250000000.cos.ap-shanghai.myqcloud.com" || parsed.Query().Get("q-signature") == "" {
		t.Fatalf("PrepareResourceDelivery() = %#v, want a signed COS origin URL", delivery)
	}
}

func TestPrepareResourceDeliveryAllowsExplicitProxy(t *testing.T) {
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-test.aliyuncs.com",
		Bucket: "private-bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "resource-cdn-proxy", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "private-bucket",
		ObjectKey: "users/user-1/image/proxy.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	delivery, err := svc.PrepareResourceDelivery("user-1", resource.ID, ResourceDeliveryOptions{ForceProxy: true})
	if err != nil {
		t.Fatal(err)
	}
	if delivery.Resource == nil || delivery.Resource.ID != resource.ID || delivery.RedirectURL != "" {
		t.Fatalf("PrepareResourceDelivery(force proxy) = %#v", delivery)
	}
}

func TestPrepareResourceDeliverySignsQiniuS3URL(t *testing.T) {
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: qiniuKodoProvider, Region: "z0", Endpoint: "https://up-z0.qiniup.com",
		Bucket: "private-bucket", AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "resource-qiniu-proxy", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: qiniuKodoProvider, Endpoint: "https://up-z0.qiniup.com", Bucket: "private-bucket",
		ObjectKey: "users/user-1/image/private.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	delivery, err := svc.PrepareResourceDelivery("user-1", resource.ID, ResourceDeliveryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if delivery.Resource == nil || delivery.RedirectURL == "" || !strings.Contains(delivery.RedirectURL, ".s3.cn-east-1.qiniucs.com") || !strings.Contains(delivery.RedirectURL, "X-Amz-Signature=") {
		t.Fatalf("PrepareResourceDelivery() = %#v, want a signed Qiniu S3 URL", delivery)
	}
}

func TestLegacyUserResourceUsesSettingCreatedBeforeCredentialRotation(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	svc := newResourceTestService(t)
	actor := &model.User{ID: "user-1"}
	if _, err := svc.UpdateUserOSSSetting(actor, OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "same-user",
		AccessKeyID: "old-id", AccessKeySecret: "old-secret", PathPrefix: defaultOSSPathPrefix,
	}); err != nil {
		t.Fatal(err)
	}
	// Windows 等系统的墙钟粒度较粗，短时间内的多次取样可能取到完全相同的值，
	// 使"资源创建于两次轮换之间"的前提失效（时间戳并列时无法分辨版本先后）。
	// 等待时钟推进，保证设置行、资源、第二次轮换三者的 CreatedAt 严格递增。
	advanceClock := func(after time.Time) time.Time {
		for {
			if now := time.Now(); now.After(after) {
				return now
			}
		}
	}
	createdAt := advanceClock(time.Now())
	legacy := &model.Resource{ID: "legacy-user-rotated-resource", UserID: actor.ID, Kind: "image", Status: model.ResourceStatusReady,
		Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "same-user", ObjectKey: defaultOSSPathPrefix + "/legacy.png", MimeType: "image/png", CreatedAt: createdAt}
	if err := svc.repo.CreateResource(legacy); err != nil {
		t.Fatal(err)
	}
	advanceClock(createdAt)
	if _, err := svc.UpdateUserOSSSetting(actor, OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "same-user",
		AccessKeyID: "new-id", AccessKeySecret: "new-secret", PathPrefix: defaultOSSPathPrefix,
	}); err != nil {
		t.Fatal(err)
	}
	setting, err := svc.ossSettingForResource(actor.ID, legacy)
	if err != nil {
		t.Fatal(err)
	}
	if setting.AccessKeyID != "old-id" || setting.AccessKeySecret != "old-secret" {
		t.Fatalf("legacy rotated user setting = %#v", setting)
	}
}

func TestPrepareResourceDeliveryKeepsForcedOriginDirectWithoutCDN(t *testing.T) {
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "private-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "resource-origin-direct", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "private-bucket",
		ObjectKey: "users/user-1/image/direct.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	delivery, err := svc.PrepareResourceDelivery("user-1", resource.ID, ResourceDeliveryOptions{ForceDirect: true})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(delivery.RedirectURL, "private-bucket.oss-cn-test.aliyuncs.com/users/user-1/image/direct.png") || !strings.Contains(delivery.RedirectURL, "Signature=") {
		t.Fatalf("PrepareResourceDelivery(force direct) = %#v", delivery)
	}
}

func TestPrepareResourceDeliveryUsesDirectURLForPublicS3Endpoint(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: s3Provider, Region: "us-east-1", Endpoint: "https://127.0.0.1", Bucket: "private-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "resource-public-s3", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: s3Provider, Endpoint: "https://127.0.0.1", Bucket: "private-bucket",
		ObjectKey: "users/user-1/image/public.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	delivery, err := svc.PrepareResourceDelivery("user-1", resource.ID, ResourceDeliveryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if delivery.RedirectURL == "" || !strings.Contains(delivery.RedirectURL, "X-Amz-Signature=") || delivery.Resource == nil {
		t.Fatalf("PrepareResourceDelivery() = %#v, want a direct S3 URL", delivery)
	}
	download, err := svc.PrepareResourceDelivery("user-1", resource.ID, ResourceDeliveryOptions{Download: true})
	if err != nil {
		t.Fatal(err)
	}
	if download.RedirectURL == "" || urlQueryValue(download.RedirectURL, "response-content-disposition") != "attachment; filename=resource-public-s3.png" {
		t.Fatalf("download delivery = %#v, want attachment disposition", download)
	}
}

func TestPrepareResourceDeliveryUsesConfiguredS3PublicDomain(t *testing.T) {
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: s3Provider, Region: "us-east-1", Endpoint: "https://127.0.0.1", CDNBaseURL: "https://media.example.com", Bucket: "private-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "resource-s3-public-domain", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: s3Provider, Endpoint: "https://127.0.0.1", Bucket: "private-bucket",
		ObjectKey: "users/user-1/image/public.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	delivery, err := svc.PrepareResourceDelivery("user-1", resource.ID, ResourceDeliveryOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if delivery.RedirectURL != "https://media.example.com/users/user-1/image/public.png" || delivery.Resource == nil {
		t.Fatalf("PrepareResourceDelivery() = %#v, want configured public domain", delivery)
	}
	if delivery.Resource.ID != resource.ID {
		t.Fatalf("delivery resource = %#v", delivery.Resource)
	}
	download, proxy, err := svc.BrowserResourceDownloadURL("user-1", resource.ID)
	if err != nil || proxy || download != "https://media.example.com/users/user-1/image/public.png" {
		t.Fatalf("BrowserResourceDownloadURL() = %q, %v, want configured public domain", download, err)
	}
	stableURL, stableProxy, stable, err := svc.BrowserResourceURLWithCachePolicy("user-1", resource.ID)
	if err != nil || stableProxy || !stable || stableURL != "https://media.example.com/users/user-1/image/public.png" {
		t.Fatalf("BrowserResourceURLWithCachePolicy() = %q, %v, %v, %v, want stable public domain", stableURL, stableProxy, stable, err)
	}
}

func TestUpdateOSSSettingPersistsS3PublicDomainOnBoundLocation(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	svc := newResourceTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	base := ossSettingValue{
		Enabled: true, Provider: s3Provider, Region: "us-east-1", Endpoint: "https://localhost",
		Bucket: "bucket", PathPrefix: defaultOSSPathPrefix, AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	}
	location, err := svc.upsertStorageLocation("platform", "", base)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	location.TestedAt = &now
	location.TestedDigest = storageTestDigest(base)
	if err := svc.repo.SaveStorageLocation(location); err != nil {
		t.Fatal(err)
	}
	base.StorageLocationID = location.ID
	settingJSON, err := json.Marshal(base)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{
		Enabled: true, Provider: s3Provider, Region: base.Region, Endpoint: base.Endpoint,
		CDNBaseURL: "https://localhost", Bucket: base.Bucket, PathPrefix: base.PathPrefix,
		AccessKeyID: base.AccessKeyID, AccessKeySecret: base.AccessKeySecret,
	}); err != nil {
		t.Fatal(err)
	}

	_, stored, err := svc.storageLocationValue(location.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.CDNBaseURL != "https://localhost" {
		t.Fatalf("stored S3 location CDNBaseURL = %q, want persisted public domain", stored.CDNBaseURL)
	}
	resource := &model.Resource{
		ID: "resource-bound-public-domain", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: s3Provider, Endpoint: base.Endpoint, Bucket: base.Bucket, ObjectKey: "kraftreel/users/user-1/image/public.png",
		StorageSettingID: location.ID, MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	url, proxy, err := svc.BrowserResourceURL(resource.UserID, resource.ID)
	if err != nil || proxy || url != "https://localhost/kraftreel/users/user-1/image/public.png" {
		t.Fatalf("BrowserResourceURL() = %q, %v, %v, want persisted public domain", url, proxy, err)
	}
}

func TestBoundResourceUsesCurrentS3PublicDomainWhenLocationPredatesDomain(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "localhost")
	svc := newResourceTestService(t)
	base := ossSettingValue{Enabled: true, Provider: s3Provider, Region: "us-east-1", Endpoint: "https://localhost", Bucket: "bucket", PathPrefix: defaultOSSPathPrefix, AccessKeyID: "access-id", AccessKeySecret: "secret-value"}
	location, err := svc.upsertStorageLocation("platform", "", base)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: mustResourceJSON(t, ossSettingValue{Enabled: true, Provider: s3Provider, Region: base.Region, Endpoint: base.Endpoint, CDNBaseURL: "https://localhost", Bucket: base.Bucket, PathPrefix: base.PathPrefix, AccessKeyID: base.AccessKeyID, AccessKeySecret: base.AccessKeySecret, StorageLocationID: location.ID})}); err != nil {
		t.Fatal(err)
	}
	resource := &model.Resource{ID: "resource-bound-existing-domain", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: s3Provider, Endpoint: base.Endpoint, Bucket: base.Bucket, ObjectKey: "kraftreel/users/user-1/image/public.png", StorageSettingID: location.ID, MimeType: "image/png"}
	if err := svc.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	got, proxy, err := svc.BrowserResourceURL(resource.UserID, resource.ID)
	if err != nil || proxy || got != "https://localhost/kraftreel/users/user-1/image/public.png" {
		t.Fatalf("BrowserResourceURL() = %q, %v, %v, want current public domain", got, proxy, err)
	}
}

func mustResourceJSON(t *testing.T, value interface{}) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func urlQueryValue(rawURL string, key string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return parsed.Query().Get(key)
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
	if err := svc.hydrateProviderMedia("user-1", &media, providerMediaHydrationPolicy{requireURL: true}); err != nil {
		t.Fatalf("hydrateProviderMedia() error = %v", err)
	}
	if !strings.HasPrefix(media.URL, "https://private-bucket.oss-cn-test.aliyuncs.com/") || media.DataURL != "" || !strings.Contains(media.URL, "Signature=") {
		t.Fatalf("media = %#v", media)
	}
	if err := svc.hydrateProviderMedia("other-user", &providerMedia{StorageKey: "resource:resource-1"}, providerMediaHydrationPolicy{requireURL: true}); err == nil {
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
	if err := svc.hydrateProviderMedia("user-1", &media, providerMediaHydrationPolicy{requireURL: true}); err != nil {
		t.Fatalf("hydrateProviderMedia() error = %v", err)
	}
	if !strings.HasPrefix(media.URL, server.URL+"/api/public/resources/resource-local/file/resource-local.png?") || !strings.Contains(media.URL, "signature=") || media.DataURL != "" {
		t.Fatalf("media = %#v", media)
	}
	stored, err := svc.repo.Resource("resource-local")
	if err != nil || stored.Provider != "local" {
		t.Fatalf("resource provider changed: %#v, %v", stored, err)
	}
}

func TestHydratePreferredURLUsesObjectStorageAndFallsBackLocal(t *testing.T) {
	svc := newResourceTestService(t)
	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: "aliyun", Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "private-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value",
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}
	objectResource := model.Resource{
		ID: "resource-oss", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: "aliyun", Endpoint: "https://oss-cn-test.aliyuncs.com", Bucket: "private-bucket",
		ObjectKey: "users/user-1/image/prefer.png", MimeType: "image/png",
	}
	if err := svc.repo.CreateResource(&objectResource); err != nil {
		t.Fatal(err)
	}
	media := providerMedia{StorageKey: "resource:resource-oss", DataURL: "data:image/png;base64,old"}
	if err := svc.hydrateProviderMedia("user-1", &media, providerMediaHydrationPolicy{preferURL: true}); err != nil {
		t.Fatalf("hydrateProviderMedia(prefer object) error = %v", err)
	}
	if !strings.HasPrefix(media.URL, "https://private-bucket.oss-cn-test.aliyuncs.com/") || media.DataURL != "" || !strings.Contains(media.URL, "Signature=") {
		t.Fatalf("object media = %#v", media)
	}

	localDir := filepath.Join(svc.dataDir, "resources", "users", "user-1", "image")
	if err := os.MkdirAll(localDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(localDir, "local.png"), []byte("png-bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	localResource := model.Resource{ID: "resource-local-bytes", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/user-1/image/local.png", MimeType: "image/png"}
	if err := svc.repo.CreateResource(&localResource); err != nil {
		t.Fatal(err)
	}
	localMedia := providerMedia{StorageKey: "resource:resource-local-bytes"}
	if err := svc.hydrateProviderMedia("user-1", &localMedia, providerMediaHydrationPolicy{preferURL: true}); err != nil {
		t.Fatalf("hydrateProviderMedia(prefer local) error = %v", err)
	}
	if localMedia.URL != "" || !strings.HasPrefix(localMedia.DataURL, "data:image/png;base64,") {
		t.Fatalf("local media = %#v", localMedia)
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

func TestUpdateOSSSettingBindsNonS3StorageLocation(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	svc := newResourceTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	setting, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "platform-assets",
		AccessKeyID: "platform-id", AccessKeySecret: "platform-secret", PathPrefix: defaultOSSPathPrefix,
	})
	if err != nil {
		t.Fatal(err)
	}
	if setting.StorageLocationID == "" {
		t.Fatal("platform non-S3 setting did not bind a storage location")
	}
	location, err := svc.repo.StorageLocation(setting.StorageLocationID)
	if err != nil {
		t.Fatal(err)
	}
	if location.Scope != "platform" || location.Provider != aliyunOSSProvider || !location.Active {
		t.Fatalf("platform storage location = %#v", location)
	}
	_, historical, err := svc.storageLocationValue(location.ID)
	if err != nil {
		t.Fatal(err)
	}
	if historical.Bucket != "platform-assets" || historical.AccessKeySecret != "platform-secret" {
		t.Fatalf("historical platform setting = %#v", historical)
	}
}

func TestPlatformOSSSettingSwitchKeepsHistoricalLocationBinding(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	svc := newResourceTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	first, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "platform-old",
		AccessKeyID: "old-id", AccessKeySecret: "old-secret", PathPrefix: defaultOSSPathPrefix,
	})
	if err != nil {
		t.Fatal(err)
	}
	oldResource := model.Resource{ID: "platform-old-resource", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "platform-old", StorageSettingID: first.StorageLocationID,
		ObjectKey: "platform-old.png", MimeType: "image/png"}
	if err := svc.repo.CreateResource(&oldResource); err != nil {
		t.Fatal(err)
	}
	second, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "platform-new",
		AccessKeyID: "new-id", AccessKeySecret: "new-secret", PathPrefix: defaultOSSPathPrefix,
	})
	if err != nil {
		t.Fatal(err)
	}
	if second.StorageLocationID == first.StorageLocationID {
		t.Fatal("platform location did not change after bucket switch")
	}
	historical, err := svc.ossSettingForResource(oldResource.UserID, &oldResource)
	if err != nil {
		t.Fatal(err)
	}
	if historical.Bucket != "platform-old" || historical.AccessKeyID != "old-id" || historical.AccessKeySecret != "old-secret" {
		t.Fatalf("historical platform resource setting = %#v", historical)
	}
}

func TestPlatformNonS3CredentialRotationCreatesNewLocationVersion(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	svc := newResourceTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	first, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "platform-assets",
		AccessKeyID: "old-id", AccessKeySecret: "old-secret", PathPrefix: defaultOSSPathPrefix,
	})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "platform-assets",
		AccessKeyID: "new-id", AccessKeySecret: "new-secret", PathPrefix: defaultOSSPathPrefix,
	})
	if err != nil {
		t.Fatal(err)
	}
	if first.StorageLocationID == second.StorageLocationID {
		t.Fatal("platform credential rotation reused the historical storage location")
	}
	oldLocation, err := svc.repo.StorageLocation(first.StorageLocationID)
	if err != nil {
		t.Fatal(err)
	}
	_, oldValue, err := svc.storageLocationValue(oldLocation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if oldValue.AccessKeyID != "old-id" || oldValue.AccessKeySecret != "old-secret" {
		t.Fatalf("old platform credentials changed: %#v", oldValue)
	}
}

func TestLegacyPlatformResourceFindsHistoricalLocationByStorageIdentity(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	svc := newResourceTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	first, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "legacy-platform",
		AccessKeyID: "old-id", AccessKeySecret: "old-secret", PathPrefix: defaultOSSPathPrefix,
	})
	if err != nil {
		t.Fatal(err)
	}
	legacy := &model.Resource{ID: "legacy-platform-resource", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "legacy-platform", ObjectKey: "legacy.png", MimeType: "image/png"}
	if err := svc.repo.CreateResource(legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{
		Enabled: true, Provider: qiniuKodoProvider, Endpoint: server.URL, Bucket: "new-platform",
		AccessKeyID: "new-id", AccessKeySecret: "new-secret", PathPrefix: defaultOSSPathPrefix,
	}); err != nil {
		t.Fatal(err)
	}
	setting, err := svc.ossSettingForResource(legacy.UserID, legacy)
	if err != nil {
		t.Fatal(err)
	}
	if setting.Provider != aliyunOSSProvider || setting.Bucket != first.Bucket || setting.AccessKeyID != "old-id" || setting.AccessKeySecret != "old-secret" {
		t.Fatalf("legacy platform setting = %#v", setting)
	}
}

func TestLegacyPlatformResourceUsesLocationCreatedBeforeCredentialRotation(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	svc := newResourceTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	first, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "same-platform",
		AccessKeyID: "old-id", AccessKeySecret: "old-secret", PathPrefix: defaultOSSPathPrefix,
	})
	if err != nil {
		t.Fatal(err)
	}
	createdAt := time.Now()
	legacy := &model.Resource{ID: "legacy-rotated-resource", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "same-platform", ObjectKey: defaultOSSPathPrefix + "/legacy.png", MimeType: "image/png", CreatedAt: createdAt}
	if err := svc.repo.CreateResource(legacy); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateOSSSetting(admin, OSSSettingRequest{
		Enabled: true, Provider: aliyunOSSProvider, Endpoint: server.URL, Bucket: "same-platform",
		AccessKeyID: "new-id", AccessKeySecret: "new-secret", PathPrefix: defaultOSSPathPrefix,
	}); err != nil {
		t.Fatal(err)
	}
	setting, err := svc.ossSettingForResource(legacy.UserID, legacy)
	if err != nil {
		t.Fatal(err)
	}
	if setting.AccessKeyID != "old-id" || setting.AccessKeySecret != "old-secret" || first.StorageLocationID == "" {
		t.Fatalf("legacy rotated platform setting = %#v", setting)
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
	mode, err := svc.effectiveResourceStorageMode(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mode != "oss" {
		t.Fatalf("effectiveResourceStorageMode() = %q, want oss", mode)
	}
}

func TestEffectiveResourceStorageModeUsesPlatformWhenUserStorageIsDisabled(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()
	svc := newResourceTestService(t)
	actor := &model.User{ID: "user-1"}

	mode, err := svc.effectiveResourceStorageMode(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mode != "local" {
		t.Fatalf("effectiveResourceStorageMode() without settings = %q, want local", mode)
	}
	systemJSON, _ := json.Marshal(ossSettingValue{Enabled: true, Provider: "aliyun", Endpoint: server.URL, Bucket: "system", AccessKeyID: "system-id", AccessKeySecret: "system-secret"})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(systemJSON)}); err != nil {
		t.Fatal(err)
	}
	mode, err = svc.effectiveResourceStorageMode(actor.ID)
	if err != nil {
		t.Fatal(err)
	}
	if mode != "oss" {
		t.Fatalf("effectiveResourceStorageMode() with platform storage = %q, want oss", mode)
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
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.StorageLocation{}, &model.UserDailyUploadUsage{}, &model.Resource{}, &model.SessionFile{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: t.TempDir()}
}

func TestStoreResourceReusesReadyUploadIdentity(t *testing.T) {
	svc := newResourceTestService(t)
	uploadKey := normalizedResourceUploadKey([]string{"image:user-1:logical-upload"})
	first, stored, err := svc.storeResource("user-1", "image", "first.png", "image/png", 7, 1, 1, 0, bytes.NewReader([]byte("payload")), uploadKey, false)
	if err != nil {
		t.Fatal(err)
	}
	if !stored {
		t.Fatal("first upload was not stored")
	}
	second, stored, err := svc.storeResource("user-1", "image", "second.png", "image/png", 7, 1, 1, 0, bytes.NewReader([]byte("payload")), uploadKey, false)
	if err != nil {
		t.Fatal(err)
	}
	if stored || second.ID != first.ID || second.ObjectKey != first.ObjectKey {
		t.Fatalf("idempotent upload = %#v, stored=%v; first=%#v", second, stored, first)
	}
	resources, err := svc.repo.Resources("user-1", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(resources) != 1 {
		t.Fatalf("resource count = %d, want 1", len(resources))
	}
}

func TestRetryStoredResourceKeepsOriginalObjectKey(t *testing.T) {
	svc := newResourceTestService(t)
	uploadKey := normalizedResourceUploadKey([]string{"image:user-1:retry-upload"})
	failed := &model.Resource{
		ID: "resource-failed", UserID: "user-1", Kind: "image", Status: model.ResourceStatusFailed,
		Provider: "local", ObjectKey: "users/user-1/image/fixed.png", MimeType: "image/png", Size: 7,
		UploadKey: uploadKey, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := svc.repo.CreateResource(failed); err != nil {
		t.Fatal(err)
	}
	retried, err := svc.retryStoredResource("user-1", failed, "image", "image/png", 7, bytes.NewReader([]byte("payload")))
	if err != nil {
		t.Fatal(err)
	}
	if retried.ID != failed.ID || retried.ObjectKey != "users/user-1/image/fixed.png" || retried.Status != model.ResourceStatusReady {
		t.Fatalf("retried resource = %#v", retried)
	}
	resources, err := svc.repo.Resources("user-1", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(resources) != 1 {
		t.Fatalf("resource count = %d, want 1", len(resources))
	}
	day := time.Now().UTC().Format("2006-01-02")
	usage, err := svc.repo.DailyUploadBytes("user-1", day)
	if err != nil {
		t.Fatal(err)
	}
	if usage != 7 {
		t.Fatalf("daily upload usage = %d, want 7", usage)
	}
}

func TestRetryStoredResourceReleasesDailyQuotaAfterFailure(t *testing.T) {
	svc := newResourceTestService(t)
	uploadKey := normalizedResourceUploadKey([]string{"image:user-1:failed-retry"})
	failed := &model.Resource{
		ID: "resource-failed-retry", UserID: "user-1", Kind: "image", Status: model.ResourceStatusFailed,
		Provider: "local", ObjectKey: "users/user-1/image/failed.png", MimeType: "image/png", Size: 7,
		UploadKey: uploadKey, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	if err := svc.repo.CreateResource(failed); err != nil {
		t.Fatal(err)
	}
	_, err := svc.retryStoredResource("user-1", failed, "image", "image/png", 7, iotest.ErrReader(errors.New("write failed")))
	if err == nil || !strings.Contains(err.Error(), "write failed") {
		t.Fatalf("retryStoredResource() error = %v", err)
	}
	day := time.Now().UTC().Format("2006-01-02")
	usage, usageErr := svc.repo.DailyUploadBytes("user-1", day)
	if usageErr != nil {
		t.Fatal(usageErr)
	}
	if usage != 0 {
		t.Fatalf("daily upload usage = %d, want 0", usage)
	}
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
	wantQuotaMessage := strconv.FormatInt(defaultRuntimePolicy().Resource.StoredFileGB, 10) + "GB 上限"
	if err == nil || !strings.Contains(err.Error(), wantQuotaMessage) {
		t.Fatalf("persistGeneratedMediaResult() error = %v", err)
	}
}
