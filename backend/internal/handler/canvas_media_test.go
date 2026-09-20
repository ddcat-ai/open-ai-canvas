package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCanvasMediaHTTPReadRangePlaybackAndRevocation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "media.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := db.DB()
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = conn.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	svc := service.New(repository.New(db), dataDir)
	for _, id := range []string{"owner", "editor", "viewer", "stranger"} {
		if err := db.Create(&model.User{ID: id, Username: id, Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("media-test"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	nodes := []any{}
	for _, kind := range []string{"image", "video", "audio", "private"} {
		key := "users/owner/" + kind
		path := filepath.Join(dataDir, "resources", key)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("0123456789"), 0600); err != nil {
			t.Fatal(err)
		}
		resource := model.Resource{ID: kind, UserID: "owner", Kind: kind, Provider: "local", ObjectKey: key, MimeType: kind + "/test", Status: model.ResourceStatusReady, Size: 10}
		if kind == "video" {
			resource.PlaybackObjectKey = "video-playback"
			resource.PlaybackStatus = model.PlaybackStatusReady
			if err := os.MkdirAll(filepath.Join(dataDir, "playback"), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dataDir, "playback", resource.PlaybackObjectKey), []byte("abcdefghij"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
		payload := fmt.Sprintf(`{"id":"asset-%s","kind":%q,"data":{"storageKey":"resource:%s"}}`, kind, kind, kind)
		if err := db.Create(&model.Asset{ID: "asset-" + kind, UserID: "owner", Kind: kind, PayloadJSON: payload}).Error; err != nil {
			t.Fatal(err)
		}
		if kind != "private" {
			nodes = append(nodes, map[string]any{"id": kind, "type": kind, "metadata": map[string]any{"assetId": "asset-" + kind, "storageKey": "resource:" + kind}})
		}
	}
	raw, _ := json.Marshal(map[string]any{"id": "shared", "nodes": nodes, "connections": []any{}})
	if err := db.Create(&model.CanvasProject{ID: "shared", UserID: "owner", Revision: 1, PayloadJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	owner := &model.User{ID: "owner"}
	for _, role := range []string{"editor", "viewer"} {
		if _, err := svc.CanvasCollaboration().EnableCanvasCollaboration(owner, "shared", role, role); err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	RegisterUserDataRoutes(router.Group("/api"), svc)
	call := func(user, path, rangeHeader, etag string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", path, nil)
		if user != "" {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: user + ".media-test"})
		}
		r.Header.Set("Range", rangeHeader)
		r.Header.Set("If-None-Match", etag)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	for _, member := range []string{"editor", "viewer"} {
		for _, kind := range []string{"image", "video", "audio"} {
			w := call(member, "/api/resources/"+kind+"/file?direct=1", "", "")
			if w.Code != 200 || w.Body.String() != "0123456789" || w.Header().Get("Cache-Control") != "private, no-store" || w.Header().Get("Location") != "" {
				t.Fatalf("%s/%s: %d %s %v", member, kind, w.Code, w.Body.String(), w.Header())
			}
			w = call(member, "/api/resources/"+kind+"/file", "bytes=2-5", "")
			if w.Code != 206 || w.Body.String() != "2345" || w.Header().Get("Content-Range") != "bytes 2-5/10" {
				t.Fatalf("range: %d %s %v", w.Code, w.Body.String(), w.Header())
			}
		}
		w := call(member, "/api/resources/video/file?variant=playback", "bytes=1-3", "")
		if w.Code != 206 || w.Body.String() != "bcd" {
			t.Fatalf("playback: %d %s", w.Code, w.Body.String())
		}
		w = call(member, "/api/resources/video", "", "")
		if w.Code != 200 || strings.Contains(w.Body.String(), "users/owner") {
			t.Fatalf("metadata leaked storage: %d %s", w.Code, w.Body.String())
		}
		if w := call(member, "/api/resources/private/file", "", ""); w.Code != 404 {
			t.Fatalf("unshared private = %d", w.Code)
		}
		if w := call(member, "/api/resources/image/oss-url", "", ""); w.Code != 404 {
			t.Fatalf("direct signing = %d", w.Code)
		}
	}
	if w := call("stranger", "/api/resources/image/file", "", ""); w.Code != 404 {
		t.Fatalf("stranger = %d", w.Code)
	}
	if w := call("", "/api/resources/image/file", "", ""); w.Code != 401 {
		t.Fatalf("anonymous = %d", w.Code)
	}
	etag := call("viewer", "/api/resources/image/file", "", "").Header().Get("ETag")
	if err := svc.CanvasCollaboration().RemoveCanvasCollaborator(owner, "shared", "viewer"); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/resources/image/file", "/api/resources/video/file?variant=playback", "/api/resources/video"} {
		if w := call("viewer", path, "", etag); w.Code != 404 {
			t.Fatalf("revoked request %s = %d %s", path, w.Code, w.Body.String())
		}
	}
	if err := svc.DeleteUserCanvasProject("editor", "shared"); err == nil {
		t.Fatal("editor deleted shared canvas")
	}
	if w := call("editor", "/api/resources/image/file", "", ""); w.Code != 200 {
		t.Fatalf("rejected deletion changed grants: %d", w.Code)
	}
	if err := svc.DeleteUserCanvasProject("owner", "shared"); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "shared", UserID: "owner", Revision: 1, PayloadJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	if w := call("editor", "/api/resources/image/file", "", ""); w.Code != 404 {
		t.Fatalf("recreated canvas retained permission: %d", w.Code)
	}
	var remaining int64
	for _, record := range []any{&model.CanvasMediaGrant{}, &model.CanvasCollaborator{}, &model.CanvasCollaborationNode{}, &model.CanvasCollaborationOperation{}} {
		if err := db.Model(record).Where("canvas_id = ?", "shared").Count(&remaining).Error; err != nil || remaining != 0 {
			t.Fatalf("orphan %T: %d %v", record, remaining, err)
		}
	}
}
