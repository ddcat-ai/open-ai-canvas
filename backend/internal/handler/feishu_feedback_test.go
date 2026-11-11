package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

type feishuHTTPFixture struct {
	router *gin.Engine
	db     *gorm.DB
}

func newFeishuHTTPFixture(t *testing.T) (*feishuHTTPFixture, *service.Service) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	rows := []any{
		&model.User{ID: "feishu-user", Username: "feishu-user", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.User{ID: "feishu-admin", Username: "feishu-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		&model.AuthSession{ID: "feishu-user-session", UserID: "feishu-user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.AuthSession{ID: "feishu-admin-session", UserID: "feishu-admin", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
	}
	for _, row := range rows {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	router := gin.New()
	RegisterFeishuFeedbackRoutes(router.Group("/api"), svc)
	return &feishuHTTPFixture{router: router, db: db}, svc
}

func TestFeishuFeedbackHTTPCallbackLifecycle(t *testing.T) {
	fixture, svc := newFeishuHTTPFixture(t)

	// A callback is public only after an administrator enables the integration.
	r := httptest.NewRequest(http.MethodPost, "/api/integrations/feishu/events", strings.NewReader(`{"type":"url_verification","challenge":"disabled","token":"verify"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	fixture.router.ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("disabled callback status = %d, want %d: %s", w.Code, http.StatusForbidden, w.Body.String())
	}

	admin := &model.User{ID: "feishu-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if _, err := svc.SaveFeishuFeedbackSettings(admin, service.FeishuFeedbackSettingsInput{
		Enabled: true, AppID: "app", AppSecret: "secret", VerificationToken: "verify", AdminChatID: "oc_admin",
	}); err != nil {
		t.Fatal(err)
	}

	challengeReq := httptest.NewRequest(http.MethodPost, "/api/integrations/feishu/events", strings.NewReader(`{"type":"url_verification","challenge":"challenge-123","token":"verify"}`))
	challengeReq.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	fixture.router.ServeHTTP(w, challengeReq)
	if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != `{"challenge":"challenge-123"}` {
		t.Fatalf("challenge response = %d %q", w.Code, w.Body.String())
	}

	badTokenReq := httptest.NewRequest(http.MethodPost, "/api/integrations/feishu/events", strings.NewReader(`{"type":"url_verification","challenge":"bad","token":"wrong"}`))
	badTokenReq.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	fixture.router.ServeHTTP(w, badTokenReq)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("invalid token status = %d, want %d: %s", w.Code, http.StatusUnauthorized, w.Body.String())
	}

	content, _ := json.Marshal(map[string]string{"text": "bug: 导出失败"})
	event, _ := json.Marshal(map[string]any{
		"header": map[string]string{"event_id": "evt-http-1", "tenant_key": "tenant-http", "token": "verify"},
		"event": map[string]any{
			"sender":  map[string]any{"sender_id": map[string]string{"open_id": "ou-http"}},
			"message": map[string]string{"message_id": "om-http-1", "chat_id": "oc-http-1", "message_type": "text", "content": string(content)},
		},
	})
	for attempt := 0; attempt < 2; attempt++ {
		req := httptest.NewRequest(http.MethodPost, "/api/integrations/feishu/events", strings.NewReader(string(event)))
		req.Header.Set("Content-Type", "application/json")
		w = httptest.NewRecorder()
		fixture.router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("event attempt %d status = %d: %s", attempt+1, w.Code, w.Body.String())
		}
		var envelope struct {
			Data struct {
				Duplicate bool `json:"duplicate"`
				Stored    bool `json:"stored"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		if attempt == 0 && (!envelope.Data.Stored || envelope.Data.Duplicate) {
			t.Fatalf("first callback result = %+v", envelope.Data)
		}
		if attempt == 1 && (!envelope.Data.Stored || !envelope.Data.Duplicate) {
			t.Fatalf("duplicate callback result = %+v", envelope.Data)
		}
	}
	var count int64
	if err := fixture.db.Model(&model.UserFeedback{}).Where("user_id LIKE ?", "feishu:%").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("stored feedback count = %d, want 1", count)
	}
}

func TestFeishuFeedbackHTTPAdminPermissionsAndSettings(t *testing.T) {
	fixture, _ := newFeishuHTTPFixture(t)

	request := func(method, path, body, session string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if session != "" {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: session + ".test-token"})
		}
		w := httptest.NewRecorder()
		fixture.router.ServeHTTP(w, r)
		return w
	}

	for _, tc := range []struct {
		method, path, body string
	}{
		{http.MethodGet, "/api/admin/integrations/feishu", ""},
		{http.MethodPut, "/api/admin/integrations/feishu", `{"enabled":false}`},
	} {
		w := request(tc.method, tc.path, tc.body, "feishu-user-session")
		if w.Code != http.StatusForbidden {
			t.Fatalf("non-admin %s status = %d, want %d: %s", tc.method, w.Code, http.StatusForbidden, w.Body.String())
		}
	}

	payload := `{"enabled":true,"appId":"admin-app","appSecret":"admin-secret","verificationToken":"admin-verify","adminChatId":"oc-admin","baseUrl":"https://open.feishu.cn","timezone":"Asia/Shanghai","digestHour":0,"digestMinute":5}`
	w := request(http.MethodPut, "/api/admin/integrations/feishu", payload, "feishu-admin-session")
	if w.Code != http.StatusOK || strings.Contains(w.Body.String(), "admin-secret") || strings.Contains(w.Body.String(), "admin-verify") {
		t.Fatalf("admin save response = %d %s", w.Code, w.Body.String())
	}
	var saved struct {
		Data struct {
			Enabled         bool   `json:"enabled"`
			AppID           string `json:"appId"`
			DigestHour      int    `json:"digestHour"`
			DigestMinute    int    `json:"digestMinute"`
			AppSecretSet    bool   `json:"appSecretSet"`
			VerificationSet bool   `json:"verificationTokenSet"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if !saved.Data.Enabled || saved.Data.AppID != "admin-app" || saved.Data.DigestHour != 0 || saved.Data.DigestMinute != 5 || !saved.Data.AppSecretSet || !saved.Data.VerificationSet {
		t.Fatalf("admin save data = %+v", saved.Data)
	}

	w = request(http.MethodGet, "/api/admin/integrations/feishu", "", "feishu-admin-session")
	if w.Code != http.StatusOK || strings.Contains(w.Body.String(), "admin-secret") || strings.Contains(w.Body.String(), "admin-verify") {
		t.Fatalf("admin read response = %d %s", w.Code, w.Body.String())
	}
}
