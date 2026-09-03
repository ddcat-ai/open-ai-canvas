package repository

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newAssetLibraryTestRepository(t *testing.T) (*Repository, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:asset-library-test-%d?mode=memory&cache=shared", time.Now().UnixNano())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Asset{}, &model.AssetFolder{}); err != nil {
		t.Fatal(err)
	}
	return New(db), db
}

func TestUserAssetsPagePaginatesAndIsolatesUsers(t *testing.T) {
	repo, db := newAssetLibraryTestRepository(t)
	now := time.Now().UTC()
	for _, asset := range []model.Asset{
		{ID: "asset-1", UserID: "user-1", Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "海边", PayloadJSON: `{"id":"asset-1","title":"海边"}`, CreatedAt: now, UpdatedAt: now},
		{ID: "asset-2", UserID: "user-1", Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "室内", PayloadJSON: `{"id":"asset-2","title":"室内"}`, CreatedAt: now, UpdatedAt: now.Add(time.Second)},
		{ID: "asset-3", UserID: "user-1", Kind: "text", Category: model.AssetCategoryOther, Status: model.AssetVersionStatusConfirmed, Title: "提示词", PayloadJSON: `{"id":"asset-3","title":"提示词"}`, CreatedAt: now, UpdatedAt: now.Add(2 * time.Second)},
		{ID: "asset-4", UserID: "user-2", Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "他人素材", PayloadJSON: `{"id":"asset-4","title":"他人素材"}`, CreatedAt: now, UpdatedAt: now},
	} {
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
	}

	assets, total, err := repo.UserAssetsPage("user-1", 2, 1, UserAssetPageFilter{Kind: "image", Status: "active"})
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(assets) != 1 || assets[0].ID != "asset-1" {
		t.Fatalf("page result = total %d, assets %#v; want total 2 and asset-1", total, assets)
	}
}

func TestDeleteAssetFolderMovesAssetsToUncategorized(t *testing.T) {
	repo, db := newAssetLibraryTestRepository(t)
	now := time.Now().UTC()
	folder := model.AssetFolder{ID: "folder-1", UserID: "user-1", Name: "灵感", NameKey: "灵感", Position: 0, CreatedAt: now, UpdatedAt: now}
	asset := model.Asset{ID: "asset-1", UserID: "user-1", FolderID: folder.ID, Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "海边", PayloadJSON: `{"id":"asset-1","folderId":"folder-1"}`, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}

	if err := repo.DeleteAssetFolder("user-1", folder.ID); err != nil {
		t.Fatal(err)
	}
	var moved model.Asset
	if err := db.First(&moved, "id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if moved.FolderID != "" || strings.Contains(moved.PayloadJSON, "folderId") {
		t.Fatalf("asset after folder deletion = %#v", moved)
	}
}

func TestMoveUserAssetsToFolderRollsBackWhenAnyAssetIsForeign(t *testing.T) {
	repo, db := newAssetLibraryTestRepository(t)
	now := time.Now().UTC()
	folder := model.AssetFolder{ID: "folder-1", UserID: "user-1", Name: "灵感", NameKey: "灵感", Position: 0, CreatedAt: now, UpdatedAt: now}
	assets := []model.Asset{
		{ID: "asset-1", UserID: "user-1", Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "海边", PayloadJSON: `{"id":"asset-1"}`, CreatedAt: now, UpdatedAt: now},
		{ID: "asset-2", UserID: "user-2", Kind: "image", Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: "他人素材", PayloadJSON: `{"id":"asset-2"}`, CreatedAt: now, UpdatedAt: now},
	}
	if err := db.Create(&folder).Error; err != nil {
		t.Fatal(err)
	}
	for index := range assets {
		if err := db.Create(&assets[index]).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := repo.MoveUserAssetsToFolder("user-1", []string{"asset-1", "asset-2"}, folder.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("move error = %v, want record-not-found", err)
	}
	var unchanged model.Asset
	if err := db.First(&unchanged, "id = ?", "asset-1").Error; err != nil {
		t.Fatal(err)
	}
	if unchanged.FolderID != "" {
		t.Fatalf("foreign asset caused partial move: %#v", unchanged)
	}
}
