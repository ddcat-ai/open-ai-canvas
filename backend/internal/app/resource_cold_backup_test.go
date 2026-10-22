package app

import (
	"os"
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// 冷备路径必须拒绝越界对象键，否则 ObjectKey 里的 ../ 会把文件写到数据目录外。
func TestColdBackupPathRejectsEscapingObjectKey(t *testing.T) {
	svc := &Service{dataDir: t.TempDir()}
	for _, key := range []string{"", "..", "../escape.png", "users/../../escape.png", "/abs.png"} {
		resource := &model.Resource{ObjectKey: key}
		if path, err := svc.coldBackupPath(resource); err == nil {
			t.Fatalf("objectKey %q accepted as %s", key, path)
		}
	}
	resource := &model.Resource{ObjectKey: "users/u1/image/a.png"}
	path, err := svc.coldBackupPath(resource)
	if err != nil {
		t.Fatalf("valid objectKey rejected: %v", err)
	}
	want := filepath.Join(svc.dataDir, "resources", "users", "u1", "image", "a.png")
	if path != want {
		t.Fatalf("path = %s, want %s", path, want)
	}
}

// 冷备读取必须能打开本地文件并声明 bytes 范围，交由 http.ServeContent 处理 Range。
func TestOpenColdBackupRangeReadsLocalFile(t *testing.T) {
	svc := &Service{dataDir: t.TempDir()}
	resource := &model.Resource{ID: "r1", ObjectKey: "users/u1/image/a.png", MimeType: "image/png", Size: 10}
	path, err := svc.coldBackupPath(resource)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("0123456789"), 0o644); err != nil {
		t.Fatal(err)
	}
	stream, err := svc.OpenColdBackupRange(resource, "bytes=0-3")
	if err != nil {
		t.Fatalf("open cold backup: %v", err)
	}
	defer stream.Body.Close()
	if stream.StatusCode != 200 || stream.ContentLength != 10 || stream.AcceptRanges != "bytes" {
		t.Fatalf("unexpected stream: %+v", stream)
	}
	data := make([]byte, 4)
	if _, err := stream.Body.Read(data); err != nil {
		t.Fatal(err)
	}
	if string(data) != "0123" {
		t.Fatalf("body = %q", string(data))
	}
}

// 本地没有冷备时必须返回错误，让 HTTP 层退回 302 而不是 500 或空响应。
func TestOpenColdBackupRangeMissingFile(t *testing.T) {
	svc := &Service{dataDir: t.TempDir()}
	resource := &model.Resource{ID: "r1", ObjectKey: "users/u1/image/missing.png"}
	if stream, err := svc.OpenColdBackupRange(resource, ""); err == nil {
		if stream != nil {
			_ = stream.Body.Close()
		}
		t.Fatal("missing cold backup should return an error")
	}
}

// 幂等：本地已有等长文件时直接标记 ready，不访问对象存储。
func TestSyncResourceToColdSkipsExistingCompleteFile(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:cold-backup-idempotent?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Resource{}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{
		ID: "r1", UserID: "u1", Kind: "image", Status: model.ResourceStatusReady,
		Provider: "s3", ObjectKey: "users/u1/image/a.png", MimeType: "image/png", Size: 4,
	}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir())
	path, err := svc.coldBackupPath(&resource)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("data"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := svc.syncResourceToCold(&resource); err != nil {
		t.Fatalf("sync should be a no-op: %v", err)
	}
	var stored model.Resource
	if err := db.First(&stored, "id = ?", "r1").Error; err != nil {
		t.Fatal(err)
	}
	if stored.ColdBackupStatus != model.ColdBackupStatusReady {
		t.Fatalf("cold backup status = %q", stored.ColdBackupStatus)
	}
}

// 非 s3 资源与超大对象都不应进入冷备，避免无意义的磁盘占用。
func TestColdBackupEligibility(t *testing.T) {
	cases := []struct {
		resource *model.Resource
		want     bool
	}{
		{&model.Resource{Provider: "s3", Kind: "image", Status: model.ResourceStatusReady, ObjectKey: "a.png"}, true},
		{&model.Resource{Provider: "s3", Kind: "video", Status: model.ResourceStatusReady, ObjectKey: "a.mp4"}, true},
		{&model.Resource{Provider: "local", Kind: "image", Status: model.ResourceStatusReady, ObjectKey: "a.png"}, false},
		{&model.Resource{Provider: "qiniu", Kind: "image", Status: model.ResourceStatusReady, ObjectKey: "a.png"}, false},
		{&model.Resource{Provider: "s3", Kind: "file", Status: model.ResourceStatusReady, ObjectKey: "a.pdf"}, false},
		{&model.Resource{Provider: "s3", Kind: "image", Status: model.ResourceStatusPending, ObjectKey: "a.png"}, false},
		{&model.Resource{Provider: "s3", Kind: "image", Status: model.ResourceStatusReady}, false},
		{nil, false},
	}
	for _, item := range cases {
		if got := coldBackupEligible(item.resource); got != item.want {
			t.Fatalf("eligible(%+v) = %v, want %v", item.resource, got, item.want)
		}
	}
}
