package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func nodeToolbarHTTPTest(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "toolbar.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"toolbar-a", "toolbar-b"} {
		if err := db.Create(&model.User{ID: id, Username: id, Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("toolbar-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	previousRuntime := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previousRuntime) })
	t.Cleanup(func() { _ = svc.Close() })
	router := gin.New()
	RegisterUserDataRoutes(router.Group("/api"), svc)
	return router
}

func toolbarRequest(t *testing.T, router *gin.Engine, user, method, target, body string, wantStatus int) map[string]json.RawMessage {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if user != "" {
		req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: user + ".toolbar-token"})
	}
	out := httptest.NewRecorder()
	router.ServeHTTP(out, req)
	if out.Code != wantStatus {
		t.Fatalf("%s %s: got %d, want %d: %s", method, target, out.Code, wantStatus, out.Body.String())
	}
	if wantStatus != http.StatusOK {
		return nil
	}
	var envelope struct {
		Code int                        `json:"code"`
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(out.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Code != 0 {
		t.Fatalf("business failure: %s", out.Body.String())
	}
	return envelope.Data
}

func TestNodeToolbarPreferencesAccountPersistence(t *testing.T) {
	router := nodeToolbarHTTPTest(t)
	const base = "/api/settings/node-toolbar"
	toolbarRequest(t, router, "", "GET", base, "", http.StatusUnauthorized)
	toolbarRequest(t, router, "toolbar-a", "PUT", base+"/image", `{"pinnedEntryIds":["upscale","menu:process"]}`, http.StatusOK)
	read := func(user string) map[string][]string {
		data := toolbarRequest(t, router, user, "GET", base, "", http.StatusOK)
		var prefs map[string][]string
		if err := json.Unmarshal(data["preferences"], &prefs); err != nil {
			t.Fatal(err)
		}
		return prefs
	}
	if got := read("toolbar-a")["image"]; len(got) != 2 || got[0] != "upscale" || got[1] != "menu:process" {
		t.Fatalf("saved order lost: %#v", got)
	}
	if got := read("toolbar-b"); len(got) != 0 {
		t.Fatalf("preferences crossed accounts: %#v", got)
	}
}

func TestNodeToolbarPreferencesEmptyResetAndValidation(t *testing.T) {
	router := nodeToolbarHTTPTest(t)
	const base = "/api/settings/node-toolbar"
	toolbarRequest(t, router, "", "PUT", base+"/image", `{"pinnedEntryIds":[]}`, http.StatusUnauthorized)
	toolbarRequest(t, router, "toolbar-a", "PUT", base+"/image", `{"pinnedEntryIds":[]}`, http.StatusOK)
	toolbarRequest(t, router, "toolbar-a", "PUT", base+"/audio", `{"pinnedEntryIds":["download"]}`, http.StatusOK)
	read := func() map[string][]string {
		data := toolbarRequest(t, router, "toolbar-a", "GET", base, "", http.StatusOK)
		var preferences map[string][]string
		if err := json.Unmarshal(data["preferences"], &preferences); err != nil {
			t.Fatal(err)
		}
		return preferences
	}
	if entries, exists := read()["image"]; !exists || entries == nil || len(entries) != 0 {
		t.Fatalf("empty configuration was replaced with defaults: %#v", entries)
	}
	for _, body := range []string{`{}`, `{"pinnedEntryIds":null}`, `{"pinnedEntryIds":["download","download"]}`, `{"pinnedEntryIds":["../image"]}`} {
		toolbarRequest(t, router, "toolbar-a", "PUT", base+"/image", body, http.StatusBadRequest)
	}
	toolbarRequest(t, router, "toolbar-a", "PUT", base+"/frame", `{"pinnedEntryIds":[]}`, http.StatusBadRequest)
	toolbarRequest(t, router, "toolbar-a", "DELETE", base+"/image", "", http.StatusOK)
	preferences := read()
	if _, exists := preferences["image"]; exists {
		t.Fatal("reset did not restore default state")
	}
	if entries := preferences["audio"]; len(entries) != 1 || entries[0] != "download" {
		t.Fatalf("reset crossed node types: %#v", preferences)
	}
}

func TestNodeToolbarPreferencesWriteRateLimitIsAccountScoped(t *testing.T) {
	router := nodeToolbarHTTPTest(t)
	policy, err := runtimeService.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < policy.Request.CanvasWritePerMinute; i++ {
		if allowed, err := runtimeService.AllowRequest(context.Background(), "node-toolbar-write:toolbar-a", policy.Request.CanvasWritePerMinute, time.Minute); err != nil || !allowed {
			t.Fatalf("consume write limit: allowed=%v, err=%v", allowed, err)
		}
	}
	const base = "/api/settings/node-toolbar"
	toolbarRequest(t, router, "toolbar-a", "PUT", base+"/image", `{"pinnedEntryIds":[]}`, http.StatusTooManyRequests)
	toolbarRequest(t, router, "toolbar-a", "DELETE", base+"/image", "", http.StatusTooManyRequests)
	toolbarRequest(t, router, "toolbar-a", "GET", base, "", http.StatusOK)
	toolbarRequest(t, router, "toolbar-b", "PUT", base+"/image", `{"pinnedEntryIds":[]}`, http.StatusOK)
}
