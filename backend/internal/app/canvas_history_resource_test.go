package app

import (
	"errors"
	"infinite-canvas/backend/internal/model"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCanvasHistoryProtectsMediaAndDeletionWorker(t *testing.T) {
	svc, db, dataDir := newResourceDeletionTestService(t)
	key := "users/user-1/video/history.mp4"
	file := filepath.Join(dataDir, "resources", filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(file), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("video"), 0o640); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "historical-video", UserID: "user-1", Provider: "local", ObjectKey: key, Status: model.ResourceStatusReady}
	asset := model.Asset{ID: "history-asset", UserID: "user-1", Title: "video", PayloadJSON: `{"data":{"storageKey":"resource:historical-video"}}`}
	snapshot := model.CanvasSnapshot{ID: "history-snapshot", CanvasID: "canvas", UserID: "user-1", Revision: 1, Title: "wedding", PayloadJSON: `{}`, CreatedAt: time.Now()}
	ref := model.CanvasSnapshotResource{SnapshotID: snapshot.ID, ResourceID: resource.ID}
	for _, item := range []any{&resource, &asset, &snapshot, &ref} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.DeleteUserAsset("user-1", asset.ID); err == nil || !strings.Contains(err.Error(), "画布历史版本") {
		t.Fatalf("history reference ignored: %v", err)
	}
	// A previously queued physical deletion must also honor a later history reference.
	job := resourceDeletionJobs("user-1", map[string]*model.Resource{key: &resource})[0]
	job.ResourceID = "deleted-resource-alias"
	if err := db.Create(&job).Error; err != nil {
		t.Fatal(err)
	}
	svc.drainResourceDeletionJobs(1)
	if _, err := os.Stat(file); err != nil {
		t.Fatalf("history media removed: %v", err)
	}
	var pending model.ResourceDeletionJob
	if err := db.First(&pending, "id = ?", job.ID).Error; err != nil {
		t.Fatal(err)
	}
	if pending.Attempts < 1 || pending.LastError == "" {
		t.Fatalf("protected deletion was not deferred: %#v", pending)
	}
	if err := db.Delete(&ref).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&pending).Update("next_attempt_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	svc.drainResourceDeletionJobs(1)
	if _, err := os.Stat(file); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("unreferenced media not cleaned: %v", err)
	}
}

func TestArchivedAssetDeletionPreservesCanvasHistoryReference(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	resource := model.Resource{
		ID: "archived-history-resource", UserID: "user-1", Provider: "unsupported-test-provider",
		ObjectKey: "users/user-1/image/archived-history.png", Status: model.ResourceStatusReady,
	}
	asset := model.Asset{
		ID: "archived-history-asset", UserID: "user-1", Title: "回收站历史素材",
		Status: model.AssetVersionStatusArchived, PayloadJSON: `{"data":{"storageKey":"resource:archived-history-resource"}}`,
	}
	snapshot := model.CanvasSnapshot{
		ID: "archived-history-snapshot", CanvasID: "canvas", UserID: "user-1", Revision: 1,
		Title: "历史画布", PayloadJSON: `{}`, CreatedAt: time.Now(),
	}
	ref := model.CanvasSnapshotResource{SnapshotID: snapshot.ID, ResourceID: resource.ID}
	for _, item := range []any{&resource, &asset, &snapshot, &ref} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := svc.DeleteUserAsset("user-1", asset.ID); err == nil || !strings.Contains(err.Error(), "画布历史版本") {
		t.Fatalf("archived asset bypassed history protection: %v", err)
	}
	for _, check := range []struct {
		model any
		want  int64
	}{
		{&model.Asset{}, 1},
		{&model.Resource{}, 1},
		{&model.CanvasSnapshotResource{}, 1},
		{&model.CanvasSnapshot{}, 1},
		{&model.ResourceDeletionJob{}, 0},
	} {
		var count int64
		if err := db.Model(check.model).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != check.want {
			t.Fatalf("%T count=%d, want %d", check.model, count, check.want)
		}
	}
}
