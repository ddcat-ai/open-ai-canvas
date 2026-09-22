package handler

import (
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestTaskMediaRecoveryHTTPAuthenticationAndOwnership(t *testing.T) {
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
	for _, item := range []any{
		&model.User{ID: "media-user", Username: "media-user", Email: "media@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "media-session", UserID: "media-user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.Task{ID: "legacy-task", UserID: "media-user", Status: model.TaskStatusFailed},
		&model.Task{ID: "foreign-task", UserID: "other-user", Status: model.TaskStatusFailed},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	RegisterTaskRoutes(router.Group("/api"), svc)
	for _, tc := range []struct {
		id   string
		auth bool
		want int
	}{
		{"legacy-task", false, http.StatusUnauthorized},
		{"legacy-task", true, http.StatusBadRequest},
		{"foreign-task", true, http.StatusNotFound},
		{"missing-task", true, http.StatusNotFound},
	} {
		r := httptest.NewRequest(http.MethodPost, "/api/tasks/"+tc.id+"/recover-media", nil)
		if tc.auth {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "media-session.test-token"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("%s auth=%v: %d %s", tc.id, tc.auth, w.Code, w.Body.String())
		}
	}
}
