package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestAdminGenerationReferenceHTTPAuthorizationOriginalRangeAndPrivacy(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dataDir, "resources"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "resources", "original"), []byte("0123456789"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
		id := string(role)
		if err := db.Create(&model.User{ID: id, Username: id, Email: id + "@example.invalid", Role: role, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, item := range []any{
		&model.Resource{ID: "original", UserID: "owner", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "original", MimeType: "video/mp4", Size: 10},
		&model.Resource{ID: "foreign", UserID: "other", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "original", MimeType: "video/mp4", Size: 10},
		&model.ApiCallLog{ID: "log", UserID: "owner", Capability: "video", RequestKind: "create", GenerationContentJSON: `{"version":1,"prompt":"@视频1","references":[{"id":"ref","kind":"video","label":"视频1","name":"原视频","resourceId":"original"}]}`},
		&model.ApiCallLog{ID: "other-log", UserID: "owner", Capability: "video", RequestKind: "create", GenerationContentJSON: `{"version":1,"prompt":"@视频1","references":[{"id":"other-ref","kind":"video","label":"视频1","name":"另一请求","resourceId":"original"}]}`},
		&model.ApiCallLog{ID: "foreign-log", UserID: "owner", Capability: "video", RequestKind: "create", GenerationContentJSON: `{"version":1,"prompt":"@视频1","references":[{"id":"ref","kind":"video","label":"视频1","name":"不可读","resourceId":"foreign"}]}`},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), dataDir)
	router := gin.New()
	registerAdminAPILogRoutes(router.Group("/api"), svc)
	call := func(role, path, rangeHeader string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		if role != "" {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: role + ".test-token"})
		}
		if rangeHeader != "" {
			r.Header.Set("Range", rangeHeader)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	base := "/api/admin/api-logs/log/references/ref/media"
	for _, tc := range []struct {
		role, path string
		want       int
	}{{"", base, 401}, {"user", base, 403}, {"admin", "/api/admin/api-logs/other-log/references/ref/media", 404}, {"admin", "/api/admin/api-logs/foreign-log/references/ref/media", 404}, {"admin", "/api/admin/api-logs/log/references/original/media", 404}, {"admin", base + "?variant=thumbnail", 400}, {"admin", base + "?access=1", 400}, {"admin", base + "?url=https://external.invalid/file", 400}} {
		w := call(tc.role, tc.path, "")
		if w.Code != tc.want {
			t.Fatalf("%+v: status=%d body=%s", tc, w.Code, w.Body.String())
		}
	}
	w := call("admin", base, "bytes=2-5")
	if w.Code != http.StatusPartialContent || w.Body.String() != "2345" || w.Header().Get("Content-Range") != "bytes 2-5/10" {
		t.Fatalf("range status=%d headers=%#v body=%s", w.Code, w.Header(), w.Body.String())
	}
	for key, want := range map[string]string{"Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Type": "video/mp4", "Accept-Ranges": "bytes"} {
		if w.Header().Get(key) != want {
			t.Fatalf("%s=%q", key, w.Header().Get(key))
		}
	}
	if w.Header().Get("Location") != "" {
		t.Fatalf("original redirected: %#v", w.Header())
	}
	w = call("admin", base, "")
	if w.Code != 200 || w.Body.String() != "0123456789" {
		t.Fatalf("full original=%d %q", w.Code, w.Body.String())
	}
	w = call("admin", "/api/admin/api-logs/log", "")
	var detail struct {
		Data struct {
			Log struct {
				GenerationContent model.APICallGenerationContent `json:"generationContent"`
			} `json:"log"`
		} `json:"data"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &detail) != nil || detail.Data.Log.GenerationContent.References[0].MediaURL != base {
		t.Fatalf("detail=%d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "resourceId") || strings.Contains(w.Body.String(), "generationContentJSON") {
		t.Fatalf("private identity leaked: %s", w.Body.String())
	}
	w = call("admin", "/api/admin/api-logs", "")
	if w.Code != 200 || strings.Contains(w.Body.String(), "generationContent") {
		t.Fatalf("list=%d %s", w.Code, w.Body.String())
	}
}
