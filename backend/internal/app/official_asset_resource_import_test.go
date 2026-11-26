package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestOfficialAssetResourceImportOAuth(t *testing.T) {
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.test")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db, admin := assistantTestService(t)
	var downloads atomic.Int32
	data := mediaTestPNG(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloads.Add(1)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(data)
	}))
	defer server.Close()
	grant := &model.AssistantGrant{ID: newID(), UserID: admin.ID, ClientID: "test", ScopesJSON: assistantJSON([]string{"official-assets:write"}), CreatedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour), RefreshHash: assistantHash("test-refresh")}
	if err := db.Create(grant).Error; err != nil {
		t.Fatal(err)
	}
	token, credential := assistantAccessToken(grant, time.Now())
	if err := db.Create(credential).Error; err != nil {
		t.Fatal(err)
	}
	p, err := s.AuthenticateAssistant(token)
	if err != nil {
		t.Fatal(err)
	}
	args, _ := json.Marshal(map[string]any{"req": map[string]any{"url": server.URL + "/sample.png", "uploadKey": "official-import-test"}})
	req := AssistantExecuteRequest{Operation: "ImportOfficialAssetResourceURL", Arguments: args, IdempotencyKey: "official-import-call"}
	readOnly, _ := assistantTestToken(t, s, admin, "official-assets:read")
	if _, err := s.ExecuteAssistantOperation(context.Background(), readOnly, req, "mcp"); err == nil {
		t.Fatal("read-only credential imported a resource")
	}
	op, err := s.DescribeAssistantOperation(p, req.Operation)
	if err != nil || op.Module != "official-assets" || !op.Write || !op.HighRisk {
		t.Fatalf("missing scoped import operation: %+v %v", op, err)
	}
	pending, err := s.ExecuteAssistantOperation(context.Background(), p, req, "mcp")
	if err != nil || pending.Status != "pending_confirmation" || downloads.Load() != 0 {
		t.Fatalf("import before confirmation: %+v %v downloads=%d", pending, err, downloads.Load())
	}
	if err := s.ConfirmAssistantCall(admin, pending.ID, true); err != nil {
		t.Fatal(err)
	}
	out, err := s.ExecuteAssistantOperation(context.Background(), p, req, "mcp")
	if err != nil || out.Status != "succeeded" {
		t.Fatalf("import failed: %+v %v", out, err)
	}
	var resource model.Resource
	if err := db.Where("user_id = ?", admin.ID).First(&resource).Error; err != nil {
		t.Fatal(err)
	}
	if resource.Kind != "image" || resource.Status != model.ResourceStatusReady || resource.Width <= 0 || resource.Height <= 0 {
		t.Fatalf("invalid imported resource: %+v", resource)
	}
	result, ok := out.Result.(map[string]any)
	if !ok || result["id"] != resource.ID || result["userId"] != admin.ID {
		t.Fatalf("execution did not return the owned resource ID: %+v", out.Result)
	}
	asset, err := s.CreateOfficialAsset(admin, CreateOfficialAssetRequest{ResourceID: resource.ID, Title: "网络测试素材", MediaType: "image", Category: string(model.AssetCategoryMaterial)})
	if err != nil || asset.ResourceID != resource.ID {
		t.Fatalf("imported resource cannot create official asset: %+v %v", asset, err)
	}
	if replay, err := s.ExecuteAssistantOperation(context.Background(), p, req, "mcp"); err != nil || replay.Status != "succeeded" || downloads.Load() != 1 {
		t.Fatalf("idempotent replay: %+v %v downloads=%d", replay, err, downloads.Load())
	}
	if err := s.repo.RevokeAssistantGrant(admin.ID, grant.ID); err != nil {
		t.Fatal(err)
	}
	req.IdempotencyKey = "revoked-import-call"
	if _, err := s.ExecuteAssistantOperation(context.Background(), p, req, "mcp"); err == nil || downloads.Load() != 1 {
		t.Fatal("revoked OAuth grant reached resource download")
	}
}

