package handler

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestPersonalAvatarHTTPUploadPlaybackAndAccessControl(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:personal-avatar-http?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"avatar-owner", "avatar-other"} {
		if err := db.Create(&model.User{ID: id, Username: id, Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("avatar-test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	svc := service.New(repository.New(db), t.TempDir())
	previousRuntime := runtimeService
	runtimeService = svc
	t.Cleanup(func() { runtimeService = previousRuntime })
	RegisterAppearanceRoutes(router.Group("/api"), svc)
	var archive bytes.Buffer
	z := zip.NewWriter(&archive)
	for name, data := range map[string][]byte{"avatar.json": []byte(`{"version":1,"width":480,"height":432,"clips":{"idle":"idle.mp4"}}`), "idle.mp4": {0, 0, 0, 16, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0}} {
		file, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	upload := func(user, path string) *httptest.ResponseRecorder {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, _ := writer.CreateFormFile("file", "avatar.zip")
		part.Write(archive.Bytes())
		writer.Close()
		req := httptest.NewRequest(http.MethodPost, path, &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		if user != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: user + ".avatar-test-token"})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	if response := upload("", "/api/appearance/avatar-bundles"); response.Code != 401 {
		t.Fatalf("anonymous upload: %d", response.Code)
	}
	if response := upload("avatar-owner", "/api/admin/settings/appearance/avatar-bundles"); response.Code != 403 {
		t.Fatalf("admin gate lost: %d", response.Code)
	}
	response := upload("avatar-owner", "/api/appearance/avatar-bundles")
	if response.Code != 200 {
		t.Fatalf("ordinary upload: %d %s", response.Code, response.Body.String())
	}
	var result struct {
		Code int `json:"code"`
		Data struct {
			Bundle service.AgentAvatarBundleImport `json:"bundle"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != 0 || result.Data.Bundle.ResourceID == "" {
		t.Fatalf("upload contract: %v %s", err, response.Body.String())
	}
	for _, test := range []struct {
		user, prefix string
		status       int
	}{
		{"avatar-owner", "/api/appearance/avatar/", 206}, {"avatar-other", "/api/appearance/avatar/", 404}, {"", "/api/appearance/avatar/", 401}, {"", "/api/public/appearance/avatar/", 404},
	} {
		req := httptest.NewRequest(http.MethodGet, test.prefix+result.Data.Bundle.ResourceID+"/idle.mp4", nil)
		req.Header.Set("Range", "bytes=0-3")
		if test.user != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: test.user + ".avatar-test-token"})
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		if out.Code != test.status {
			t.Fatalf("%s %s: %d %s", test.user, test.prefix, out.Code, out.Body.String())
		}
		if test.status == 206 && (out.Header().Get("Cache-Control") != "private, no-store" || out.Header().Get("Content-Range") != "bytes 0-3/16" || out.Body.Len() != 4) {
			t.Fatalf("private playback headers: %+v", out.Header())
		}
	}
}
