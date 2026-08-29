package service

import (
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAdminStorageListStatsAndPreview(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.User{}, &model.Resource{}, &model.UserOSSSetting{}, &model.StorageLocation{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	users := []model.User{
		{ID: "admin", Username: "admin", DisplayName: "管理员", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		{ID: "user-1", Username: "creator", DisplayName: "创作者", Role: model.UserRoleUser, Status: model.UserStatusActive},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	resources := []model.Resource{
		{ID: "image-ready", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Provider: "", ObjectKey: "users/user-1/image/ready.png", MimeType: "image/png", Size: 128, CreatedAt: now.Add(-time.Minute), UpdatedAt: now},
		{ID: "image-failed", UserID: "user-1", Kind: "image", Status: model.ResourceStatusFailed, Provider: "local", ObjectKey: "users/user-1/image/failed.png", MimeType: "image/png", Size: 64, CreatedAt: now.Add(-2 * time.Minute), UpdatedAt: now},
		{ID: "video-ready", UserID: "admin", Kind: "video", Status: model.ResourceStatusReady, Provider: "s3", Bucket: "media", ObjectKey: "video/ready.mp4", MimeType: "video/mp4", Size: 256, CreatedAt: now.Add(-3 * time.Minute), UpdatedAt: now},
		{ID: "image-shared", UserID: "admin", Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "users/user-1/image/ready.png", MimeType: "image/png", Size: 128, CreatedAt: now.Add(-4 * time.Minute), UpdatedAt: now},
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	filePath := filepath.Join(dataDir, "resources", filepath.FromSlash(resources[0].ObjectKey))
	if err := os.MkdirAll(filepath.Dir(filePath), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filePath, []byte("image-data"), 0o640); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), dataDir)
	admin := &users[0]

	page, err := svc.AdminResourcePage(admin, AdminResourceQuery{Kind: "image", Provider: "local", Page: 1, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 3 || len(page.Items) != 3 || page.Items[0].UserName != "创作者" {
		t.Fatalf("page = %+v", page)
	}
	if page.Items[0].PhysicalBytes != 128 || page.Items[1].PhysicalBytes != 0 {
		t.Fatalf("physical bytes = %+v", page.Items)
	}

	stats, err := svc.AdminStorageStats(admin)
	if err != nil {
		t.Fatal(err)
	}
	if stats.ResourceCount != 4 || stats.ReadyCount != 3 || stats.LogicalBytes != 576 || stats.PhysicalBytes != 384 || stats.LocalBytes != 128 || stats.RemoteBytes != 256 {
		t.Fatalf("stats = %+v", stats)
	}
	if len(stats.ByKind) != 2 || stats.ByKind[0].Kind != "image" || stats.ByKind[0].PhysicalBytes != 128 {
		t.Fatalf("kind stats = %+v", stats.ByKind)
	}

	stream, err := svc.OpenResourceRangeAsAdmin(admin, resources[0].ID, "")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	data, err := io.ReadAll(stream.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "image-data" {
		t.Fatalf("preview data = %q", data)
	}
}

func TestAdminStorageRejectsNonAdminAndInvalidFilters(t *testing.T) {
	svc := &Service{}
	user := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if _, err := svc.AdminResourcePage(user, AdminResourceQuery{}); err == nil {
		t.Fatal("expected non-admin resource list to be rejected")
	}
	if _, _, _, err := normalizeAdminResourceQuery(AdminResourceQuery{Provider: "unknown"}); err == nil {
		t.Fatal("expected invalid provider filter to be rejected")
	}
	if _, _, _, err := normalizeAdminResourceQuery(AdminResourceQuery{Status: "unknown"}); err == nil {
		t.Fatal("expected invalid status filter to be rejected")
	}
	if _, err := svc.AdminStorageStats(user); err == nil {
		t.Fatal("expected non-admin stats to be rejected")
	}
}
