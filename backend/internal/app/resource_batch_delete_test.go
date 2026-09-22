package app

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestPurgeAssetsBatchSharedResourcesAndHistory(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	for _, id := range []string{"batch-shared", "keep-shared", "same-object", "foreign-alias"} {
		owner, objectKey := "user-1", id+".png"
		if id == "foreign-alias" {
			owner, objectKey = "user-2", "same-object.png"
		}
		if err := db.Create(&model.Resource{ID: id, UserID: owner, Provider: "unsupported-test-provider", ObjectKey: objectKey, Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, record := range []any{
		&model.Asset{ID: "first", UserID: "user-1", Status: model.AssetVersionStatusConfirmed, PayloadJSON: `{"resourceIds":["batch-shared","keep-shared","same-object"]}`},
		&model.Asset{ID: "second", UserID: "user-1", Status: model.AssetVersionStatusArchived, PayloadJSON: `{}`},
		&model.AssetVersion{ID: "second-version", AssetID: "second", DefinitionJSON: `{"resourceId":"batch-shared"}`},
		&model.AssetRepresentation{ID: "second-representation", AssetVersionID: "second-version", Role: "image", ResourceID: "batch-shared", MetadataJSON: `{}`},
		&model.Asset{ID: "unselected", UserID: "user-1", PayloadJSON: `{}`},
		&model.AssetVersion{ID: "unselected-version", AssetID: "unselected", DefinitionJSON: `{}`},
		&model.AssetRepresentation{ID: "unselected-representation", AssetVersionID: "unselected-version", Role: "video", MetadataJSON: `{"resourceId":"keep-shared"}`},
		&model.Task{ID: "batch-task", UserID: "user-1", Status: model.TaskStatusRunning, InputJSON: `{"resourceId":"batch-shared"}`},
		&model.CanvasProject{ID: "batch-canvas", UserID: "user-1", PayloadJSON: `{"resourceId":"batch-shared"}`},
		&model.CanvasSnapshot{ID: "batch-snapshot", CanvasID: "batch-canvas", UserID: "user-1", Revision: 1, PayloadJSON: `{}`, CreatedAt: time.Now()},
		&model.CanvasSnapshotResource{SnapshotID: "batch-snapshot", ResourceID: "batch-shared"},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Force an error late in the resource transaction, after asset and outbox writes.
	if err := db.Exec("CREATE TRIGGER fail_batch_resource_delete BEFORE DELETE ON resources BEGIN SELECT RAISE(ABORT, 'forced failure'); END;").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.PurgeUserAssets("user-1", []string{"first", "second"}); err == nil {
		t.Fatal("expected rollback")
	}
	assertCount := func(record any, want int64) {
		t.Helper()
		var count int64
		if err := db.Model(record).Count(&count).Error; err != nil || count != want {
			t.Fatalf("%T count=%d want=%d err=%v", record, count, want, err)
		}
	}
	assertCount(&model.Asset{}, 3)
	assertCount(&model.Resource{}, 4)
	assertCount(&model.ResourceDeletionJob{}, 0)
	assertCount(&model.CanvasSnapshotResource{}, 1)
	assertCount(&model.AssetVersion{}, 2)
	assertCount(&model.AssetRepresentation{}, 2)
	if err := db.Exec("DROP TRIGGER fail_batch_resource_delete").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.PurgeUserAssets("user-1", []string{"first", " second ", "first"}); err != nil {
		t.Fatal(err)
	}
	assertCount(&model.Asset{}, 1)
	assertCount(&model.Resource{}, 2)
	assertCount(&model.ResourceDeletionJob{}, 1)
	assertCount(&model.CanvasSnapshotResource{}, 0)
	assertCount(&model.CanvasSnapshot{}, 1)
	assertCount(&model.Task{}, 1)
	assertCount(&model.CanvasProject{}, 1)
	assertCount(&model.AssetVersion{}, 1)
	assertCount(&model.AssetRepresentation{}, 1)
	var job model.ResourceDeletionJob
	if err := db.First(&job).Error; err != nil {
		t.Fatal(err)
	}
	if job.ResourceID != "batch-shared" {
		t.Fatalf("wrong physical object queued: %s", job.ResourceID)
	}
	for _, id := range []string{"keep-shared", "foreign-alias"} {
		var resource model.Resource
		if err := db.First(&resource, "id = ?", id).Error; err != nil {
			t.Fatalf("shared resource %s lost: %v", id, err)
		}
	}
}
