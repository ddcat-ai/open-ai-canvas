package app

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestCanvasOfficialResourcesRequirePublishedReadyAsset(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	if err := db.AutoMigrate(&model.OfficialAsset{}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "shared-image", UserID: "admin", Status: model.ResourceStatusReady}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	official := model.OfficialAsset{ID: "official-image", ResourceID: resource.ID, Status: model.OfficialAssetStatusPublished}
	if err := db.Create(&official).Error; err != nil {
		t.Fatal(err)
	}
	raw := json.RawMessage(`{"nodes":[{"id":"one","type":"image","metadata":{"officialAssetId":"official-image","storageKey":"resource:shared-image"}}]}`)
	if err := svc.validateCanvasMediaAssets("user-1", raw); err != nil {
		t.Fatalf("published official image rejected: %v", err)
	}
	if err := db.Model(&official).Update("status", model.OfficialAssetStatusDraft).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.validateCanvasMediaAssets("user-1", raw); err == nil {
		t.Fatal("draft official image was accepted")
	}
	if err := db.Model(&official).Update("status", model.OfficialAssetStatusPublished).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&resource).Update("status", "deleted").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.validateCanvasMediaAssets("user-1", raw); err == nil {
		t.Fatal("unavailable resource was accepted")
	}
}

func TestUnpublishedOfficialAccessRequiresSavedCanvas(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	now := time.Now()
	for _, row := range []any{
		&model.Resource{ID: "shared", UserID: "admin", Status: model.ResourceStatusReady},
		&model.OfficialAsset{ID: "official", ResourceID: "shared", Status: model.OfficialAssetStatusUnpublished, PublishedAt: &now},
		&model.CanvasProject{ID: "canvas", UserID: "viewer", PayloadJSON: `{"nodes":[{"type":"image","metadata":{"storageKey":"resource:shared"}}]}`},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.resourceForUserOrOfficial("viewer", "shared"); err != nil {
		t.Fatalf("existing viewer: %v", err)
	}
	if _, err := svc.resourceForUserOrOfficial("other", "shared"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("other user: %v", err)
	}
}
