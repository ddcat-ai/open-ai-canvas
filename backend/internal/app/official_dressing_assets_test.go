package app

import (
	"testing"
	"yingce/backend/internal/model"
)

func TestOfficialDressingAssetCategories(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	if err := db.AutoMigrate(&model.OfficialAsset{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "official-image", UserID: "admin", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}).Error; err != nil {
		t.Fatal(err)
	}
	actor := &model.User{ID: "admin", Role: "admin"}
	for _, category := range []string{"clothing", "expression", "pose", "accessory", "hairstyle", "facial_features"} {
		asset, err := svc.CreateOfficialAsset(actor, CreateOfficialAssetRequest{ResourceID: "official-image", Title: "梳妆参考", MediaType: "image", Category: category})
		if err != nil || string(asset.Category) != category {
			t.Fatalf("category %s: %#v, %v", category, asset, err)
		}
	}
	for _, category := range []string{"invalid", "ark"} {
		if _, err := svc.CreateOfficialAsset(actor, CreateOfficialAssetRequest{ResourceID: "official-image", Title: "错误分类", MediaType: "image", Category: category}); err == nil {
			t.Fatalf("invalid category %s accepted", category)
		}
	}
}
