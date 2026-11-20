package handler

import (
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func newGitHubSkillHTTPTest(t *testing.T) (*gin.Engine, *gorm.DB, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "test.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.UserIdentity{}, &model.AuthSession{}, &model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "github-owner", Username: "github-owner", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "github-session", UserID: "github-owner", TokenHash: auth.HashToken("github-test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	t.Cleanup(func() { _ = svc.Close() })
	router := gin.New()
	RegisterSkillRoutes(router.Group("/api"), svc)
	return router, db, dir
}

func githubSkillHTTPRequest(t *testing.T, router *gin.Engine, method, target, body string, authenticated bool, status int) []byte {
	t.Helper()
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if authenticated {
		req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "github-session.github-test-token"})
	}
	out := httptest.NewRecorder()
	router.ServeHTTP(out, req)
	if out.Code != status {
		t.Fatalf("%s %s: status %d, want %d: %s", method, target, out.Code, status, out.Body.String())
	}
	return out.Body.Bytes()
}
