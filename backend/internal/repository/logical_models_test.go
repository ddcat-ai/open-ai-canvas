package repository

import (
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSaveLogicalModelBundleAllocatesMonotonicRevisionSequence(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:logical-model-revision-sequence?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.LogicalModel{}, &model.LogicalModelRevision{}, &model.LogicalModelRoute{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)

	item := &model.LogicalModel{ID: "LMODEL_1", Code: "demo", Name: "Demo", Capability: "text", Enabled: true, PricePolicy: "unified", BillingMode: "fixed_request", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	first := &model.LogicalModelRevision{ID: "REVISION_1", LogicalModelID: item.ID, CapabilitySpecJSON: `{"version":1,"capability":"text"}`, DefaultOptionsJSON: `{}`, CreatedAt: time.Now()}
	if err := repo.SaveLogicalModelBundle(item, first, nil, true); err != nil {
		t.Fatal(err)
	}

	var updated model.LogicalModel
	if err := db.First(&updated, "id = ?", item.ID).Error; err != nil {
		t.Fatal(err)
	}
	updated.Name = "Demo 2"
	updated.UpdatedAt = time.Now()
	second := &model.LogicalModelRevision{ID: "REVISION_2", LogicalModelID: item.ID, CapabilitySpecJSON: `{"version":1,"capability":"text"}`, DefaultOptionsJSON: `{}`, CreatedAt: time.Now()}
	if err := repo.SaveLogicalModelBundle(&updated, second, nil, false); err != nil {
		t.Fatal(err)
	}

	var revisions []model.LogicalModelRevision
	if err := db.Order("version asc").Find(&revisions).Error; err != nil {
		t.Fatal(err)
	}
	if len(revisions) != 2 || revisions[0].Version != 1 || revisions[1].Version != 2 {
		t.Fatalf("revision versions = %#v, want [1 2]", revisions)
	}
	if updated.RevisionSequence != 2 || updated.ActiveRevisionID != "REVISION_2" {
		t.Fatalf("updated model state = %#v", updated)
	}
}

func TestDeleteLogicalModelPreservesPublishedHistory(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:logical-model-delete-history?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.LogicalModel{}, &model.LogicalModelRevision{}, &model.LogicalModelRoute{}, &model.Task{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)

	item := &model.LogicalModel{ID: "LMODEL_DELETE", Code: "delete-demo", Name: "Delete Demo", Capability: "text", Enabled: true, PricePolicy: "unified", BillingMode: "fixed_request", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	revision := &model.LogicalModelRevision{ID: "REVISION_DELETE", LogicalModelID: item.ID, CapabilitySpecJSON: `{"version":1,"capability":"text"}`, DefaultOptionsJSON: `{}`, CreatedAt: time.Now()}
	routes := []model.LogicalModelRoute{{ID: "ROUTE_DELETE", ChannelModelID: "CMODEL_DELETE", Enabled: true, Weight: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}}
	if err := repo.SaveLogicalModelBundle(item, revision, routes, true); err != nil {
		t.Fatal(err)
	}

	if err := repo.DeleteLogicalModel(item.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&model.LogicalModel{}, "id = ?", item.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("logical model lookup error = %v, want record not found", err)
	}
	for label, target := range map[string]any{"revision": &model.LogicalModelRevision{}, "route": &model.LogicalModelRoute{}} {
		if err := db.First(target).Error; err != nil {
			t.Fatalf("%s history was not preserved: %v", label, err)
		}
	}
}

func TestDeleteLogicalModelRejectsActiveTask(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:logical-model-delete-active-task?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.LogicalModel{}, &model.Task{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	item := model.LogicalModel{ID: "LMODEL_ACTIVE", Code: "active-demo", Name: "Active Demo", Enabled: true, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "TASK_ACTIVE", LogicalModelID: item.ID, Status: model.TaskStatusRunning, CreatedAt: time.Now(), UpdatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}

	if err := repo.DeleteLogicalModel(item.ID, time.Now()); !errors.Is(err, ErrLogicalModelInUse) {
		t.Fatalf("DeleteLogicalModel() error = %v, want ErrLogicalModelInUse", err)
	}
	var preserved model.LogicalModel
	if err := db.First(&preserved, "id = ?", item.ID).Error; err != nil {
		t.Fatalf("active logical model was removed: %v", err)
	}
	if !preserved.Enabled {
		t.Fatal("active logical model disable was not rolled back")
	}
}
