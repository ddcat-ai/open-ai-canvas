package app

import (
	"encoding/json"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

func TestLocalThumbnailAccessNeverUsesConfiguredOSS(t *testing.T) {
	for _, configured := range []bool{false, true} {
		t.Run(map[bool]string{false: "without OSS", true: "with OSS default"}[configured], func(t *testing.T) {
			svc := newResourceTestService(t)
			if configured {
				setting, _ := json.Marshal(ossSettingValue{Enabled: true, Provider: "aliyun", Endpoint: "https://1.1.1.1", Bucket: "images", AccessKeyID: "test-id", AccessKeySecret: "test-secret"})
				if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(setting)}); err != nil {
					t.Fatal(err)
				}
			}
			resource := model.Resource{ID: "local-thumbnail", UserID: "user-1", Kind: "image", Provider: "local", Status: model.ResourceStatusReady, ObjectKey: "local.png", MimeType: "image/png", Size: 5}
			if err := os.MkdirAll(filepath.Join(svc.dataDir, "resources"), 0o750); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", resource.ObjectKey), []byte("local"), 0o600); err != nil {
				t.Fatal(err)
			}
			if err := svc.repo.CreateResource(&resource); err != nil {
				t.Fatal(err)
			}
			delivery, err := svc.PrepareResourceDelivery(resource.UserID, resource.ID, ResourceAccessOptions{Purpose: assets.PurposeDisplay, Variant: assets.VariantThumbnail}, "")
			if err != nil {
				t.Fatal(err)
			}
			if delivery.Access.Delivery != assets.DeliveryLocal || delivery.Access.ActualVariant != assets.VariantOriginal || delivery.Stream == nil {
				t.Fatalf("local delivery changed: %#v", delivery)
			}
			defer delivery.Stream.Body.Close()
			data, err := io.ReadAll(delivery.Stream.Body)
			if err != nil || string(data) != "local" {
				t.Fatalf("local bytes = %q, %v", data, err)
			}
		})
	}
}

func TestOSSThumbnailAccessBatchChecksOwnershipAndDoesNotOpenMedia(t *testing.T) {
	svc := newResourceTestService(t)
	setting, _ := json.Marshal(ossSettingValue{Enabled: true, Provider: "aliyun", Endpoint: "https://1.1.1.1", Bucket: "images", AccessKeyID: "test-id", AccessKeySecret: "test-secret"})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(setting)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "oss-thumbnail", UserID: "user-1", Kind: "image", Provider: "aliyun", Endpoint: "https://1.1.1.1", Bucket: "images", Status: model.ResourceStatusReady, ObjectKey: "image.png", MimeType: "image/png", Size: 1 << 20, Width: 4096, Height: 2048}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	options := ResourceAccessOptions{Purpose: assets.PurposeDisplay, Variant: assets.VariantThumbnail}
	results, err := svc.ResourceAccessBatch(resource.UserID, []ResourceAccessRequest{{ResourceID: resource.ID, AccessOptions: options}})
	if err != nil || len(results) != 1 || results[0].Access == nil {
		t.Fatalf("thumbnail access = %#v, %v", results, err)
	}
	parsed, _ := url.Parse(results[0].Access.URL)
	if results[0].Access.ActualVariant != assets.VariantThumbnail || parsed.Query().Get("x-oss-process") == "" || results[0].Access.OriginalWidth != 4096 {
		t.Fatalf("thumbnail descriptor = %#v", results[0].Access)
	}
	delivery, err := svc.PrepareResourceDelivery(resource.UserID, resource.ID, options, "")
	if err != nil || delivery.Stream != nil || delivery.Access.Delivery != assets.DeliveryOrigin {
		t.Fatalf("OSS thumbnail must be direct delivery: %#v, %v", delivery, err)
	}
	denied, err := svc.ResourceAccessBatch("another-user", []ResourceAccessRequest{{ResourceID: resource.ID, AccessOptions: options}})
	if err != nil || len(denied) != 1 || denied[0].Access != nil || denied[0].Error == nil {
		t.Fatalf("thumbnail bypassed ownership: %#v, %v", denied, err)
	}
}
