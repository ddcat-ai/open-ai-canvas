package assets

import (
	"net/url"
	"testing"
	"time"

	"yingce/backend/internal/storage"
)

func TestThumbnailAccessUsesActualStorage(t *testing.T) {
	now := time.Date(2026, time.November, 26, 3, 0, 0, 0, time.UTC)
	setting := storage.Settings{Provider: "aliyun", Endpoint: "https://1.1.1.1", Bucket: "images", AccessKeyID: "test-id", AccessKeySecret: "test-secret"}
	for _, provider := range []string{"local", "aliyun"} {
		t.Run(provider, func(t *testing.T) {
			resource := testReadyResource(provider)
			resource.Kind, resource.Size, resource.Width, resource.Height = "image", 3<<20, 4096, 2048
			var variants []ResourceVariant
			access, err := ResolveAccess(resource, setting, AccessOptions{Purpose: PurposeDisplay, Variant: VariantThumbnail}, now, testPlatformURL(&variants))
			if err != nil {
				t.Fatal(err)
			}
			parsed, err := url.Parse(access.URL)
			if err != nil {
				t.Fatal(err)
			}
			if provider == "local" {
				if access.Delivery != DeliveryLocal || access.ActualVariant != VariantOriginal || parsed.Query().Has("x-oss-process") || len(variants) != 1 {
					t.Fatalf("local image must remain local: %#v", access)
				}
				return
			}
			if access.Delivery != DeliveryOrigin || access.ActualVariant != VariantThumbnail || access.FallbackReason != "" || len(variants) != 0 {
				t.Fatalf("OSS thumbnail access = %#v", access)
			}
			if parsed.Query().Get("x-oss-process") != "image/resize,l_960,limit_1/format,webp" || parsed.Query().Get("Signature") == "" {
				t.Fatalf("missing bounded, signed OSS transform: %s", access.URL)
			}
			// The browser must retain the original dimensions when displaying a small image.
			if access.OriginalWidth != 4096 || access.OriginalHeight != 2048 {
				t.Fatalf("original dimensions lost: %#v", access)
			}
		})
	}
}

func TestThumbnailAccessPreservesOriginalForProcessingAndDownloads(t *testing.T) {
	resource := testReadyResource("aliyun")
	resource.Kind, resource.Size = "image", 3<<20
	setting := storage.Settings{Provider: "aliyun", Endpoint: "https://1.1.1.1", Bucket: "images", AccessKeyID: "test-id", AccessKeySecret: "test-secret"}
	for _, purpose := range []AccessPurpose{PurposeCopy, PurposeDownload, PurposeProcess, PurposeProvider, PurposeEcommerceExport} {
		t.Run(string(purpose), func(t *testing.T) {
			access, err := ResolveAccess(resource, setting, AccessOptions{Purpose: purpose, Variant: VariantThumbnail}, time.Now(), testPlatformURL(&[]ResourceVariant{}))
			if err != nil {
				t.Fatal(err)
			}
			parsed, _ := url.Parse(access.URL)
			if access.ActualVariant != VariantOriginal || parsed.Query().Has("x-oss-process") {
				t.Fatalf("%s must use original bytes: %#v", purpose, access)
			}
		})
	}
}

func TestThumbnailAccessRejectsUnsupportedOSSInputs(t *testing.T) {
	setting := storage.Settings{Provider: "aliyun", Endpoint: "https://1.1.1.1", Bucket: "images", AccessKeyID: "test-id", AccessKeySecret: "test-secret"}
	for _, input := range []struct {
		name          string
		size          int64
		width, height int
		mime          string
	}{
		{"oversized file", 21 << 20, 4096, 4096, "image/png"},
		{"oversized edge", 1 << 20, 30001, 100, "image/png"},
		{"oversized pixels", 1 << 20, 20000, 20000, "image/png"},
		{"unsupported format", 1 << 20, 100, 100, "image/svg+xml"},
	} {
		t.Run(input.name, func(t *testing.T) {
			resource := testReadyResource("aliyun")
			resource.Kind, resource.Size, resource.Width, resource.Height, resource.MimeType = "image", input.size, input.width, input.height, input.mime
			_, err := ResolveAccess(resource, setting, AccessOptions{Purpose: PurposeDisplay, Variant: VariantThumbnail}, time.Now(), testPlatformURL(&[]ResourceVariant{}))
			if err == nil || errorReason(err) != "resource_thumbnail_unsupported" {
				t.Fatalf("unsupported thumbnail must fail without falling back to original: %v", err)
			}
		})
	}
}

func TestThumbnailAccessUsesPublicCDNAndLeavesOtherProvidersAlone(t *testing.T) {
	for _, provider := range []string{"aliyun", "s3", "tencent", "qiniu", "volcengine"} {
		t.Run(provider, func(t *testing.T) {
			resource := testReadyResource(provider)
			resource.Kind, resource.Size = "image", 1<<20
			setting := storage.Settings{Provider: provider, CDNBaseURL: "https://media.example.com", Delivery: storage.DeliverySettings{CDNAuthMode: "public"}}
			access, err := ResolveAccess(resource, setting, AccessOptions{Purpose: PurposeDisplay, Variant: VariantThumbnail}, time.Now(), testPlatformURL(&[]ResourceVariant{}))
			if err != nil {
				t.Fatal(err)
			}
			parsed, _ := url.Parse(access.URL)
			if access.Delivery != DeliveryCDN || parsed.Host != "media.example.com" || access.ExpiresAt != nil {
				t.Fatalf("public CDN access = %#v", access)
			}
			if provider == "aliyun" {
				if access.ActualVariant != VariantThumbnail || parsed.Query().Get("x-oss-process") != "image/resize,l_960,limit_1/format,webp" {
					t.Fatalf("public OSS CDN thumbnail = %#v", access)
				}
			} else if access.ActualVariant != VariantOriginal || parsed.Query().Has("x-oss-process") {
				t.Fatalf("OSS transform leaked to %s: %#v", provider, access)
			}
		})
	}
}
