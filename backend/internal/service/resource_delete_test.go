package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCollectOwnedAssetDocumentReferences(t *testing.T) {
	resources := map[string]struct{}{}
	tasks := map[string]struct{}{}
	raw := `{
		"data":{"storageKey":"resource:resource-1","url":"/api/resources/resource-2/file"},
		"metadata":{"taskId":"task-1","referenceResourceIds":["resource-3"],"errorDetails":"failed near /api/resources/not-a-reference/file"}
	}`
	if err := collectOwnedAssetDocumentReferences(raw, resources, tasks); err != nil {
		t.Fatal(err)
	}
	for _, resourceID := range []string{"resource-1", "resource-2", "resource-3"} {
		if _, exists := resources[resourceID]; !exists {
			t.Fatalf("resource %q was not collected: %#v", resourceID, resources)
		}
	}
	if _, exists := tasks["task-1"]; !exists {
		t.Fatalf("origin task was not collected: %#v", tasks)
	}
	if _, exists := resources["not-a-reference"]; exists {
		t.Fatalf("diagnostic text must not be treated as an actual resource reference: %#v", resources)
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
