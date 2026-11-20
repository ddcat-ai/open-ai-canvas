package app

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

func TestEcommerceExportRequiresResourceOwner(t *testing.T) {
	svc := newResourceTestService(t)
	resource := model.Resource{ID: "commerce-export-image", UserID: "owner", Kind: "image", Provider: "local", Status: model.ResourceStatusReady, ObjectKey: "image.png", MimeType: "image/png", Size: 1024}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	request := []ResourceAccessRequest{{ResourceID: resource.ID, AccessOptions: ResourceAccessOptions{Purpose: assets.PurposeEcommerceExport}}}
	result, err := svc.ResourceAccessBatch("owner", request)
	if err != nil || len(result) != 1 || result[0].Access == nil || result[0].Access.Delivery != assets.DeliveryProxy || !strings.Contains(result[0].Access.URL, "purpose=ecommerce-export") {
		t.Fatalf("owner export access = %#v, %v", result, err)
	}
	other, err := svc.ResourceAccessBatch("other", request)
	if err != nil || len(other) != 1 || other[0].Access != nil || other[0].Error == nil {
		t.Fatalf("cross-user export accepted: %#v, %v", other, err)
	}
	if _, err := svc.ResourceAccessBatch("", request); err == nil {
		t.Fatal("guest export accepted")
	}
}

func TestEcommerceProcessingReadsOwnedOriginBytesWithoutCDNRedirect(t *testing.T) {
	svc := newResourceTestService(t)
	if err := os.WriteFile(filepath.Join(svc.dataDir, ".settings-key"), make([]byte, 32), 0o600); err != nil {
		t.Fatal(err)
	}
	setting := ossSettingValue{Enabled: true, Provider: aliyunOSSProvider, Endpoint: "https://oss-cn-hangzhou.aliyuncs.com", Bucket: "test-bucket", CDNBaseURL: "https://media.example.com", AccessKeyID: "test-id", AccessKeySecret: "test-secret", Delivery: storage.DeliverySettings{CDNAuthMode: "public"}}
	encoded, _ := json.Marshal(setting)
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "commerce-processing-image", UserID: "owner", Kind: "image", Provider: aliyunOSSProvider, Endpoint: setting.Endpoint, Bucket: setting.Bucket, Status: model.ResourceStatusReady, ObjectKey: "users/owner/reference.png", MimeType: "image/png", Size: 6}
	if err := svc.repo.CreateResource(&resource); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ossSettingForResource("owner", &resource); err != nil {
		t.Fatalf("processing storage fixture: %v", err)
	}
	originalGet := getOriginOSSObjectRange
	t.Cleanup(func() { getOriginOSSObjectRange = originalGet })
	reads := 0
	getOriginOSSObjectRange = func(actual storage.Settings, key, _ string) (*storage.ObjectStream, error) {
		reads++
		if actual.Endpoint != setting.Endpoint || actual.Bucket != setting.Bucket || key != resource.ObjectKey {
			t.Fatal("processing did not retain the resource's actual storage identity")
		}
		return &storage.ObjectStream{Body: io.NopCloser(strings.NewReader("pixels")), StatusCode: http.StatusOK, ContentLength: 6}, nil
	}
	options := ResourceAccessOptions{Purpose: assets.PurposeEcommerceExport}
	for _, user := range []string{"", "other-owner"} {
		if _, err := svc.PrepareResourceDelivery(user, resource.ID, options, ""); err == nil {
			t.Fatalf("processing accepted unowned resource for %q", user)
		}
	}
	if reads != 0 {
		t.Fatal("authorization refusal read origin bytes")
	}
	display, err := svc.PrepareResourceDelivery("owner", resource.ID, ResourceAccessOptions{Purpose: assets.PurposeDisplay}, "")
	if err != nil || display.Access.Delivery != assets.DeliveryCDN || display.Stream != nil || reads != 0 {
		t.Fatalf("display policy changed: %#v, %v", display, err)
	}
	delivery, err := svc.PrepareResourceDelivery("owner", resource.ID, options, "")
	if err != nil {
		t.Fatal(err)
	}
	if delivery.Stream == nil || delivery.Access.Delivery != assets.DeliveryProxy || delivery.Access.URL != "/api/resources/commerce-processing-image/file?purpose=ecommerce-export" {
		t.Fatalf("processing returned a redirect instead of an authenticated byte stream: %#v", delivery)
	}
	defer delivery.Stream.Body.Close()
	body, err := io.ReadAll(delivery.Stream.Body)
	if err != nil || string(body) != "pixels" || reads != 1 {
		t.Fatalf("processing bytes = %q, reads = %d, error = %v", body, reads, err)
	}
}
