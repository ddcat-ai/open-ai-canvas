package assets

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound/outboundtest"
	"yingce/backend/internal/storage"
)

func testReadyResource(provider string) *model.Resource {
	return &model.Resource{
		ID: "resource-1", UserID: "user-1", Provider: provider, ObjectKey: "users/user-1/image/test.png",
		Status: model.ResourceStatusReady, MimeType: "image/png", ETag: "etag-1",
	}
}

func testPlatformURL(variants *[]ResourceVariant) func(ResourceVariant, time.Time) (string, error) {
	return func(variant ResourceVariant, _ time.Time) (string, error) {
		*variants = append(*variants, variant)
		return "https://canvas.example/api/resources/resource-1/file", nil
	}
}

func TestResolveAccessPolicyMatrix(t *testing.T) {
	outboundtest.PublicDNS(t, "s3.amazonaws.com")
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	tests := []struct {
		name       string
		resource   *model.Resource
		setting    storage.Settings
		options    AccessOptions
		wantMode   DeliveryMode
		wantReason string
		wantURL    string
		wantErr    string
	}{
		{
			name:     "local uses platform controlled URL",
			resource: testReadyResource("local"),
			options:  AccessOptions{Purpose: PurposeDisplay},
			wantMode: DeliveryLocal,
			wantURL:  "https://canvas.example/api/resources/resource-1/file",
		},
		{
			name:     "public CDN uses CDN URL",
			resource: testReadyResource("aliyun"),
			setting:  storage.Settings{Provider: "aliyun", CDNBaseURL: "https://media.example.com", Delivery: storage.DeliverySettings{CDNAuthMode: "public"}},
			options:  AccessOptions{Purpose: PurposeCopy},
			wantMode: DeliveryCDN,
			wantURL:  "https://media.example.com/users/user-1/image/test.png",
		},
		{
			name:     "CDN without supported auth falls back to public origin",
			resource: testReadyResource("aliyun"),
			setting:  storage.Settings{Provider: "aliyun", Endpoint: "https://s3.amazonaws.com", Bucket: "private-bucket", CDNBaseURL: "https://media.example.com", AccessKeyID: "id", AccessKeySecret: "secret"},
			options:  AccessOptions{Purpose: PurposeDisplay},
			wantMode: DeliveryOrigin, wantReason: "cdn_auth_unconfigured",
		},
		{
			name:     "require CDN rejects incomplete CDN auth",
			resource: testReadyResource("aliyun"),
			setting:  storage.Settings{Provider: "aliyun", Endpoint: "https://s3.amazonaws.com", CDNBaseURL: "https://media.example.com", AccessKeyID: "id", AccessKeySecret: "secret", Delivery: storage.DeliverySettings{RequireCDN: true}},
			options:  AccessOptions{Purpose: PurposeDisplay},
			wantErr:  "resource_cdn_unconfigured",
		},
		{
			name:     "browser access never proxies a private OSS origin",
			resource: testReadyResource("aliyun"),
			setting:  storage.Settings{Provider: "aliyun", Endpoint: "http://storage.internal", Delivery: storage.DeliverySettings{AllowPrivateProxy: true}},
			options:  AccessOptions{Purpose: PurposeDisplay},
			wantErr:  "resource_origin_private",
		},
		{
			name:     "provider input may use an explicitly enabled private proxy",
			resource: testReadyResource("aliyun"),
			setting:  storage.Settings{Provider: "aliyun", Endpoint: "http://storage.internal", Delivery: storage.DeliverySettings{AllowPrivateProxy: true}},
			options:  AccessOptions{Purpose: PurposeProvider},
			wantMode: DeliveryProxy, wantReason: "private_origin",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var variants []ResourceVariant
			access, err := ResolveAccess(tt.resource, tt.setting, tt.options, now, testPlatformURL(&variants))
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(string(errorReason(err)), tt.wantErr) {
					t.Fatalf("ResolveAccess() error = %v, want reason %q", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("ResolveAccess() error = %v", err)
			}
			if access.Delivery != tt.wantMode || access.FallbackReason != tt.wantReason {
				t.Fatalf("ResolveAccess() = %#v, want mode=%q reason=%q", access, tt.wantMode, tt.wantReason)
			}
			if tt.wantMode == DeliveryOrigin {
				parsed, err := url.Parse(access.URL)
				if err != nil || parsed.Host != "private-bucket.s3.amazonaws.com" || parsed.Query().Get("Signature") == "" {
					t.Fatalf("invalid signed origin URL: %q (%v)", access.URL, err)
				}
			}
			if tt.wantURL != "" && access.URL != tt.wantURL {
				t.Fatalf("ResolveAccess().URL = %q, want %q", access.URL, tt.wantURL)
			}
		})
	}
}

