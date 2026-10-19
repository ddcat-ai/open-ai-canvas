package handler

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/app"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestAppearanceSpriteThumbnailConditionalAndUnpublish(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:sprite-handler-cache?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err = os.MkdirAll(filepath.Join(dir, "resources"), 0750); err != nil {
		t.Fatal(err)
	}
	p := &app.SpritePet{DisplayName: "Pet", SpritesheetPath: "atlas.png", AtlasWidth: 32, AtlasHeight: 16, FrameWidth: 16, FrameHeight: 16, LookStartFrame: -1, Speed: 1, Actions: []app.SpriteAction{{ID: "idle", Label: "Idle", Frames: 2, FPS: 4, Loop: true}}, Bindings: app.SpriteBindings{Idle: "idle"}}
	manifest, _ := json.Marshal(map[string]any{"spritesheetPath": "atlas.png", "yinghui": p})
	var atlas, archive bytes.Buffer
	if err = png.Encode(&atlas, image.NewNRGBA(image.Rect(0, 0, 32, 16))); err != nil {
		t.Fatal(err)
	}
	z := zip.NewWriter(&archive)
	for name, data := range map[string][]byte{"pet.json": manifest, "atlas.png": atlas.Bytes()} {
		f, e := z.Create(name)
		if e != nil {
			t.Fatal(e)
		}
		if _, e = f.Write(data); e != nil {
			t.Fatal(e)
		}
	}
	if err = z.Close(); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, "resources", "pet.zip"), archive.Bytes(), 0640); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "sprite-fixture", UserID: "admin", Kind: "sprite", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "pet.zip", MimeType: "application/zip", Size: int64(archive.Len())}
	if err = db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	setting, err := svc.AdminAppearance(admin)
	if err != nil {
		t.Fatal(err)
	}
	setting.Canvas.AvatarType = "sprite"
	setting.Canvas.SpriteResourceID = resource.ID
	setting.Canvas.Sprite = p
	if _, err = svc.UpdateAppearance(admin, setting.AppearanceSetting); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterAppearanceRoutes(router.Group("/api"), svc)
	for _, suffix := range []string{"", "/thumbnail?w=16&h=16&frame=0&v=1"} {
		url := "/api/public/appearance/sprite/" + resource.ID + suffix
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("GET", url, nil))
		etag := rec.Header().Get("ETag")
		if rec.Code != 200 || etag == "" || rec.Header().Get("Cache-Control") != "private, no-cache" {
			t.Fatalf("cache headers: %d %v", rec.Code, rec.Header())
		}
		req := httptest.NewRequest("GET", url, nil)
		req.Header.Set("If-None-Match", "\"other\", W/"+etag)
		conditional := httptest.NewRecorder()
		router.ServeHTTP(conditional, req)
		if conditional.Code != 304 || conditional.Body.Len() != 0 {
			t.Fatalf("conditional: %d", conditional.Code)
		}
	}
	setting.Canvas.AvatarType = "orb"
	if _, err = svc.UpdateAppearance(admin, setting.AppearanceSetting); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest("GET", "/api/public/appearance/sprite/"+resource.ID+"/thumbnail?w=16&h=16&frame=0", nil)
	req.Header.Set("If-None-Match", "*")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code == 200 || rec.Code == 304 {
		t.Fatal("conditional request bypassed unpublish")
	}
}

func TestAppearanceRoutesAreRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterAppearanceRoutes(router.Group("/api"), &service.Service{})
	wanted := map[string]bool{
		"GET /api/public/appearance/updates/:id":                  false,
		"GET /api/admin/settings/appearance/updates/:id":          false,
		"POST /api/admin/settings/appearance/live2d":              false,
		"GET /api/admin/settings/appearance/live2d/:id/*file":     false,
		"GET /api/public/appearance/live2d/:id/*file":             false,
		"POST /api/admin/settings/appearance/avatar-bundles":      false,
		"GET /api/admin/settings/appearance/avatar/:id/*file":     false,
		"GET /api/public/appearance/avatar/:id/*file":             false,
		"GET /api/public/appearance":                              false,
		"GET /api/public/appearance/assets/:slot":                 false,
		"GET /api/admin/settings/appearance":                      false,
		"PATCH /api/admin/settings/appearance":                    false,
		"DELETE /api/admin/settings/appearance":                   false,
		"POST /api/admin/settings/appearance/assets/:slot":        false,
		"GET /api/public/appearance/sprite/:id/thumbnail":         false,
		"GET /api/admin/settings/appearance/sprite/:id/thumbnail": false,
		"POST /api/admin/settings/appearance/sprite":              false,
		"GET /api/admin/settings/appearance/sprite/:id":           false,
		"GET /api/public/appearance/sprite/:id":                   false,
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
