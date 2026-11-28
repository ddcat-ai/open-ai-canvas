package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newJimengMediaTestService(t *testing.T, importPerMinute int) *Service {
	t.Helper()
	// 出站客户端默认拦截回环地址，这里按测试惯例精确放行本地假服务。
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	// 转存会并发下载，连接池会新开连接；内存库的每个连接各是独立的空库，所以用临时文件库。
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "jimeng-media.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.UserOSSSetting{}, &model.StorageLocation{}, &model.UserDailyUploadUsage{}, &model.Resource{}, &model.ResourceOffloadJob{}, &model.UploadReservation{}, &model.UserStorageGrant{}, &model.UserStorageState{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	svc.coordinator = platform.NewCoordinatorWithRedis(nil, "jimeng-import-media-test")
	policy := platform.DefaultRuntimePolicy()
	policy.Request.ResourceImportPerMinute = importPerMinute
	encoded, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: model.RuntimePolicySettingKey, ValueJSON: string(encoded)}); err != nil {
		t.Fatal(err)
	}
	return svc
}

// fakeJimengMediaResolver 用本地图片服务代替即梦 CDN，按请求顺序返回素材或错误。
func fakeJimengMediaResolver(t *testing.T) jimengMediaResolver {
	t.Helper()
	png := mediaTestPNG(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/flaky.png") {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(png)
	}))
	t.Cleanup(server.Close)
	return func(_, _, _ string, resourceIDs []string) ([]JimengResolvedMedia, error) {
		resolved := make([]JimengResolvedMedia, 0, len(resourceIDs))
		for _, resourceID := range resourceIDs {
			if resourceID == "missing" {
				resolved = append(resolved, JimengResolvedMedia{ResourceID: resourceID, Error: "即梦素材不存在或已被删除"})
				continue
			}
			resolved = append(resolved, JimengResolvedMedia{ResourceID: resourceID, Media: &JimengMedia{ResourceID: resourceID, Kind: "image", URL: server.URL + "/" + resourceID + ".png", Width: 2, Height: 3, MimeType: "image/png"}})
		}
		return resolved, nil
	}
}

func TestStoreJimengImportMediaStoresEachResourceOnce(t *testing.T) {
	svc := newJimengMediaTestService(t, 30)
	resolve := fakeJimengMediaResolver(t)
	req := JimengMediaRequest{ProjectID: "0f0e0d0c-0b0a-4908-8706-050403020100", ResourceIDs: []string{"one", "missing", "two"}}

	result, err := svc.storeJimengImportMedia(context.Background(), "user-1", "canvas-1", req, resolve)
	if err != nil {
		t.Fatalf("storeJimengImportMedia() error = %v", err)
	}
	if len(result.Items) != 3 || result.RetryAfterSeconds != 0 {
		t.Fatalf("result = %#v", result)
	}
	for _, index := range []int{0, 2} {
		item := result.Items[index]
		if item.Resource == nil || item.Error != "" || item.Deferred || item.Retryable || item.Resource.Kind != "image" || item.Resource.Width != 2 || item.Resource.Height != 3 || item.Resource.UserID != "user-1" {
			t.Fatalf("stored item = %#v", item)
		}
	}
	if result.Items[1].Resource != nil || result.Items[1].Error != "即梦素材不存在或已被删除" || result.Items[1].Retryable {
		t.Fatalf("unresolvable item = %#v", result.Items[1])
	}
	// 上游下载失败属于瞬时问题，标记为可重试；素材不存在是确定性失败。
	if item, err := svc.storeJimengImportMedia(context.Background(), "user-1", "canvas-1", JimengMediaRequest{ProjectID: req.ProjectID, ResourceIDs: []string{"flaky"}}, resolve); err != nil || item.Items[0].Resource != nil || !item.Items[0].Retryable {
		t.Fatalf("flaky download = %#v, %v", item, err)
	}

	// 幂等键由画布 ID 和素材 ID 组成：同一画布重复导入返回已有资源，不重复占用存储。
	again, err := svc.storeJimengImportMedia(context.Background(), "user-1", "canvas-1", JimengMediaRequest{ProjectID: req.ProjectID, ResourceIDs: []string{"two", "one"}}, resolve)
	if err != nil {
		t.Fatalf("second store error = %v", err)
	}
	if again.Items[0].Resource == nil || again.Items[1].Resource == nil || again.Items[0].Resource.ID != result.Items[2].Resource.ID || again.Items[1].Resource.ID != result.Items[0].Resource.ID {
		t.Fatalf("second store = %#v", again.Items)
	}
}

func TestStoreJimengImportMediaDefersBeyondSiteLimit(t *testing.T) {
	svc := newJimengMediaTestService(t, 1)
	resolve := fakeJimengMediaResolver(t)

	result, err := svc.storeJimengImportMedia(context.Background(), "user-1", "canvas-1", JimengMediaRequest{ProjectID: "0f0e0d0c-0b0a-4908-8706-050403020100", ResourceIDs: []string{"one", "two", "three"}}, resolve)
	if err != nil {
		t.Fatalf("storeJimengImportMedia() error = %v", err)
	}
	if result.Items[0].Resource == nil || result.Items[0].Deferred {
		t.Fatalf("first item should be stored within the limit: %#v", result.Items[0])
	}
	for _, item := range result.Items[1:] {
		if !item.Deferred || item.Resource != nil || item.Error != "" {
			t.Fatalf("item beyond the limit must be deferred untouched: %#v", item)
		}
	}
	if result.RetryAfterSeconds < 1 || result.RetryAfterSeconds > 60 {
		t.Fatalf("retry hint = %d, want 1-60 seconds", result.RetryAfterSeconds)
	}
}