func TestResolveAccessVariantAndExpiryContract(t *testing.T) {
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	resource := testReadyResource("local")
	resource.Kind = "video"
	resource.PlaybackStatus = model.PlaybackStatusReady
	resource.PlaybackObjectKey = "playback/resource-1.mp4"
	var variants []ResourceVariant
	access, err := ResolveAccess(resource, storage.Settings{}, AccessOptions{Purpose: PurposeProcess, Variant: VariantPlayback, ExpiresAt: now.Add(90 * time.Second)}, now, testPlatformURL(&variants))
	if err != nil {
		t.Fatal(err)
	}
	if access.ActualVariant != VariantPlayback || access.ExpiresAt == nil || !access.ExpiresAt.Equal(now.Add(90*time.Second)) {
		t.Fatalf("playback access = %#v", access)
	}
	if len(variants) != 1 || variants[0] != VariantPlayback {
		t.Fatalf("platform URL variants = %#v, want playback", variants)
	}

	provider, err := ResolveAccess(resource, storage.Settings{}, AccessOptions{Purpose: PurposeProvider}, now, testPlatformURL(&variants))
	if err != nil {
		t.Fatal(err)
	}
	if provider.ExpiresAt == nil || !provider.ExpiresAt.Equal(now.Add(4*time.Hour)) {
		t.Fatalf("provider access expiry = %v, want %v", provider.ExpiresAt, now.Add(4*time.Hour))
	}
}

func TestResolveDownloadUsesPublicCDNAttachment(t *testing.T) {
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	resource := testReadyResource("aliyun")
	setting := storage.Settings{
		Provider: "aliyun", CDNBaseURL: "https://media.example.com",
		Delivery: storage.DeliverySettings{CDNAuthMode: "public"},
	}
	access, err := ResolveAccess(resource, setting, AccessOptions{Purpose: PurposeDownload, DownloadName: "画布_镜头01.mp4"}, now, testPlatformURL(&[]ResourceVariant{}))
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(access.URL)
	if err != nil {
		t.Fatal(err)
	}
	disposition := parsed.Query().Get("response-content-disposition")
	if access.Delivery != DeliveryCDN || access.ExpiresAt != nil || parsed.Host != "media.example.com" || !strings.HasPrefix(disposition, "attachment") || !strings.Contains(strings.ToLower(disposition), "utf-8''") {
		t.Fatalf("download access = %#v, disposition=%q", access, disposition)
	}
}

func TestResolveDownloadRejectsPrivateOriginInsteadOfProxyingMediaBytes(t *testing.T) {
	setting := storage.Settings{
		Provider: "aliyun", Endpoint: "http://storage.internal", Bucket: "private-bucket",
		Delivery: storage.DeliverySettings{AllowPrivateProxy: true},
	}
	_, err := ResolveAccess(testReadyResource("aliyun"), setting, AccessOptions{Purpose: PurposeDownload}, time.Now(), testPlatformURL(&[]ResourceVariant{}))
	if err == nil || errorReason(err) != "resource_origin_private" {
		t.Fatalf("ResolveAccess() error = %v, want resource_origin_private", err)
	}
}

func TestResolveAccessRejectsPendingResource(t *testing.T) {
	resource := testReadyResource("local")
	resource.Status = model.ResourceStatusPending
	_, err := ResolveAccess(resource, storage.Settings{}, AccessOptions{Purpose: PurposeDisplay}, time.Now(), func(ResourceVariant, time.Time) (string, error) {
		return "", nil
	})
	if err == nil || !strings.Contains(string(errorReason(err)), "resource_not_ready") {
		t.Fatalf("ResolveAccess() error = %v, want resource_not_ready", err)
	}
}

func errorReason(err error) string {
	if appErr, ok := err.(*kernel.AppError); ok {
		return string(appErr.Reason)
	}
	return err.Error()
}

