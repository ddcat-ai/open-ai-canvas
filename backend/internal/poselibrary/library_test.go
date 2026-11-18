package poselibrary

import (
	"errors"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type testAdminGate struct{}

func (testAdminGate) RequireAdmin(user *model.User) error {
	if user == nil || user.Role != model.UserRoleAdmin {
		return errors.New("admin required")
	}
	return nil
}

func (testAdminGate) AppendAudit(*model.User, string, string, string, string, any) error {
	return nil
}

func TestLibrariesKeepCatalogBulkAndSourcesSeparate(t *testing.T) {
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.PoseLibrarySource{}, &model.PoseLibraryItem{}); err != nil {
		t.Fatal(err)
	}
	s := New(repository.New(db), t.TempDir(), testAdminGate{})
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	for _, library := range []string{"pose", "garment"} {
		for _, category := range []string{"standing", "sitting"} {
			item := model.PoseLibraryItem{ID: library + "-" + category, Library: library, SourceKey: library + "-source", ExternalKey: category, GroupKey: "shared-group", Name: category, System: "references", Category: category, Enabled: true, Status: model.PoseLibraryStatusReady}
			if err := db.Create(&item).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	page, err := s.Catalog(admin, CatalogQuery{Library: "garment"})
	if err != nil || len(page.Poses) != 1 || len(page.Poses[0].Items) != 2 {
		t.Fatalf("garment catalog=%#v err=%v", page, err)
	}
	for _, item := range page.Poses[0].Items {
		if item.ID != "garment-standing" && item.ID != "garment-sitting" {
			t.Fatalf("pose leaked into garment catalog: %s", item.ID)
		}
	}
	listed, err := s.AdminList(admin, AdminQuery{Library: "garment", Category: "standing"})
	if err != nil || listed.Total != 1 || listed.Items[0].ID != "garment-standing" {
		t.Fatalf("category list=%#v err=%v", listed, err)
	}
	if _, err := s.Bulk(admin, BulkRequest{Library: "garment", Action: "disable", IDs: []string{"pose-standing"}}); err == nil {
		t.Fatal("cross-library ID accepted")
	}
	result, err := s.Bulk(admin, BulkRequest{Library: "garment", Action: "disable", GroupKeys: []string{"shared-group"}})
	if err != nil || result.Affected != 2 {
		t.Fatalf("group operation=%#v err=%v", result, err)
	}
	var pose model.PoseLibraryItem
	if err := db.First(&pose, "id = ?", "pose-standing").Error; err != nil || !pose.Enabled {
		t.Fatalf("pose was changed: %#v err=%v", pose, err)
	}
	source := model.PoseLibrarySource{Key: "shared-source", Library: "pose", Name: "Original pose source"}
	if err := db.Create(&source).Error; err != nil {
		t.Fatal(err)
	}
	pack := []byte(`{"format":"yingce-pose-library","version":1,"library":"garment","source":{"key":"shared-source","name":"Replacement"},"items":[]}`)
	if _, err := s.Import(admin, ImportRequest{Library: "garment", Data: pack}); err == nil {
		t.Fatal("cross-library source reuse accepted")
	}
	var stored model.PoseLibrarySource
	if err := db.First(&stored, "key = ?", source.Key).Error; err != nil || stored.Library != "pose" || stored.Name != source.Name {
		t.Fatalf("source changed: %#v err=%v", stored, err)
	}
	if _, err := parseImportPack([]byte(`{"format":"yingce-pose-library","version":1,"library":"garment","source":{"key":"custom-garment"},"items":[]}`)); err == nil {
		t.Fatal("import accepted the reserved custom garment source")
	}
}
