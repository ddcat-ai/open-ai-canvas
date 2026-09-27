package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setPlatformUserStorage(t *testing.T, db *gorm.DB, allowed bool) {
	t.Helper()
	payload, err := json.Marshal(map[string]any{"provider": "aliyun", "publicBaseUrl": "https://canvas.example.com", "userStorageDisabled": !allowed})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Save(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(payload)}).Error; err != nil {
		t.Fatal(err)
	}
}

func personalStorageResource(t *testing.T, db *gorm.DB, userID string, status model.ResourceStatus) *model.Resource {
	t.Helper()
	var setting model.UserOSSSetting
	if err := db.Where("user_id = ?", userID).Order("created_at desc").First(&setting).Error; err != nil {
		t.Fatal(err)
	}
	resource := &model.Resource{ID: newID(), UserID: userID, Kind: "image", Status: status, Provider: "aliyun", Endpoint: "http://127.0.0.1:1", Bucket: "test-bucket", StorageSettingID: setting.ID, ObjectKey: "personal/" + newID() + ".png", MimeType: "image/png", Size: 5}
	if err := db.Create(resource).Error; err != nil {
		t.Fatal(err)
	}
	return resource
}

func TestUserStorageSwitchDefaultsOpenAndKeepsValueOnPartialSave(t *testing.T) {
	service, db := newResourceFallbackTestService(t)
	if _, value, err := service.readOSSSetting(); err != nil || value.UserStorageDisabled {
		t.Fatalf("default userStorageDisabled = %v, err = %v", value.UserStorageDisabled, err)
	}
	legacy := &model.SystemSetting{Key: ossSettingKey, ValueJSON: `{"provider":"aliyun","allowUserS3":true}`}
	if err := db.Create(legacy).Error; err != nil {
		t.Fatal(err)
	}
	if _, value, err := service.readOSSSetting(); err != nil || value.UserStorageDisabled {
		t.Fatalf("legacy userStorageDisabled = %v, err = %v", value.UserStorageDisabled, err)
	}

	closed := false
	next, err := ossSettingFromRequest(OSSSettingRequest{Provider: "aliyun", AllowUserStorage: &closed}, normalizeOSSSetting(defaultOSSSetting()))
	if err != nil || !next.UserStorageDisabled {
		t.Fatalf("explicit close = %v, err = %v", next.UserStorageDisabled, err)
	}
	kept, err := ossSettingFromRequest(OSSSettingRequest{Provider: "aliyun"}, next)
	if err != nil || !kept.UserStorageDisabled {
		t.Fatalf("request without allowUserStorage reopened personal storage: %v, err = %v", kept.UserStorageDisabled, err)
	}
}

func TestUserStorageSwitchRoutesNewWritesAwayFromPersonalStorage(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	service, db := newResourceFallbackTestService(t)
	seedOSSEnabled(t, db, "user-1", "http://127.0.0.1:1")

	setPlatformUserStorage(t, db, true)
	if setting, _, useOSS, err := service.activeResourceOSSSetting("user-1"); err != nil || !useOSS || setting.Endpoint != "http://127.0.0.1:1" {
		t.Fatalf("open switch should keep personal storage: useOSS=%v endpoint=%q err=%v", useOSS, setting.Endpoint, err)
	}

	setPlatformUserStorage(t, db, false)
	resource, _, err := service.storeResource("user-1", "image", "new.png", "image/png", 5, 1, 1, 0, bytes.NewReader([]byte("image")), nil, false)
	if err != nil {
		t.Fatalf("storeResource with personal storage closed: %v", err)
	}
	if resource.Provider != "local" || resource.StorageSettingID != "" {
		t.Fatalf("new write went to provider=%q setting=%q, want platform local storage", resource.Provider, resource.StorageSettingID)
	}
}

func TestUserStorageSwitchRebindsPersonalRetryWrites(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	service, db := newResourceFallbackTestService(t)
	seedOSSEnabled(t, db, "user-1", "http://127.0.0.1:1")

	// 开关打开时，失败重试仍写回原来绑定的个人存储（此处不可达，因此失败且绑定不变）。
	setPlatformUserStorage(t, db, true)
	open := personalStorageResource(t, db, "user-1", model.ResourceStatusFailed)
	if _, err := service.storeResourceObject(open, "retry.png", bytes.NewReader([]byte("image"))); err == nil || open.Provider != "aliyun" {
		t.Fatalf("open switch retry = provider %q err %v, want personal storage write attempt", open.Provider, err)
	}

	setPlatformUserStorage(t, db, false)
	for name, write := range map[string]func(*model.Resource) (string, error){
		"upload": func(resource *model.Resource) (string, error) {
			return service.storeResourceObject(resource, "retry.png", bytes.NewReader([]byte("image")))
		},
		"generated": func(resource *model.Resource) (string, error) {
			return service.storeTaskMediaObject(resource, "generated.png", bytes.NewReader([]byte("image")))
		},
	} {
		resource := personalStorageResource(t, db, "user-1", model.ResourceStatusFailed)
		if _, err := write(resource); err != nil {
			t.Fatalf("%s retry with personal storage closed: %v", name, err)
		}
		if resource.Provider != "local" || resource.StorageSettingID != "" || resource.Endpoint != "" {
			t.Fatalf("%s retry binding = %q %q %q, want platform local storage", name, resource.Provider, resource.Endpoint, resource.StorageSettingID)
		}
		if payload, err := os.ReadFile(filepath.Join(service.dataDir, "resources", filepath.FromSlash(resource.ObjectKey))); err != nil || string(payload) != "image" {
			t.Fatalf("%s retry local object = %q, err = %v", name, payload, err)
		}
	}
}

