package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDeleteAdminResourcesSupportsPartialSuccessAndBatchedReferences(t *testing.T) {
	svc, db, dataDir, admin := newAdminStorageDeleteTestService(t)
	resources := []model.Resource{
		{ID: "resource-free", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/user-1/image/delete-directory"},
		{ID: "resource-blocked", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/user-1/image/blocked.png"},
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}
	canvas := model.CanvasProject{ID: "canvas-1", UserID: "user-1", Title: "广告分镜", PayloadJSON: `{"nodes":[{"data":{"storageKey":"resource:resource-blocked"}}]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	directoryPath := filepath.Join(dataDir, "resources", filepath.FromSlash(resources[0].ObjectKey))
	if err := os.MkdirAll(directoryPath, 0o750); err != nil {
		t.Fatal(err)
	}

	result, err := svc.DeleteAdminResources(admin, AdminResourceDeleteRequest{ResourceIDs: []string{"resource-free", "resource-blocked", "resource-free"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Deleted) != 1 || result.Deleted[0] != "resource-free" {
		t.Fatalf("deleted = %#v", result.Deleted)
	}
	if len(result.Blocked) != 1 || result.Blocked[0].ID != "resource-blocked" || len(result.Blocked[0].References) != 1 || result.Blocked[0].References[0].Kind != "画布" {
		t.Fatalf("blocked = %#v", result.Blocked)
	}
	assertModelCount(t, db, &model.Resource{}, "id = ?", 0, "resource-free")
	assertModelCount(t, db, &model.Resource{}, "id = ?", 1, "resource-blocked")
	assertModelCount(t, db, &model.ResourceDeletionJob{}, "resource_id = ?", 1, "resource-free")
	assertModelCount(t, db, &model.AdminAuditEvent{}, "action = ? AND target_id = ?", 1, "resource.delete", "resource-free")
}

func TestDeleteAdminResourcesBlocksAnnouncementImage(t *testing.T) {
	svc, db, _, admin := newAdminStorageDeleteTestService(t)
	resource := model.Resource{ID: "announcement-image", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "announcements/cover.png"}
	announcement := model.Announcement{ID: "announcement-1", Title: "维护通知", Content: "content", ImageResourceID: resource.ID, CreatedBy: admin.ID, Status: model.AnnouncementStatusActive}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&announcement).Error; err != nil {
		t.Fatal(err)
	}

	result, err := svc.DeleteAdminResources(admin, AdminResourceDeleteRequest{ResourceIDs: []string{resource.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Deleted) != 0 || len(result.Blocked) != 1 || result.Blocked[0].References[0].Kind != "公告" {
		t.Fatalf("result = %#v", result)
	}
	assertModelCount(t, db, &model.Resource{}, "id = ?", 1, resource.ID)
}

func TestDeleteAdminResourcesKeepsSharedPhysicalObject(t *testing.T) {
	svc, db, _, admin := newAdminStorageDeleteTestService(t)
	resources := []model.Resource{
		{ID: "resource-delete", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "", ObjectKey: "shared/object.png"},
		{ID: "resource-keep", UserID: "user-2", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "shared/object.png"},
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}

	result, err := svc.DeleteAdminResources(admin, AdminResourceDeleteRequest{ResourceIDs: []string{"resource-delete"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Deleted) != 1 {
		t.Fatalf("result = %#v", result)
	}
	assertModelCount(t, db, &model.Resource{}, "id = ?", 0, "resource-delete")
	assertModelCount(t, db, &model.Resource{}, "id = ?", 1, "resource-keep")
	assertModelCount(t, db, &model.ResourceDeletionJob{}, "1 = 1", 0)
	var audit model.AdminAuditEvent
	if err := db.First(&audit, "target_id = ?", "resource-delete").Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(audit.MetadataJSON, `"physicalDeleteQueued":false`) {
		t.Fatalf("audit metadata = %s", audit.MetadataJSON)
	}
}

func TestDeleteAdminResourcesRollsBackWhenAuditInsertFails(t *testing.T) {
	svc, db, _, admin := newAdminStorageDeleteTestService(t)
	resource := model.Resource{ID: "resource-rollback", UserID: admin.ID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local"}
	binding := model.ArkPrivateAssetBinding{ID: "binding-1", UserID: admin.ID, ResourceID: resource.ID, ProjectName: "project", Status: "active"}
	draft := model.AnnouncementImageDraft{ResourceID: resource.ID, UserID: admin.ID}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&binding).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&draft).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("CREATE TRIGGER fail_resource_audit BEFORE INSERT ON admin_audit_events WHEN NEW.action = 'resource.delete' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;").Error; err != nil {
		t.Fatal(err)
	}

	if _, err := svc.DeleteAdminResources(admin, AdminResourceDeleteRequest{ResourceIDs: []string{resource.ID}}); err == nil {
		t.Fatal("expected audit failure")
	}
	assertModelCount(t, db, &model.Resource{}, "id = ?", 1, resource.ID)
	assertModelCount(t, db, &model.ArkPrivateAssetBinding{}, "resource_id = ?", 1, resource.ID)
	assertModelCount(t, db, &model.AnnouncementImageDraft{}, "resource_id = ?", 1, resource.ID)
	assertModelCount(t, db, &model.ResourceDeletionJob{}, "1 = 1", 0)
}

func TestDeleteAdminResourcesRejectsNonAdminAndOversizedBatch(t *testing.T) {
	svc := &Service{}
	user := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if _, err := svc.DeleteAdminResources(user, AdminResourceDeleteRequest{ResourceIDs: []string{"resource-1"}}); err == nil {
		t.Fatal("expected non-admin rejection")
	}
	ids := make([]string, maxAdminResourceDeleteCount+1)
	for index := range ids {
		ids[index] = newID()
	}
	if _, err := normalizeAdminResourceDeleteIDs(ids); err == nil {
		t.Fatal("expected oversized batch rejection")
	}
}

func newAdminStorageDeleteTestService(t *testing.T) (*Service, *gorm.DB, string, *model.User) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	return New(repository.New(db), dataDir), db, dataDir, admin
}

func assertModelCount(t *testing.T, db *gorm.DB, value any, query string, expected int64, args ...any) {
	t.Helper()
	var count int64
	dbQuery := db.Model(value).Where(query, args...)
	if err := dbQuery.Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != expected {
		t.Fatalf("count = %d, want %d", count, expected)
	}
}
