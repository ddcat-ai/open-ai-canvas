package app

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

// TestStoreResourceFailsWhenOSSUnavailable ensures an enabled object-storage
// configuration does not silently change the resource to local storage.
func TestStoreResourceFailsWhenOSSUnavailable(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	service, db := newResourceFallbackTestService(t)
	seedOSSEnabled(t, db, "user-1", "http://127.0.0.1:1")

	resource, created, err := service.storeResource(
		"user-1", "video", "intro.mp4", "video/mp4", 1024,
		1920, 1080, 0, bytes.NewReader([]byte("fake-mp4-bytes")), nil, false,
	)
	if err == nil {
		t.Fatal("storeResource() error = nil, want OSS upload error")
	}
	if !created {
		t.Fatal("storeResource returned created=false, want true for persisted failed resource")
	}
	if resource != nil {
		t.Fatalf("storeResource returned resource = %#v, want nil on failed upload", resource)
	}

	var stored model.Resource
	if err := db.First(&stored).Error; err != nil {
		t.Fatalf("failed resource was not persisted: %v", err)
	}
	if stored.Status != model.ResourceStatusFailed {
		t.Fatalf("resource.Status = %q, want %q", stored.Status, model.ResourceStatusFailed)
	}
	if stored.Provider != "aliyun" || stored.Endpoint != "http://127.0.0.1:1" || stored.Bucket != "test-bucket" || stored.StorageSettingID == "" {
		t.Fatalf("resource OSS binding changed after failed upload: provider=%q endpoint=%q bucket=%q setting=%q", stored.Provider, stored.Endpoint, stored.Bucket, stored.StorageSettingID)
	}
	if _, err := os.Stat(filepath.Join(service.dataDir, "resources")); !os.IsNotExist(err) {
		t.Fatalf("local resources directory exists after failed OSS upload: err=%v", err)
	}
}

// TestStoreResourceLocalPathUnaffectedByOSS 未启用 OSS 时上传仍走本地存储，不受其他用户 OSS 设置影响。
func TestStoreResourceLocalPathUnaffectedByOSS(t *testing.T) {
	service, db := newResourceFallbackTestService(t)
	seedOSSEnabled(t, db, "user-other", "http://127.0.0.1:1")

	resource, created, err := service.storeResource(
		"user-2", "video", "local.mp4", "video/mp4", 512,
		1280, 720, 0, bytes.NewReader([]byte("local-bytes")), nil, false,
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
		ID:        newID(),
		UserID:    userID,
		Enabled:   true,
		ValueJSON: `{"provider":"aliyun","endpoint":"` + endpoint + `","bucket":"test-bucket","accessKeyId":"ak-test","accessKeySecret":"sk-plaintext","region":"cn-shenzhen"}`,
	}
	if err := db.Create(&setting).Error; err != nil {
		t.Fatal(err)
	}
}
