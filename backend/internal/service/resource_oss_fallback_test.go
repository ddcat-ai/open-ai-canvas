package service

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newResourceFallbackTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Resource{},
		&model.UserOSSSetting{},
		&model.SystemSetting{},
		&model.StorageLocation{},
		&model.UserDailyActivity{},
	); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: t.TempDir()}, db
}

// TestStoreResourceDegradesToLocalWhenOSSUnavailable 覆盖对象存储不可用时的降级：
// 配置了 OSS（enabled=1、endpoint 不可达）时上传应回退本地存储成功，
// 而不是把上传标记为失败——本地媒体导入不应因外部存储故障整体失败。
func TestStoreResourceDegradesToLocalWhenOSSUnavailable(t *testing.T) {
	service, db := newResourceFallbackTestService(t)
	seedOSSEnabled(t, db, "user-1", "http://127.0.0.1:1")

	resource, created, err := service.storeResource(
		"user-1", "video", "intro.mp4", "video/mp4", 1024,
		1920, 1080, 0, bytes.NewReader([]byte("fake-mp4-bytes")), nil,
	)
	if err != nil {
		t.Fatalf("storeResource: %v", err)
	}
	if !created {
		t.Fatal("storeResource returned created=false, want true")
	}
	if resource.Status != model.ResourceStatusReady {
		t.Fatalf("resource.Status = %q, want %q", resource.Status, model.ResourceStatusReady)
	}
	if resource.Provider != "local" {
		t.Fatalf("resource.Provider = %q, want local (degraded from OSS)", resource.Provider)
	}
	if resource.Endpoint != "" || resource.Bucket != "" || resource.StorageSettingID != "" {
		t.Fatalf("resource storage binding not cleared after degrade: endpoint=%q bucket=%q setting=%q",
			resource.Endpoint, resource.Bucket, resource.StorageSettingID)
	}
	payload, err := os.ReadFile(filepath.Join(service.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)))
	if err != nil {
		t.Fatalf("local object not written: %v", err)
	}
	if string(payload) != "fake-mp4-bytes" {
		t.Fatalf("local object content = %q, want fake-mp4-bytes", payload)
	}
}

// TestStoreResourceLocalPathUnaffectedByOSS 未启用 OSS 时上传仍走本地存储，不受其他用户 OSS 设置影响。
func TestStoreResourceLocalPathUnaffectedByOSS(t *testing.T) {
	service, db := newResourceFallbackTestService(t)
	seedOSSEnabled(t, db, "user-other", "http://127.0.0.1:1")

	resource, created, err := service.storeResource(
		"user-2", "video", "local.mp4", "video/mp4", 512,
		1280, 720, 0, bytes.NewReader([]byte("local-bytes")), nil,
	)
	if err != nil {
		t.Fatalf("storeResource: %v", err)
	}
	if !created {
		t.Fatal("storeResource returned created=false, want true")
	}
	if resource.Provider != "local" {
		t.Fatalf("resource.Provider = %q, want local", resource.Provider)
	}
	payload, err := os.ReadFile(filepath.Join(service.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)))
	if err != nil {
		t.Fatalf("local object not written: %v", err)
	}
	if string(payload) != "local-bytes" {
		t.Fatalf("local object content = %q, want local-bytes", payload)
	}
}

func seedOSSEnabled(t *testing.T, db *gorm.DB, userID string, endpoint string) {
	t.Helper()
	setting := model.UserOSSSetting{
		UserID:    userID,
		Enabled:   true,
		ValueJSON: `{"provider":"aliyun","endpoint":"` + endpoint + `","bucket":"test-bucket","accessKeyId":"ak-test","accessKeySecret":"sk-plaintext","region":"cn-shenzhen"}`,
	}
	if err := db.Create(&setting).Error; err != nil {
		t.Fatal(err)
	}
}
