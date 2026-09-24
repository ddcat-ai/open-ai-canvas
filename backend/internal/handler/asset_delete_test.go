package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
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

func TestAssetBatchDeleteHTTP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{
		&model.User{ID: "batch-user", Username: "batch-user", Email: "batch@example.invalid", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "batch-session", UserID: "batch-user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.Asset{ID: "foreign", UserID: "other-user", PayloadJSON: `{}`},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	ids := make([]string, 100)
	for i := range ids {
		ids[i] = fmt.Sprintf("batch-%03d", i)
		if err := db.Create(&model.Asset{ID: ids[i], UserID: "batch-user", Status: model.AssetVersionStatusConfirmed, PayloadJSON: `{}`}).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	RegisterUserDataRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	call := func(method, path, body string, authenticated bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
		if authenticated {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "batch-session.test-token"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
	assertAssets := func(want int64) {
		t.Helper()
		var count int64
		if err := db.Model(&model.Asset{}).Count(&count).Error; err != nil || count != want {
			t.Fatalf("asset count=%d want=%d err=%v", count, want, err)
		}
	}
	path := "/api/assets/batch-delete"
	if w := call(http.MethodPost, path, `["batch-000"]`, false); w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated: %d %s", w.Code, w.Body.String())
	}
	for _, body := range []string{`[]`, `null`, `{ "ids": ["batch-000"] }`, `["batch-000", ""]`, `[1]`} {
		if w := call(http.MethodPost, path, body, true); w.Code != http.StatusBadRequest {
			t.Fatalf("invalid body %s: %d %s", body, w.Code, w.Body.String())
		}
		assertAssets(101)
	}
	for _, badID := range []string{"foreign", "missing"} {
		w := call(http.MethodPost, path, `["batch-000","`+badID+`"]`, true)
		if w.Code != http.StatusNotFound {
			t.Fatalf("ownership/missing %s: %d %s", badID, w.Code, w.Body.String())
		}
		assertAssets(101)
	}
	body, _ := json.Marshal(ids)
	if err := db.Exec("CREATE TRIGGER fail_batch_delete BEFORE DELETE ON assets WHEN OLD.id = 'batch-099' BEGIN SELECT RAISE(ABORT, 'forced failure'); END;").Error; err != nil {
		t.Fatal(err)
	}
	if w := call(http.MethodPost, path, string(body), true); w.Code != http.StatusInternalServerError {
		t.Fatalf("database failure: %d %s", w.Code, w.Body.String())
	}
	assertAssets(101)
	if err := db.Exec("DROP TRIGGER fail_batch_delete").Error; err != nil {
		t.Fatal(err)
	}
	w := call(http.MethodPost, path, string(body), true)
	var response struct {
		Code int `json:"code"`
		Data struct {
			IDs []string `json:"ids"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || w.Code != http.StatusOK || response.Code != 0 || len(response.Data.IDs) != 100 {
		t.Fatalf("batch response: %d %s err=%v", w.Code, w.Body.String(), err)
	}
	assertAssets(1)

	// The DELETE endpoint protects referenced assets just like batch deletion.
	resource := model.Resource{ID: "single-resource", UserID: "batch-user", Provider: "unsupported-test-provider", ObjectKey: "single.png"}
	payload := `{"url":"/api/resources/single-resource/file"}`
	for _, record := range []any{
		&resource,
		&model.Asset{ID: "single", UserID: "batch-user", Status: model.AssetVersionStatusConfirmed, PayloadJSON: payload},
		&model.Task{ID: "running-task", UserID: "batch-user", Status: model.TaskStatusRunning, InputJSON: payload},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	if w := call(http.MethodDelete, "/api/assets/single", "", true); w.Code != http.StatusBadRequest {
		t.Fatalf("single referenced delete: %d %s", w.Code, w.Body.String())
	}
	assertAssets(2)
}
