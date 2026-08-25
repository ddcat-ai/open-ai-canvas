package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCollectOwnedAssetDocumentReferences(t *testing.T) {
	resources := map[string]struct{}{}
	raw := `{
		"data":{"storageKey":"resource:resource-1","url":"/api/resources/resource-2/file"},
		"metadata":{"taskId":"task-1","referenceResourceIds":["resource-3"],"errorDetails":"failed near /api/resources/not-a-reference/file"}
	}`
	if err := collectOwnedAssetDocumentReferences(raw, resources); err != nil {
		t.Fatal(err)
	}
	for _, resourceID := range []string{"resource-1", "resource-2", "resource-3"} {
		if _, exists := resources[resourceID]; !exists {
			t.Fatalf("resource %q was not collected: %#v", resourceID, resources)
		}
	}
	if _, exists := resources["not-a-reference"]; exists {
		t.Fatalf("diagnostic text must not be treated as an actual resource reference: %#v", resources)
	}
}

func TestResourceReferenceFieldsUseExplicitSchema(t *testing.T) {
	resources := map[string]struct{}{}
	raw := `{
		"storage_key":"resource:legacy-snake-case",
		"resourceStorageKey":"resource:guessed-suffix",
		"errorMessage":"failed to load /api/resources/diagnostic-only/file",
		"artifacts":[{"id":"bare-id"}],
		"referenceResourceIds":["explicit-id"],
		"providerArtifactRef":"resource:explicit-artifact"
	}`
	if err := collectOwnedAssetDocumentReferences(raw, resources); err != nil {
		t.Fatal(err)
	}
	for _, resourceID := range []string{"explicit-id", "explicit-artifact"} {
		if _, exists := resources[resourceID]; !exists {
			t.Fatalf("explicit resource field %q was not collected: %#v", resourceID, resources)
		}
	}
	for _, resourceID := range []string{"legacy-snake-case", "guessed-suffix", "diagnostic-only", "bare-id"} {
		if _, exists := resources[resourceID]; exists {
			t.Fatalf("unregistered field inferred resource %q: %#v", resourceID, resources)
		}
	}
	arrayResources := map[string]struct{}{}
	if err := collectOwnedAssetDocumentReferences(`{"artifacts":["resource:array-text"]}`, arrayResources); err != nil {
		t.Fatal(err)
	}
	if _, exists := arrayResources["array-text"]; exists {
		t.Fatalf("unnamed array values must not become resource references: %#v", arrayResources)
	}
}

func TestDocumentReferencesResourcesUsesExactResourceID(t *testing.T) {
	candidates := map[string]struct{}{"resource-1": {}}
	if documentReferencesResources(`{"storageKey":"resource:resource-10"}`, candidates) {
		t.Fatal("resource-1 must not match resource-10")
	}
	if !documentReferencesResources(`{"storageKey":"resource:resource-1"}`, candidates) {
		t.Fatal("exact resource ID should match")
	}
	if documentReferencesResources(`generation failed for resource-1`, candidates) {
		t.Fatal("free-form diagnostic text must not be treated as a resource reference")
	}
	if !documentReferencesResources(`/api/resources/resource-1/file`, candidates) {
		t.Fatal("a direct resource locator should match")
	}
}

func TestResourceOccupiedMessageNamesBusinessRecord(t *testing.T) {
	message := resourceOccupiedMessage([]resourceUsage{
		{Kind: "画布", ID: "canvas-1", Title: "广告分镜"},
		{Kind: "画布", ID: "canvas-1", Title: "广告分镜"},
	})
	if !strings.Contains(message, "画布「广告分镜」") || !strings.Contains(message, "解除引用") {
		t.Fatalf("message = %q", message)
	}
}

