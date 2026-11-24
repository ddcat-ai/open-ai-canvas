package handler

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestCreationHistoryHTTPAccountsAndExpectedUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"device-owner", "other-owner"} {
		if err := db.Create(&model.User{ID: id, Username: id, Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("temporary-test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	RegisterCreationRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	call := func(user, expected, method, path, body string, status int) map[string]any {
		t.Helper()
		req := httptest.NewRequest(method, "/api/creation-conversations"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if user != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: user + ".temporary-test-token"})
		}
		if expected != "" {
			req.Header.Set("X-Canvas-Expected-User", expected)
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		if out.Code != status {
			t.Fatalf("HTTP %s: got %d, want %d", method, out.Code, status)
		}
		var envelope map[string]any
		if err := json.Unmarshal(out.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if status != 200 {
			if envelope["code"] == float64(0) {
				t.Fatal("failure returned success envelope")
			}
			return envelope
		}
		return envelope["data"].(map[string]any)
	}
	call("", "", "GET", "", "", 401)
	call("device-owner", "other-owner", "POST", "/temp/sync", `{"delete":true}`, 403)
	body := `{"metadata":{"revision":0,"title":"temporary history"},"messages":[{"id":"message-a","revision":0,"data":{"id":"message-a","role":"user","content":"synthetic test content","createdAt":"2026-10-24T01:00:00Z"}}]}`
	first := call("device-owner", "device-owner", "POST", "/temp/sync", body, 200)
	retry := call("device-owner", "device-owner", "POST", "/temp/sync", body, 200)
	if first["revision"] != retry["revision"] {
		t.Fatal("HTTP retry changed revision")
	}
	call("other-owner", "other-owner", "GET", "/temp", "", 404)
	list := call("other-owner", "other-owner", "GET", "", "", 200)
	if len(list["items"].([]any)) != 0 {
		t.Fatal("HTTP list leaked another user")
	}
	call("device-owner", "device-owner", "POST", "/temp/sync", `{"delete":true}`, 200)
	deleted := call("device-owner", "device-owner", "POST", "/temp/sync", body, 200)
	if deleted["deleted"] != true || len(deleted["messages"].([]any)) != 0 {
		t.Fatal("HTTP old client revived deleted conversation")
	}
}