func TestUserStorageSwitchBlocksPersonalSettingsButKeepsHistoryReadable(t *testing.T) {
	service, db := newResourceFallbackTestService(t)
	seedOSSEnabled(t, db, "user-1", "http://127.0.0.1:1")
	setPlatformUserStorage(t, db, false)
	actor := &model.User{ID: "user-1", Role: model.UserRoleUser}

	if _, err := service.UpdateUserOSSSetting(actor, OSSSettingRequest{Provider: "aliyun"}); err == nil || err.Error() != "平台管理员已关闭个人存储" {
		t.Fatalf("UpdateUserOSSSetting error = %v", err)
	}
	if _, err := service.TestUserOSSSetting(actor, OSSSettingRequest{Provider: "aliyun"}); err == nil || err.Error() != "平台管理员已关闭个人存储" {
		t.Fatalf("TestUserOSSSetting error = %v", err)
	}
	public, err := service.UserOSSSetting(actor)
	if err != nil {
		t.Fatal(err)
	}
	if public.AllowUserStorage || public.Enabled {
		t.Fatalf("user storage view = allow %v enabled %v, want both false", public.AllowUserStorage, public.Enabled)
	}

	history := personalStorageResource(t, db, "user-1", model.ResourceStatusReady)
	setting, err := service.ossSettingForResource("user-1", history)
	if err != nil || setting.Endpoint != "http://127.0.0.1:1" || setting.Bucket != "test-bucket" {
		t.Fatalf("history read setting = %q/%q, err = %v", setting.Endpoint, setting.Bucket, err)
	}
}

// 同一上传幂等键重传时经 retryStoredResource 写入：关闭个人存储后改写到平台存储，数据库绑定随之更新。
func TestUserStorageSwitchRebindsSameKeyReupload(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	dsn := fmt.Sprintf("file:%s_%d?mode=memory&cache=shared", t.Name(), time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	service := New(repository.New(db), t.TempDir())
	seedOSSEnabled(t, db, "user-1", "http://127.0.0.1:1")
	data := []byte("image-bytes")

	setPlatformUserStorage(t, db, true)
	if _, err := service.UploadResourceFile("user-1", "retry.png", int64(len(data)), "image", 1, 1, 0, bytes.NewReader(data), "upload-key-1"); err == nil {
		t.Fatal("upload to the unreachable personal storage should fail")
	}
	var failed model.Resource
	if err := db.First(&failed).Error; err != nil {
		t.Fatal(err)
	}
	if failed.Status != model.ResourceStatusFailed || failed.Provider != "aliyun" {
		t.Fatalf("first attempt = %s/%s, want failed personal storage binding", failed.Status, failed.Provider)
	}

	setPlatformUserStorage(t, db, false)
	resource, err := service.UploadResourceFile("user-1", "retry.png", int64(len(data)), "image", 1, 1, 0, bytes.NewReader(data), "upload-key-1")
	if err != nil {
		t.Fatalf("same-key re-upload with personal storage closed: %v", err)
	}
	var stored model.Resource
	if err := db.First(&stored, "id = ?", failed.ID).Error; err != nil {
		t.Fatal(err)
	}
	if resource.ID != failed.ID || stored.Status != model.ResourceStatusReady || stored.Provider != "local" || stored.StorageSettingID != "" || stored.Endpoint != "" {
		t.Fatalf("re-upload stored = id %s status %s provider %q setting %q endpoint %q", stored.ID, stored.Status, stored.Provider, stored.StorageSettingID, stored.Endpoint)
	}
	if payload, err := os.ReadFile(filepath.Join(service.dataDir, "resources", filepath.FromSlash(stored.ObjectKey))); err != nil || string(payload) != string(data) {
		t.Fatalf("re-upload local object = %q, err = %v", payload, err)
	}
}
