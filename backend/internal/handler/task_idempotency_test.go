package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func taskIdempotencyHTTPFixture(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
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
	for _, row := range []any{
		&model.User{ID: "lookup-user", Username: "lookup-user", Email: "lookup@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.User{ID: "other-user", Username: "other-user", Email: "other@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "lookup-session", UserID: "lookup-user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	RegisterTaskRoutes(router.Group("/api"), svc)
	return router, db
}

func TestTaskIdempotencyLookupAuthenticationOwnershipAndRedaction(t *testing.T) {
	router, db := taskIdempotencyHTTPFixture(t)
	shared, foreign := "shared-key", "foreign-only"
	for _, row := range []model.Task{
		{ID: "own-task", UserID: "lookup-user", Status: model.TaskStatusRunning, IdempotencyKey: &shared, InputJSON: `{"mode":"video","config":{"apiKey":"test-secret-never-return"}}`},
		{ID: "other-task", UserID: "other-user", Status: model.TaskStatusSucceeded, IdempotencyKey: &shared},
		{ID: "foreign-task", UserID: "other-user", Status: model.TaskStatusRunning, IdempotencyKey: &foreign},
	} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		name, key, taskID string
		auth              bool
		status            int
	}{
		{name: "login required", key: shared, status: http.StatusUnauthorized},
		{name: "own scope", key: shared, taskID: "own-task", auth: true, status: http.StatusOK},
		{name: "trimmed key", key: " shared-key ", taskID: "own-task", auth: true, status: http.StatusOK},
		{name: "foreign key", key: foreign, auth: true, status: http.StatusOK},
		{name: "missing key", key: "unknown", auth: true, status: http.StatusOK},
		{name: "empty key", auth: true, status: http.StatusBadRequest},
		{name: "blank key", key: "  ", auth: true, status: http.StatusBadRequest},
		{name: "invalid key", key: "key\x01", auth: true, status: http.StatusBadRequest},
		{name: "long key", key: strings.Repeat("k", 161), auth: true, status: http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/tasks/by-idempotency-key?key="+url.QueryEscape(tc.key), nil)
			if tc.auth {
				req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "lookup-session.test-token"})
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status = %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "test-secret-never-return") {
				t.Fatal("task lookup exposed provider credentials")
			}
			if tc.status == http.StatusOK {
				var body struct {
					Data *model.Task `json:"data"`
				}
				if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
					t.Fatal(err)
				}
				if tc.taskID == "" {
					if body.Data != nil || !strings.Contains(w.Body.String(), `"data":null`) {
						t.Fatalf("unknown key must return explicit null: %s", w.Body.String())
					}
				} else if body.Data == nil || body.Data.ID != tc.taskID || body.Data.Status != model.TaskStatusRunning {
					t.Fatalf("lookup returned wrong task: %+v", body.Data)
				}
			}
		})
	}
}
