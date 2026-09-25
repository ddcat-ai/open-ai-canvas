package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPluginUploadSwitchRejectsRawAndMultipartInstall(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}, &model.PluginPlatformState{}, &model.UserPluginState{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "admin", Username: "admin", Email: "admin@example.invalid", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "admin", UserID: "admin", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	RegisterPluginRoutes(router.Group("/api"), svc)
	setUpload := func(enabled bool) {
		payload, _ := json.Marshal(map[string]bool{"pluginUploadEnabled": enabled})
		if err := db.Save(&model.SystemSetting{Key: "feature_availability", ValueJSON: string(payload)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	upload := func(multipartBody bool) *httptest.ResponseRecorder {
		body := bytes.NewBufferString("not-a-plugin-package")
		contentType := "application/octet-stream"
		if multipartBody {
			body = &bytes.Buffer{}
			writer := multipart.NewWriter(body)
			part, _ := writer.CreateFormFile("file", "demo.yingce-plugin")
			_, _ = part.Write([]byte("not-a-plugin-package"))
			_ = writer.Close()
			contentType = writer.FormDataContentType()
		}
		request := httptest.NewRequest(http.MethodPost, "/api/plugins", body)
		request.Header.Set("Content-Type", contentType)
		request.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "admin.test-token"})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}

	setUpload(false)
	for _, multipartBody := range []bool{false, true} {
		response := upload(multipartBody)
		if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), "在线安装插件已关闭") {
			t.Fatalf("multipart=%v disabled upload = %d %s", multipartBody, response.Code, response.Body.String())
		}
	}
	var audits int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ?", "plugin.install").Count(&audits).Error; err != nil {
		t.Fatal(err)
	}
	if audits != 0 {
		t.Fatalf("plugin.install audits = %d, want 0", audits)
	}

	// 开启后进入原有的插件包校验；无效包仍被拒绝，但不是开关拒绝。
	setUpload(true)
	for _, multipartBody := range []bool{false, true} {
		response := upload(multipartBody)
		if response.Code == http.StatusForbidden || strings.Contains(response.Body.String(), "在线安装插件已关闭") {
			t.Fatalf("multipart=%v enabled upload = %d %s", multipartBody, response.Code, response.Body.String())
		}
	}
}
