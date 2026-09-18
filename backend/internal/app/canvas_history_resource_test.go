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
