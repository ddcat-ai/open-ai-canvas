package handler

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestAppearanceRoutesAreRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterAppearanceRoutes(router.Group("/api"), &service.Service{})
	wanted := map[string]bool{
		"GET /api/public/appearance/updates/:id":              false,
		"GET /api/admin/settings/appearance/updates/:id":      false,
		"POST /api/admin/settings/appearance/live2d":          false,
		"GET /api/admin/settings/appearance/live2d/:id/*file": false,
		"GET /api/public/appearance/live2d/:id/*file":         false,
		"GET /api/public/appearance":                          false,
		"GET /api/public/appearance/assets/:slot":             false,
		"GET /api/admin/settings/appearance":                  false,
		"PATCH /api/admin/settings/appearance":                false,
		"DELETE /api/admin/settings/appearance":               false,
		"POST /api/admin/settings/appearance/assets/:slot":    false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Errorf("route %s is not registered", route)
		}
	}
}

func TestAppearanceUpdateAnnouncementMediaRangeAndDisabledAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:appearance-handler-range?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "resources"), 0750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "resources", "fixture.mp4"), []byte("video-data"), 0640); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "fixture-video", UserID: "admin", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "fixture.mp4", MimeType: "video/mp4", Size: 10}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	setting, err := svc.AdminAppearance(admin)
	if err != nil {
		t.Fatal(err)
	}
	setting.Updates = app.UpdateAnnouncement{Enabled: true, CurrentVersion: "v2", Releases: []app.UpdateRelease{{ID: "r1", Version: "v2", Blocks: []app.UpdateBlock{{ID: "b1", Type: "video", ResourceID: resource.ID, Layout: "full"}}}}}
	if _, err := svc.UpdateAppearance(admin, setting.AppearanceSetting); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterAppearanceRoutes(router.Group("/api"), svc)
	req := httptest.NewRequest(http.MethodGet, "/api/public/appearance/updates/fixture-video", nil)
	req.Header.Set("Range", "bytes=0-3")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 206 || rec.Body.String() != "vide" || rec.Header().Get("Content-Range") != "bytes 0-3/10" {
		t.Fatalf("Range HTTP response: %d %q %v", rec.Code, rec.Body.String(), rec.Header())
	}
	preview := httptest.NewRecorder()
	router.ServeHTTP(preview, httptest.NewRequest(http.MethodGet, "/api/admin/settings/appearance/updates/fixture-video", nil))
	if preview.Code != 401 {
		t.Fatalf("anonymous admin preview: %d", preview.Code)
	}
	setting.Updates.Enabled = false
	if _, err := svc.UpdateAppearance(admin, setting.AppearanceSetting); err != nil {
		t.Fatal(err)
	}
	disabled := httptest.NewRecorder()
	router.ServeHTTP(disabled, req)
	if disabled.Code != 404 {
		t.Fatalf("disabled public media: %d", disabled.Code)
	}
}