func TestDeleteLocalResourceObjectRemovesOnlyResourceDirectoryFile(t *testing.T) {
	dataDir := t.TempDir()
	resourcePath := filepath.Join(dataDir, "resources", "users", "user-1", "image", "asset.png")
	if err := os.MkdirAll(filepath.Dir(resourcePath), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourcePath, []byte("image"), 0o640); err != nil {
		t.Fatal(err)
	}
	service := &Service{dataDir: dataDir}
	if err := service.deleteLocalResourceObject("users/user-1/image/asset.png"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(resourcePath); !os.IsNotExist(err) {
		t.Fatalf("resource file still exists or stat failed unexpectedly: %v", err)
	}

	outsidePath := filepath.Join(dataDir, "outside.txt")
	if err := os.WriteFile(outsidePath, []byte("keep"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := service.deleteLocalResourceObject("../outside.txt"); err == nil {
		t.Fatal("path traversal should be rejected")
	}
	if _, err := os.Stat(outsidePath); err != nil {
		t.Fatalf("outside file was changed: %v", err)
	}
}

func TestDeleteAssetDatabaseFailureLeavesPhysicalObjectAndNoOutbox(t *testing.T) {
	svc, db, dataDir := newResourceDeletionTestService(t)
	objectKey := "users/user-1/image/asset.png"
	resourcePath := filepath.Join(dataDir, "resources", filepath.FromSlash(objectKey))
	if err := os.MkdirAll(filepath.Dir(resourcePath), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourcePath, []byte("image"), 0o640); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "resource-1", UserID: "user-1", Provider: "local", ObjectKey: objectKey, Status: model.ResourceStatusReady}
	asset := model.Asset{ID: "asset-1", UserID: "user-1", Title: "test", PayloadJSON: `{"data":{"storageKey":"resource:resource-1"}}`}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TRIGGER fail_asset_delete BEFORE DELETE ON assets BEGIN SELECT RAISE(ABORT, 'forced asset delete failure'); END;").Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.deleteUserAssetWithResources("user-1", "asset-1"); err == nil {
		t.Fatal("forced database failure should be returned")
	}
	if _, err := os.Stat(resourcePath); err != nil {
		t.Fatalf("physical object changed before the database transaction committed: %v", err)
	}
	var assetCount, resourceCount, jobCount int64
	if err := db.Model(&model.Asset{}).Where("id = ?", asset.ID).Count(&assetCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", resource.ID).Count(&resourceCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ResourceDeletionJob{}).Count(&jobCount).Error; err != nil {
		t.Fatal(err)
	}
	if assetCount != 1 || resourceCount != 1 || jobCount != 0 {
		t.Fatalf("transaction was not rolled back: asset=%d resource=%d jobs=%d", assetCount, resourceCount, jobCount)
	}
}

func TestResourceDeletionWorkerRemovesObjectAndCompletesOutbox(t *testing.T) {
	svc, db, dataDir := newResourceDeletionTestService(t)
	objectKey := "users/user-1/image/queued.png"
	resourcePath := filepath.Join(dataDir, "resources", filepath.FromSlash(objectKey))
	if err := os.MkdirAll(filepath.Dir(resourcePath), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(resourcePath, []byte("image"), 0o640); err != nil {
		t.Fatal(err)
	}
	job := model.ResourceDeletionJob{
		ID: "deletion-1", UserID: "user-1", ResourceID: "resource-1",
		Provider: "local", ObjectKey: objectKey,
		Status: model.ResourceDeletionStatusPending, NextAttemptAt: time.Now().Add(-time.Second),
	}
	if err := db.Create(&job).Error; err != nil {
		t.Fatal(err)
	}

	svc.drainResourceDeletionJobs(1)
	if _, err := os.Stat(resourcePath); !os.IsNotExist(err) {
		t.Fatalf("queued physical object was not deleted: %v", err)
	}
	var count int64
	if err := db.Model(&model.ResourceDeletionJob{}).Where("id = ?", job.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("completed deletion job was not removed")
	}
}

func newResourceDeletionTestService(t *testing.T) (*Service, *gorm.DB, string) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	return New(repository.New(db), dataDir), db, dataDir
}
