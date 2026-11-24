package handler

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDramaJianyingPreviewAndDownloadRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	connection, _ := db.DB()
	connection.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = connection.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.UserStorageGrant{}, &model.UserStorageState{}, &model.Project{}, &model.DramaProduction{}, &model.DramaEpisode{}, &model.DramaSegment{}, &model.DramaShot{}, &model.Resource{}); err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{
		&model.User{ID: "owner", Username: "owner", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "owner", UserID: "owner", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.Project{ID: "project", UserID: "owner", Name: "草稿导出"},
		&model.Project{ID: "foreign", UserID: "other", Name: "其他作品"},
		&model.DramaProduction{ProjectID: "project", UserID: "owner"},
		&model.DramaProduction{ProjectID: "foreign", UserID: "other"},
		&model.DramaEpisode{ID: "episode", ProjectID: "project", Number: 1},
		&model.DramaEpisode{ID: "other-episode", ProjectID: "foreign", Number: 1},
		&model.DramaShot{ID: "shot", ProjectID: "project", EpisodeID: "episode", SegmentIndex: 0, DurationMs: 2000, Dialogue: "台词"},
		&model.DramaSegment{ID: "segment", ProjectID: "project", EpisodeID: "episode", SegmentIndex: 0, VideoStatus: model.DramaMediaReady, VideoResourceID: "resource"},
		&model.Resource{ID: "resource", UserID: "owner", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "video.mp4", MimeType: "video/mp4", Size: 5, DurationMs: 2000, Width: 1080, Height: 1920},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	dataDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dataDir, "resources"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "resources/video.mp4"), []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dataDir)
	router := gin.New()
	registerDramaRoutes(router.Group("/api"), svc)
	request := func(path, contentType, body string, signed bool) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", contentType)
		if signed {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "owner.test-token"})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		return response
	}
	path := "/dramas/project/episodes/episode/jianying-draft"
	body := `{"draftRoot":"/Users/editor/Drafts","captions":true}`
	for _, input := range []struct {
		path   string
		signed bool
		want   int
	}{
		{path + "/preview", false, 401},
		{"/dramas/foreign/episodes/other-episode/jianying-draft/preview", true, 404},
		{"/dramas/project/episodes/other-episode/jianying-draft/preview", true, 404},
	} {
		response := request(input.path, "application/json", body, input.signed)
		if response.Code != input.want || !strings.Contains(response.Header().Get("Content-Type"), "json") {
			t.Fatalf("wrong response: %d %s", response.Code, response.Body.String())
		}
	}
	response := request(path+"/preview", "application/json", body, true)
	if response.Code != 200 || response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("preview: %d %s", response.Code, response.Body.String())
	}
	var envelope struct {
		Code int                               `json:"code"`
		Data service.DramaJianyingDraftPreview `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Code != 0 || envelope.Data.AvailableSegments != 1 || len(envelope.Data.Revision) != 64 {
		t.Fatalf("bad preview: %s", response.Body.String())
	}
	fields := url.Values{"draftRoot": {"/Users/editor/Drafts"}, "captions": {"1"}}
	response = request(path, "application/x-www-form-urlencoded", fields.Encode(), true)
	if response.Code != 409 {
		t.Fatalf("unreviewed export returned %d", response.Code)
	}
	fields.Set("revision", envelope.Data.Revision)
	response = request(path, "application/x-www-form-urlencoded", fields.Encode(), true)
	if response.Code != 200 || response.Header().Get("Content-Type") != "application/zip" || !strings.HasPrefix(response.Header().Get("Content-Disposition"), "attachment;") {
		t.Fatalf("expected streamed attachment: %d %s", response.Code, response.Body.String())
	}
	if _, err := zip.NewReader(bytes.NewReader(response.Body.Bytes()), int64(response.Body.Len())); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.DramaShot{}).Where("id = ?", "shot").Update("dialogue", "修改台词").Error; err != nil {
		t.Fatal(err)
	}
	response = request(path, "application/x-www-form-urlencoded", fields.Encode(), true)
	if response.Code != 409 || response.Header().Get("Content-Disposition") != "" {
		t.Fatalf("changed data started attachment: %d", response.Code)
	}
}