func TestResolveAccessUsesRuntimePolicyTTL(t *testing.T) {
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	resource := testReadyResource("local")
	setting := storage.Settings{Runtime: storage.RuntimePolicy{AccessURLTTL: 2 * time.Hour, ProviderAccessURLTTL: 6 * time.Hour}}
	var variants []ResourceVariant
	// 展示地址按 ttl/4（30 分钟）对齐签名窗口：03:04:05 落在 03:00 窗口，过期于 05:00；模型输入仍按当前时间签发。
	for purpose, want := range map[AccessPurpose]time.Time{PurposeDisplay: time.Date(2026, time.January, 2, 5, 0, 0, 0, time.UTC), PurposeProvider: now.Add(6 * time.Hour)} {
		access, err := ResolveAccess(resource, setting, AccessOptions{Purpose: purpose}, now, testPlatformURL(&variants))
		if err != nil {
			t.Fatal(err)
		}
		if access.ExpiresAt == nil || !access.ExpiresAt.Equal(want) {
			t.Fatalf("%s access expiry = %v, want %v", purpose, access.ExpiresAt, want)
		}
	}
}

func TestResolveDisplayAccessIsStableWithinSigningWindow(t *testing.T) {
	setting := storage.Settings{
		Provider: "aliyun", Endpoint: "https://1.1.1.1", Bucket: "private-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value",
		Runtime: storage.RuntimePolicy{AccessURLTTL: 24 * time.Hour},
	}
	resource := testReadyResource("aliyun")
	first, err := ResolveAccess(resource, setting, AccessOptions{Purpose: PurposeDisplay}, time.Date(2026, time.September, 30, 18, 0, 1, 0, time.UTC), testPlatformURL(&[]ResourceVariant{}))
	if err != nil {
		t.Fatal(err)
	}
	// 刷新画布（同一 6 小时窗口内再次签发）必须拿到逐字节相同的地址，浏览器才能复用 HTTP 缓存。
	again, err := ResolveAccess(resource, setting, AccessOptions{Purpose: PurposeDisplay}, time.Date(2026, time.September, 30, 23, 59, 0, 0, time.UTC), testPlatformURL(&[]ResourceVariant{}))
	if err != nil {
		t.Fatal(err)
	}
	if first.Delivery != DeliveryOrigin || first.URL != again.URL {
		t.Fatalf("display URL changed within one signing window:\n%s\n%s", first.URL, again.URL)
	}
	if cacheControl := mustQuery(t, first.URL).Get("response-cache-control"); !strings.Contains(cacheControl, "max-age=86400") || !strings.Contains(cacheControl, "immutable") {
		t.Fatalf("display URL cache-control = %q", cacheControl)
	}
	next, err := ResolveAccess(resource, setting, AccessOptions{Purpose: PurposeDisplay}, time.Date(2026, time.October, 1, 0, 0, 1, 0, time.UTC), testPlatformURL(&[]ResourceVariant{}))
	if err != nil {
		t.Fatal(err)
	}
	if next.URL == first.URL {
		t.Fatal("next signing window must rotate the display URL")
	}
	// 下载地址携带一次性 Content-Disposition，不做对齐也不附加长缓存。
	download, err := ResolveAccess(resource, setting, AccessOptions{Purpose: PurposeDownload}, time.Now(), testPlatformURL(&[]ResourceVariant{}))
	if err != nil {
		t.Fatal(err)
	}
	if mustQuery(t, download.URL).Get("response-cache-control") != "" {
		t.Fatalf("download URL must not carry display cache override: %s", download.URL)
	}
}

func TestResolveAccessAcceptsThumbnailVariantWithOriginalFallback(t *testing.T) {
	now := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	var variants []ResourceVariant
	access, err := ResolveAccess(testReadyResource("local"), storage.Settings{}, AccessOptions{Purpose: PurposeDisplay, Variant: VariantThumbnail}, now, testPlatformURL(&variants))
	if err != nil {
		t.Fatalf("thumbnail variant must not fail (the canvas would fall back to the redirecting platform URL): %v", err)
	}
	if access.RequestedVariant != VariantThumbnail || access.ActualVariant != VariantOriginal || access.FallbackReason != "thumbnail_not_ready" {
		t.Fatalf("thumbnail access = %#v", access)
	}
	if len(variants) != 1 || variants[0] != VariantOriginal {
		t.Fatalf("platform URL variants = %#v, want original", variants)
	}
}

func mustQuery(t *testing.T, raw string) url.Values {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed.Query()
}
