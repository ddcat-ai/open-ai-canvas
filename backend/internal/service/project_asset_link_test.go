package service

import (
	"encoding/json"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newProjectAssetLinkTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Project{},
		&model.ProjectAssetLink{},
		&model.ProjectAssetFolder{},
		&model.Asset{},
		&model.AssetVersion{},
		&model.AssetRepresentation{},
		&model.Resource{},
		&model.Shot{},
		&model.ShotAssetReference{},
	); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

// TestLinkProjectAssetCreatesAssetFromUploadedResource 覆盖媒体导入场景：
// 上传只落 resources 表，首次链接时服务端应按资源元数据合成资产记录，
// 否则“资源存在但无资产记录”会让导入永远失败。
func TestLinkProjectAssetCreatesAssetFromUploadedResource(t *testing.T) {
	service, db := newProjectAssetLinkTestService(t)
	project := model.Project{ID: "project-1", UserID: "user-1", Name: "短剧", Status: model.ProjectStatusActive}
	resource := model.Resource{
		ID:       "resource-1",
		UserID:   "user-1",
		Kind:     "video",
		Status:   model.ResourceStatusReady,
		MimeType: "video/mp4",
		Size:     1024,
		Width:    1920,
		Height:   1080,
	}
	for _, item := range []any{&project, &resource} {
		if err := db.Create(item).Error; err != nil {
			t.Fatalf("seed %T: %v", item, err)
		}
	}

	summary, err := service.LinkProjectAsset("user-1", "project-1", LinkProjectAssetRequest{
		AssetID:  "resource-1",
		Category: "",
		Title:    "开场.mp4",
		Source:   AssetSourceCanvas,
	})
	if err != nil {
		t.Fatalf("LinkProjectAsset: %v", err)
	}
	if summary.ID != "resource-1" {
		t.Fatalf("summary.ID = %q, want resource-1", summary.ID)
	}

	var asset model.Asset
	if err := db.First(&asset, "id = ?", "resource-1").Error; err != nil {
		t.Fatalf("asset not created: %v", err)
	}
	if asset.Title != "开场.mp4" {
		t.Errorf("asset.Title = %q, want 开场.mp4", asset.Title)
	}
	if asset.Category != model.AssetCategoryMaterial {
		t.Errorf("asset.Category = %q, want material", asset.Category)
	}
	if summary.Source != AssetSourceCanvas {
		t.Errorf("summary.Source = %q, want canvas", summary.Source)
	}
	var payload struct {
		Data struct {
			Source string `json:"source"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
		t.Fatalf("payload unmarshal: %v", err)
	}
	if payload.Data.Source != AssetSourceCanvas {
		t.Errorf("payload.source = %q, want canvas", payload.Data.Source)
	}
}

// TestLinkProjectAssetMissingResourceKeepsFailingClosed 资源与资产都不存在时仍应报错，
// 不允许凭空链接。
func TestLinkProjectAssetMissingResourceKeepsFailingClosed(t *testing.T) {
	service, db := newProjectAssetLinkTestService(t)
	project := model.Project{ID: "project-2", UserID: "user-2", Name: "短剧", Status: model.ProjectStatusActive}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := service.LinkProjectAsset("user-2", "project-2", LinkProjectAssetRequest{
		AssetID: "no-such-resource",
	}); err == nil {
		t.Fatal("LinkProjectAsset succeeded for missing resource, want error")
	}
}