func TestOfficialAssetResourceImportContentIdentity(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db, admin := assistantTestService(t)
	encode := func(c color.RGBA) []byte {
		img := image.NewRGBA(image.Rect(0, 0, 2, 2))
		for y := 0; y < 2; y++ {
			for x := 0; x < 2; x++ {
				img.SetRGBA(x, y, c)
			}
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	red := encode(color.RGBA{R: 255, A: 255})
	blue := encode(color.RGBA{B: 255, A: 255})
	// PNG 解码忽略结尾填充，用两张有效图片验证“大小相同、内容不同”的冲突。
	size := max(len(red), len(blue))
	red = append(red, make([]byte, size-len(red))...)
	blue = append(blue, make([]byte, size-len(blue))...)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		if r.URL.Path == "/red.png" {
			_, _ = w.Write(red)
		} else {
			_, _ = w.Write(blue)
		}
	}))
	defer server.Close()
	for _, status := range []model.ResourceStatus{model.ResourceStatusReady, model.ResourceStatusFailed} {
		t.Run(string(status), func(t *testing.T) {
			req := ImportOfficialAssetResourceRequest{URL: server.URL + "/red.png", UploadKey: "content-identity-" + string(status)}
			first, err := s.ImportOfficialAssetResourceURL(admin, req)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(first).Update("status", status).Error; err != nil {
				t.Fatal(err)
			}
			req.URL = server.URL + "/blue.png"
			var appErr *AppError
			if _, err := s.ImportOfficialAssetResourceURL(admin, req); !errors.As(err, &appErr) || appErr.Status != http.StatusConflict {
				t.Fatalf("changed content should conflict: %v", err)
			}
			req.URL = server.URL + "/red.png"
			replay, err := s.ImportOfficialAssetResourceURL(admin, req)
			if err != nil || replay.ID != first.ID || replay.Status != model.ResourceStatusReady {
				t.Fatalf("same content should reuse resource: %+v %v", replay, err)
			}
			// 模拟查询时尚无记录、实际入库时另一请求已完成的竞争窗口。
			if _, err := s.storeFetchedResource(admin.ID, nil, first.UploadKey, "blue.png", blue, 0, 0, 0); !errors.As(err, &appErr) || appErr.Status != http.StatusConflict {
				t.Fatalf("concurrent existing content should conflict: %v", err)
			}
		})
	}
}

func TestOfficialAssetResourceImportWriteFailureKeepsDigest(t *testing.T) {
	s, db, admin := assistantTestService(t)
	data := mediaTestPNG(t)
	key := normalizedResourceUploadKey([]string{"official-asset:failed-write-key"})
	blocked := filepath.Join(s.dataDir, "resources")
	if err := os.WriteFile(blocked, []byte("blocked"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.storeFetchedResource(admin.ID, nil, key, "test.png", data, 0, 0, 0); err == nil {
		t.Fatal("storage write unexpectedly succeeded")
	}
	var failed model.Resource
	if err := db.Where("user_id = ?", admin.ID).First(&failed).Error; err != nil {
		t.Fatal(err)
	}
	if failed.Status != model.ResourceStatusFailed || len(failed.ContentSHA256) != 64 {
		t.Fatalf("failed write lost content identity: %+v", failed)
	}
	if err := os.Remove(blocked); err != nil {
		t.Fatal(err)
	}
	recovered, err := s.storeFetchedResource(admin.ID, &failed, key, "test.png", data, 0, 0, 0)
	if err != nil || recovered.ID != failed.ID || recovered.Status != model.ResourceStatusReady {
		t.Fatalf("same-content retry failed: %+v %v", recovered, err)
	}
}

func TestOfficialAssetResourceImportBoundaries(t *testing.T) {
	s, db, admin := assistantTestService(t)
	var downloads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		downloads.Add(1)
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("<html><script>alert(1)</script></html>"))
	}))
	defer server.Close()
	request := ImportOfficialAssetResourceRequest{URL: server.URL + "/fake.png", UploadKey: "boundary-key"}
	if _, err := s.ImportOfficialAssetResourceURL(nil, request); err == nil {
		t.Fatal("anonymous import accepted")
	}
	if _, err := s.ImportOfficialAssetResourceURL(&model.User{ID: "user", Role: model.UserRoleUser}, request); err == nil {
		t.Fatal("ordinary user imported official resource")
	}
	if _, err := s.ImportOfficialAssetResourceURL(&model.User{Role: model.UserRoleAdmin}, request); err == nil {
		t.Fatal("empty administrator ID accepted")
	}
	if _, err := s.ImportOfficialAssetResourceURL(admin, ImportOfficialAssetResourceRequest{URL: request.URL}); err == nil {
		t.Fatal("missing upload identity accepted")
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "")
	if _, err := s.ImportOfficialAssetResourceURL(admin, request); err == nil || downloads.Load() != 0 {
		t.Fatal("private upstream reached download")
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	if _, err := s.ImportOfficialAssetResourceURL(admin, request); err == nil || downloads.Load() != 1 {
		t.Fatal("HTML disguised as PNG accepted")
	}
	var count int64
	if err := db.Model(&model.Resource{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("rejected import persisted resources: %d %v", count, err)
	}
}
