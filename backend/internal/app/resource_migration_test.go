package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestMoveResourceToLocal(t *testing.T) {
	svc := newResourceTestService(t)
	content := []byte("test-video-content-1234567890")

	// 模拟 S3/OSS 服务端
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			w.Header().Set("Content-Length", fmt.Sprintf("%d", len(content)))
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write(content)
			return
		}
		if r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	serverURL, _ := url.Parse(server.URL)
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "1")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", serverURL.Hostname())

	actor := &model.User{ID: "user-1", Role: model.UserRoleAdmin}

	settingJSON, _ := json.Marshal(ossSettingValue{
		Enabled: true, Provider: "s3", Endpoint: server.URL, Bucket: "my-bucket",
		AccessKeyID: "access-id", AccessKeySecret: "secret-value", Region: "us-east-1",
	})
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: ossSettingKey, ValueJSON: string(settingJSON)}); err != nil {
		t.Fatal(err)
	}

	res := &model.Resource{
		ID:        "res-test-1",
		UserID:    "user-1",
		Kind:      "video",
		Provider:  "s3",
		Bucket:    "my-bucket",
		Endpoint:  server.URL,
		ObjectKey: "test/video.mp4",
		Size:      int64(len(content)),
		Status:    model.ResourceStatusReady,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	if err := svc.repo.CreateResource(res); err != nil {
		t.Fatalf("CreateResource error: %v", err)
	}

	migrated, err := svc.MoveResourceToLocal(actor, "res-test-1")
	if err != nil {
		t.Fatalf("MoveResourceToLocal failed: %v", err)
	}

	if migrated.Provider != "local" {
		t.Errorf("Provider = %q, want local", migrated.Provider)
	}
	if migrated.Bucket != "" || migrated.Endpoint != "" {
		t.Errorf("OSS fields not cleared: bucket=%q endpoint=%q", migrated.Bucket, migrated.Endpoint)
	}

	// 检查服务器本地文件是否存在
	localFilePath := filepath.Join(svc.dataDir, "resources", "test", "video.mp4")
	data, err := os.ReadFile(localFilePath)
	if err != nil {
		t.Fatalf("local file not found: %v", err)
	}
	if string(data) != string(content) {
		t.Errorf("content mismatch: got %q, want %q", string(data), string(content))
	}
}
