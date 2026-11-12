package repository

import (
	"errors"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCanvasSnapshotAcceptsPublishedOfficialResourceOnly(t *testing.T) {
	repo, db := newAssetLibraryTestRepository(t)
	if err := db.AutoMigrate(&model.CanvasProject{}, &model.CanvasEditLease{}, &model.Resource{}, &model.OfficialAsset{}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "public-image", UserID: "admin", Status: model.ResourceStatusReady}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	official := model.OfficialAsset{ID: "official-image", ResourceID: resource.ID, Status: model.OfficialAssetStatusPublished}
	if err := db.Create(&official).Error; err != nil {
		t.Fatal(err)
	}
	project := model.CanvasProject{ID: "canvas", UserID: "viewer", PayloadJSON: `{}`, UpdatedAt: time.Now()}
	if err := repo.SaveCanvasWithSnapshot(&project, nil, nil, []string{resource.ID}, time.Now(), 20, false); err != nil {
		t.Fatalf("published resource: %v", err)
	}
	if err := db.Model(&official).Update("status", model.OfficialAssetStatusDraft).Error; err != nil {
		t.Fatal(err)
	}
	before := project.Revision
	if err := repo.SaveCanvasWithSnapshot(&project, nil, nil, []string{resource.ID}, time.Now(), 20, false); !errors.Is(err, ErrCanvasHistoryResourceMissing) {
		t.Fatalf("draft resource: %v", err)
	}
	stored, err := repo.CanvasProjectForUser("viewer", "canvas")
	if err != nil || stored.Revision != before {
		t.Fatalf("rejected save changed canvas: %#v %v", stored, err)
	}
}

func TestUnpublishedOfficialResourceRequiresPreviouslySavedCanvas(t *testing.T) {
	repo, db := newAssetLibraryTestRepository(t)
	if err := db.AutoMigrate(&model.CanvasProject{}, &model.Resource{}, &model.OfficialAsset{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "shared-image", UserID: "admin", Status: model.ResourceStatusReady}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := db.Create(&model.OfficialAsset{ID: "official", ResourceID: "shared-image", Status: model.OfficialAssetStatusUnpublished, PublishedAt: &now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "saved", UserID: "viewer", PayloadJSON: `{"nodes":[{"type":"image","metadata":{"storageKey":"resource:shared-image"}}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		user, canvas string
		want         bool
	}{{"viewer", "saved", true}, {"other", "saved", false}, {"viewer", "new", false}} {
		got, err := repo.RetainedCanvasOfficialResource(test.user, test.canvas, "shared-image")
		if err != nil || got != test.want {
			t.Fatalf("%s/%s: got %v, %v", test.user, test.canvas, got, err)
		}
	}
}
