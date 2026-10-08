package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestChunkAdmissionReservesBeforeBody(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.Resource{}, &model.UploadReservation{}, &model.UserDailyUploadUsage{}, &model.StorageLocation{}, &model.UserOSSSetting{}, &model.UserDailyActivity{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "chunk-user", Username: "chunk-user", Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "chunk-session", UserID: "chunk-user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	policy := platform.DefaultRuntimePolicy()
	policy.Resource.ResourceUploadMB = 1
	data, _ := json.Marshal(policy)
	if err := db.Create(&model.SystemSetting{Key: "runtime_policy", ValueJSON: string(data)}).Error; err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	svc := service.New(repo, t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { runtimeService = previous })
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterChunkedUploadRoutes(router.Group("/api"), svc)
	call := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "chunk-session.test-token"})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	w := call("POST", "/api/resources/uploads", `{"fileName":"large.txt","size":1048576}`)
	if w.Code != 400 {
		t.Fatalf("oversize admission status=%d body=%s", w.Code, w.Body.String())
	}
	w = call("POST", "/api/resources/uploads", `{"fileName":"test.txt","size":7}`)
	if w.Code != 200 {
		t.Fatalf("admission status=%d body=%s", w.Code, w.Body.String())
	}
	var response struct {
		Data struct {
			UploadID string `json:"uploadId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	id := response.Data.UploadID
	t.Cleanup(func() {
		if sess := takeChunkSession(id); sess != nil {
			sess.mu.Lock()
			dropChunkSession(id)
			sess.mu.Unlock()
		}
	})
	if used, _ := repo.DailyUploadBytes("chunk-user", time.Now().UTC().Format("2006-01-02")); used != 7 {
		t.Fatalf("before first chunk daily bytes=%d want 7", used)
	}
	var count int64
	if err := db.Model(&model.UploadReservation{}).Where("id = ?", id).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("admission reservation count=%d err=%v", count, err)
	}
	w = call("PUT", fmt.Sprintf("/api/resources/uploads/%s/chunks/0", id), "payload")
	if w.Code != 200 {
		t.Fatalf("chunk status=%d body=%s", w.Code, w.Body.String())
	}
	w = call("POST", fmt.Sprintf("/api/resources/uploads/%s/complete", id), "")
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"resource"`)) {
		t.Fatalf("complete status=%d body=%s", w.Code, w.Body.String())
	}
	if err := db.Model(&model.UploadReservation{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("remaining reservations=%d err=%v", count, err)
	}
	w = call("POST", fmt.Sprintf("/api/resources/uploads/%s/complete", id), "")
	if w.Code != 404 {
		t.Fatalf("duplicate completion status=%d", w.Code)
	}
}
