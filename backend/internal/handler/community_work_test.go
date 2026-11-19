package handler

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

type communityHTTPFixture struct {
	router *gin.Engine
	svc    *service.Service
	db     *gorm.DB
	input  service.CommunityWorkInput
	cookie map[string]string
}

func newCommunityHTTPFixture(t *testing.T) *communityHTTPFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := database.Open(database.Config{Driver: "sqlite", DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.ConfigurePool(db); err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	previousRuntime := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previousRuntime); _ = svc.Close(); sqlDB, _ := db.DB(); _ = sqlDB.Close() })
	f := &communityHTTPFixture{svc: svc, db: db, cookie: map[string]string{}}
	for _, role := range []string{"author", "admin", "viewer"} {
		userRole := model.UserRoleUser
		if role == "admin" {
			userRole = model.UserRoleAdmin
		}
		id := "community-" + role
		if err := db.Create(&model.User{ID: id, Username: id, DisplayName: role, Status: model.UserStatusActive, Role: userRole}).Error; err != nil {
			t.Fatal(err)
		}
		sessionID := "fixture-" + role
		if err := db.Create(&model.AuthSession{ID: sessionID, UserID: id, TokenHash: auth.HashToken("local-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
		f.cookie[role] = sessionID + ".local-token"
	}
	pic := image.NewRGBA(image.Rect(0, 0, 320, 180))
	for y := 0; y < 180; y++ {
		for x := 0; x < 320; x++ {
			pic.SetRGBA(x, y, color.RGBA{R: uint8(20 + x/3), G: uint8(100 + y/3), B: 220, A: 255})
		}
	}
	var picture bytes.Buffer
	if err := png.Encode(&picture, pic); err != nil {
		t.Fatal(err)
	}
	cover, err := svc.UploadResourceFile("community-author", "fixture-cover.png", int64(picture.Len()), "image", 320, 180, 0, bytes.NewReader(picture.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	media := &model.Resource{ID: "fixture-video", UserID: "community-author", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "fixture-video.mp4", MimeType: "video/mp4", Size: 10, Width: 320, Height: 180, DurationMs: 2000}
	videoBytes := []byte("video-data")
	if err := os.WriteFile(filepath.Join(dir, "resources", media.ObjectKey), videoBytes, 0600); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(media).Error; err != nil {
		t.Fatal(err)
	}
	asset, _ := json.Marshal(map[string]any{"id": "fixture-asset", "kind": "image", "title": "本地验收画面", "coverUrl": assets.FileURL(cover.ID), "tags": []string{}, "data": map[string]any{"storageKey": "resource:" + cover.ID, "width": 320, "height": 180, "bytes": cover.Size, "mimeType": "image/png"}})
	if _, err := svc.UpsertUserAsset("community-author", asset); err != nil {
		t.Fatal(err)
	}
	project, _ := json.Marshal(map[string]any{"id": "fixture-canvas", "title": "本地投稿验收", "revision": 0, "nodes": []any{
		map[string]any{"id": "prompt", "type": "text", "title": "制作提示", "position": map[string]any{"x": 0, "y": 40}, "width": 380, "height": 220, "metadata": map[string]any{"content": "本地验收夹具：冰蓝色光影，镜头平稳移动"}},
		map[string]any{"id": "image", "type": "image", "title": "制作画面", "position": map[string]any{"x": 540, "y": 0}, "width": 480, "height": 270, "metadata": map[string]any{"content": assets.FileURL(cover.ID), "storageKey": "resource:" + cover.ID, "assetId": "fixture-asset"}},
	}, "connections": []any{map[string]any{"id": "edge", "fromNodeId": "prompt", "toNodeId": "image"}}, "chatSessions": []any{}, "previsScenes": []any{}, "viewport": map[string]any{"x": 0, "y": 0, "k": 1}})
	if _, err := svc.UpsertUserCanvasProject("community-author", project); err != nil {
		t.Fatal(err)
	}
	f.input = service.CommunityWorkInput{Title: "本地投稿验收", Description: "隔离验收夹具", Category: "creative", Tags: []string{"验收"}, MediaResourceID: media.ID, CoverResourceID: cover.ID, ProjectID: "fixture-canvas", RightsConfirmed: true}
	f.router = gin.New()
	f.router.Use(gin.Recovery())
	RegisterCanvasAPI(f.router.Group("/api"), svc)
	return f
}

func (f *communityHTTPFixture) request(t *testing.T, method, path string, body any, role string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var data []byte
	if body != nil {
		var err error
		data, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if role != "" {
		req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: f.cookie[role]})
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, req)
	return rec
}

func communityHTTPData(t *testing.T, rec *httptest.ResponseRecorder, want int, target any) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("HTTP %d, wanted %d: %s", rec.Code, want, rec.Body.String())
	}
	var envelope struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if (envelope.Code == 0) != (want < 400) {
		t.Fatalf("incorrect business status: %s", rec.Body.String())
	}
	if target != nil {
		if err := json.Unmarshal(envelope.Data, target); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCommunityWorkHTTPSubmissionReviewRangeCopyAndWithdrawal(t *testing.T) {
	f := newCommunityHTTPFixture(t)
	communityHTTPData(t, f.request(t, "POST", "/api/works", f.input, "", nil), 401, nil)
	var work service.CommunityWorkView
	communityHTTPData(t, f.request(t, "POST", "/api/works", f.input, "author", nil), 200, &work)
	communityHTTPData(t, f.request(t, "GET", "/api/public/works/"+work.ID, nil, "", nil), 404, nil)
	communityHTTPData(t, f.request(t, "GET", "/api/works/"+work.ID, nil, "viewer", nil), 404, nil)
	communityHTTPData(t, f.request(t, "GET", "/api/public/works/"+work.ID+"/project", nil, "", nil), 404, nil)
	communityHTTPData(t, f.request(t, "PATCH", "/api/admin/works/"+work.ID+"/review", service.CommunityWorkReviewInput{Action: "approve"}, "viewer", nil), 403, nil)
	communityHTTPData(t, f.request(t, "PATCH", "/api/admin/works/"+work.ID+"/review", service.CommunityWorkReviewInput{Action: "approve"}, "admin", nil), 200, &work)
	communityHTTPData(t, f.request(t, "PATCH", "/api/admin/works/"+work.ID+"/review", service.CommunityWorkReviewInput{Action: "feature"}, "admin", nil), 200, &work)
	var listed struct{ Items []service.CommunityWorkView }
	communityHTTPData(t, f.request(t, "GET", "/api/public/works?featured=true", nil, "", nil), 200, &listed)
	if len(listed.Items) != 1 || listed.Items[0].ID != work.ID {
		t.Fatalf("featured list missing reviewed work: %#v", listed)
	}
	likePath := "/api/works/" + work.ID + "/like"
	communityHTTPData(t, f.request(t, "PUT", likePath, nil, "", nil), 401, nil)
	communityHTTPData(t, f.request(t, "PUT", likePath, nil, "viewer", nil), 200, nil)
	communityHTTPData(t, f.request(t, "PUT", likePath, nil, "viewer", nil), 200, nil)
	var reaction struct {
		Count int64
		Liked bool
	}
	communityHTTPData(t, f.request(t, "GET", "/api/public/works/"+work.ID+"/reaction", nil, "", nil), 200, &reaction)
	if reaction.Count != 1 || reaction.Liked {
		t.Fatalf("anonymous reaction should expose only the count: %+v", reaction)
	}
	communityHTTPData(t, f.request(t, "GET", "/api/works/"+work.ID+"/reaction", nil, "viewer", nil), 200, &reaction)
	if reaction.Count != 1 || !reaction.Liked {
		t.Fatalf("viewer's like is missing: %+v", reaction)
	}
	communityHTTPData(t, f.request(t, "DELETE", likePath, nil, "viewer", nil), 200, &reaction)
	if reaction.Count != 0 || reaction.Liked {
		t.Fatalf("like wasn't removed: %+v", reaction)
	}
	partial := f.request(t, "GET", "/api/public/works/"+work.ID+"/resources/fixture-video/file", nil, "", map[string]string{"Range": "bytes=0-3"})
	if partial.Code != http.StatusPartialContent || partial.Body.String() != "vide" || partial.Header().Get("Content-Range") != "bytes 0-3/10" || partial.Header().Get("Content-Security-Policy") != "sandbox" {
		t.Fatalf("real Range response: %d %s %v", partial.Code, partial.Body.String(), partial.Header())
	}
	foreign := model.Resource{ID: "not-submitted", UserID: "community-author", Kind: "image", Status: model.ResourceStatusReady, Size: 1}
	if err := f.db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	communityHTTPData(t, f.request(t, "GET", "/api/public/works/"+work.ID+"/resources/not-submitted/file", nil, "", nil), 404, nil)
	var copied service.CommunityWorkProject
	communityHTTPData(t, f.request(t, "POST", "/api/public/works/"+work.ID+"/copy", nil, "", nil), 401, nil)
	communityHTTPData(t, f.request(t, "POST", "/api/public/works/"+work.ID+"/copy", nil, "viewer", nil), 200, &copied)
	if copied.Project["id"] == "fixture-canvas" || len(copied.Project["nodes"].([]any)) != 2 {
		t.Fatal("copy did not produce an editable project")
	}
	policy, err := f.svc.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	if err := f.db.Create(&model.Resource{ID: "over-limit-fixture", UserID: "community-author", Provider: "local", ObjectKey: "over-limit", Status: model.ResourceStatusReady, Size: int64(policy.Resource.StoredFileGB)*(1<<30) + 1}).Error; err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-8 * 24 * time.Hour)
	if err := f.db.Create(&model.UserStorageState{UserID: "community-author", OverLimitSince: &old}).Error; err != nil {
		t.Fatal(err)
	}
	if usage, err := f.svc.AccountFileStorageUsage("community-author"); err != nil || !usage.ReadOnly {
		t.Fatalf("failed to enter storage read-only fixture: %+v %v", usage, err)
	}
	communityHTTPData(t, f.request(t, "PUT", "/api/works/"+work.ID, f.input, "author", nil), 403, nil)
	communityHTTPData(t, f.request(t, "POST", "/api/works/"+work.ID+"/withdraw", nil, "author", nil), 200, nil)
	for _, path := range []string{"/api/public/works/" + work.ID, "/api/public/works/" + work.ID + "/project", "/api/public/works/" + work.ID + "/resources/fixture-video/file"} {
		communityHTTPData(t, f.request(t, "GET", path, nil, "", nil), 404, nil)
	}
	communityHTTPData(t, f.request(t, "POST", "/api/public/works/"+work.ID+"/copy", nil, "viewer", nil), 404, nil)
}

func TestCommunityWorkHTTPFiltersAndBodyValidation(t *testing.T) {
	f := newCommunityHTTPFixture(t)
	for _, path := range []string{"/api/works?page=0", "/api/works?page=bad", "/api/works?pageSize=101", "/api/works?status=unknown", "/api/admin/works?page=-1"} {
		communityHTTPData(t, f.request(t, "GET", path, nil, "admin", nil), 400, nil)
	}
	communityHTTPData(t, f.request(t, "GET", "/api/public/works?featured=bad", nil, "", nil), 400, nil)
	invalid := f.input
	invalid.RightsConfirmed = false
	communityHTTPData(t, f.request(t, "POST", "/api/works", invalid, "author", nil), 400, nil)
	var page service.CommunityWorkPage
	communityHTTPData(t, f.request(t, "GET", "/api/works", nil, "author", nil), 200, &page)
	if page.Page != 1 || page.PageSize != 24 || page.Total != 0 || page.Items == nil {
		t.Fatalf("empty author page contract: %#v", page)
	}
}
