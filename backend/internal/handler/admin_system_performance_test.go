package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestAdminSystemPerformanceRoutesAreRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterAdminSystemPerformanceRoutes(router.Group("/api"), &service.Service{})
	wanted := map[string]bool{
		"GET /api/admin/system-performance":                  false,
		"GET /api/admin/system-performance/rainyun-realtime": false,
		"PUT /api/admin/system-performance/agent-limit":      false,
		"POST /api/admin/system-performance/cache/clear":     false,
		"GET /api/admin/settings/rainyun-monitor":            false,
		"PATCH /api/admin/settings/rainyun-monitor":          false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Errorf("route %s is not registered", route)
		}
	}
}

// 最小 handler 夹具：内存 SQLite，只迁移鉴权所需表和 SystemSetting。
func newPerformanceHandlerFixture(t *testing.T) (*gin.Engine, func(role model.UserRole) string, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	RegisterAdminSystemPerformanceRoutes(router.Group("/api"), svc)
	// 创建两个用户 + session，返回函数按角色生成 cookie value。
	for _, seed := range []struct {
		id   string
		role model.UserRole
	}{
		{"admin-1", model.UserRoleAdmin},
		{"user-1", model.UserRoleUser},
	} {
		if err := db.Create(&model.User{
			ID: seed.id, Username: seed.id, Email: seed.id + "@example.invalid",
			Role: seed.role, Status: model.UserStatusActive,
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{
			ID: seed.id, UserID: seed.id, TokenHash: auth.HashToken("tok-" + seed.id),
			ExpiresAt: time.Now().Add(time.Hour),
		}).Error; err != nil {
			t.Fatal(err)
		}
	}
	cookie := func(role model.UserRole) string {
		if role == model.UserRoleAdmin {
			return "admin-1.tok-admin-1"
		}
		return "user-1.tok-user-1"
	}
	return router, cookie, db
}

func performanceRequest(t *testing.T, router *gin.Engine, method, path, body, session string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if session != "" {
		req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: session})
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestAdminRainyunMonitorSettingGetRequiresAuth(t *testing.T) {
	router, cookie, _ := newPerformanceHandlerFixture(t)
	if w := performanceRequest(t, router, http.MethodGet, "/admin/settings/rainyun-monitor", "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: got %d want 401: %s", w.Code, w.Body.String())
	}
	if w := performanceRequest(t, router, http.MethodGet, "/admin/settings/rainyun-monitor", "", cookie(model.UserRoleUser)); w.Code != http.StatusForbidden {
		t.Fatalf("user: got %d want 403: %s", w.Code, w.Body.String())
	}
}

func TestAdminRainyunMonitorSettingGetReturnsDefaultForAdmin(t *testing.T) {
	router, cookie, _ := newPerformanceHandlerFixture(t)
	w := performanceRequest(t, router, http.MethodGet, "/admin/settings/rainyun-monitor", "", cookie(model.UserRoleAdmin))
	if w.Code != http.StatusOK {
		t.Fatalf("admin: got %d want 200: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Code int `json:"code"`
		Data struct {
			Enabled    bool  `json:"enabled"`
			InstanceID int64 `json:"instanceId"`
			HasAPIKey  bool  `json:"hasApiKey"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || resp.Code != 0 {
		t.Fatalf("envelope: %s", w.Body.String())
	}
	if resp.Data.Enabled || resp.Data.InstanceID != 0 || resp.Data.HasAPIKey {
		t.Fatalf("default setting unexpected: %+v", resp.Data)
	}
}

func TestAdminRainyunMonitorSettingGetDoesNotWriteSettings(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	dataDir := t.TempDir()
	svc := service.New(repository.New(db), dataDir)
	router := gin.New()
	RegisterAdminSystemPerformanceRoutes(router.Group("/api"), svc)
	if err := db.Create(&model.User{
		ID: "adm", Username: "adm", Email: "adm@example.invalid",
		Role: model.UserRoleAdmin, Status: model.UserStatusActive,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{
		ID: "adm", UserID: "adm", TokenHash: auth.HashToken("tok-adm"),
		ExpiresAt: time.Now().Add(time.Hour),
	}).Error; err != nil {
		t.Fatal(err)
	}
	w := performanceRequest(t, router, http.MethodGet, "/admin/settings/rainyun-monitor", "", "adm.tok-adm")
	if w.Code != http.StatusOK {
		t.Fatalf("got %d: %s", w.Code, w.Body.String())
	}
	var count int64
	if err := db.Model(&model.SystemSetting{}).Where("`key` = ?", "rainyun_monitor").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("GET created a settings record; must be read-only")
	}
	if _, err := os.Stat(filepath.Join(dataDir, ".settings-key")); !os.IsNotExist(err) {
		t.Fatal("GET initialized encryption key")
	}
}

func TestAdminRainyunMonitorSettingPatchRequiresAdmin(t *testing.T) {
	router, cookie, _ := newPerformanceHandlerFixture(t)
	body := `{"enabled":false,"instanceId":0,"apiKey":""}`
	if w := performanceRequest(t, router, http.MethodPatch, "/admin/settings/rainyun-monitor", body, ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous: got %d want 401: %s", w.Code, w.Body.String())
	}
	// 普通用户 + 坏 body 也应先 403 而非 400。
	if w := performanceRequest(t, router, http.MethodPatch, "/admin/settings/rainyun-monitor", "not-json", cookie(model.UserRoleUser)); w.Code != http.StatusForbidden {
		t.Fatalf("user bad body: got %d want 403: %s", w.Code, w.Body.String())
	}
	if w := performanceRequest(t, router, http.MethodPatch, "/admin/settings/rainyun-monitor", body, cookie(model.UserRoleUser)); w.Code != http.StatusForbidden {
		t.Fatalf("user valid body: got %d want 403: %s", w.Code, w.Body.String())
	}
}

func TestAdminRainyunMonitorSettingPatchBadBodyReturnsError(t *testing.T) {
	router, cookie, _ := newPerformanceHandlerFixture(t)
	w := performanceRequest(t, router, http.MethodPatch, "/admin/settings/rainyun-monitor", "not-json", cookie(model.UserRoleAdmin))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad body: got %d want 400: %s", w.Code, w.Body.String())
	}
	// 错误响应不应包含原始解析错误文本或凭据。
	body := w.Body.String()
	if strings.Contains(body, "invalid character") || strings.Contains(body, "not-json") {
		t.Fatalf("response leaks JSON parse detail: %s", body)
	}
}

func TestAdminRainyunMonitorSettingPatchDisableSucceeds(t *testing.T) {
	router, cookie, _ := newPerformanceHandlerFixture(t)
	body := `{"enabled":false,"instanceId":0,"apiKey":""}`
	w := performanceRequest(t, router, http.MethodPatch, "/admin/settings/rainyun-monitor", body, cookie(model.UserRoleAdmin))
	if w.Code != http.StatusOK {
		t.Fatalf("disable: got %d want 200: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Code int `json:"code"`
		Data struct {
			Enabled    bool  `json:"enabled"`
			HasAPIKey  bool  `json:"hasApiKey"`
			InstanceID int64 `json:"instanceId"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || resp.Code != 0 {
		t.Fatalf("envelope: %s", w.Body.String())
	}
	if resp.Data.Enabled || resp.Data.HasAPIKey {
		t.Fatalf("should be disabled with no key: %+v", resp.Data)
	}
}

func TestAdminRainyunMonitorSettingPatchResponseDoesNotLeakAPIKey(t *testing.T) {
	router, cookie, _ := newPerformanceHandlerFixture(t)
	body := `{"enabled":false,"instanceId":123,"apiKey":"super-secret-key"}`
	w := performanceRequest(t, router, http.MethodPatch, "/admin/settings/rainyun-monitor", body, cookie(model.UserRoleAdmin))
	if w.Code != http.StatusOK {
		t.Fatalf("save with key: got %d: %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "super-secret-key") {
		t.Fatalf("response leaks raw API key: %s", w.Body.String())
	}
	var resp struct {
		Code int `json:"code"`
		Data struct {
			HasAPIKey bool `json:"hasApiKey"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || resp.Code != 0 {
		t.Fatalf("envelope: %s", w.Body.String())
	}
	if !resp.Data.HasAPIKey {
		t.Fatalf("hasApiKey should be true after save with key")
	}
	// 不重填密钥可启用；随后 GET 仍只返回脱敏的三个配置字段。
	w = performanceRequest(t, router, http.MethodPatch, "/admin/settings/rainyun-monitor", `{"enabled":true,"instanceId":124,"apiKey":""}`, cookie(model.UserRoleAdmin))
	if w.Code != http.StatusOK {
		t.Fatalf("blank key update: %d %s", w.Code, w.Body.String())
	}
	w = performanceRequest(t, router, http.MethodGet, "/admin/settings/rainyun-monitor", "", cookie(model.UserRoleAdmin))
	var envelope struct {
		Code int                        `json:"code"`
		Data map[string]json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil || w.Code != 200 || envelope.Code != 0 || len(envelope.Data) != 3 || string(envelope.Data["hasApiKey"]) != "true" || string(envelope.Data["instanceId"]) != "124" {
		t.Fatalf("retained key GET contract: %d %s", w.Code, w.Body.String())
	}
}

func TestAdminRainyunMonitorSettingPatchRequiresAllNonNullFieldsWithoutWrites(t *testing.T) {
	router, cookie, db := newPerformanceHandlerFixture(t)
	seed := performanceRequest(t, router, http.MethodPatch, "/admin/settings/rainyun-monitor", `{"enabled":true,"instanceId":123,"apiKey":"test-monitor-key"}`, cookie(model.UserRoleAdmin))
	if seed.Code != http.StatusOK {
		t.Fatalf("seed: %d %s", seed.Code, seed.Body.String())
	}
	var before model.SystemSetting
	if err := db.First(&before, "key = ?", "rainyun_monitor").Error; err != nil {
		t.Fatal(err)
	}
	writes := 0
	countWrite := func(*gorm.DB) { writes++ }
	if err := db.Callback().Update().Before("gorm:update").Register("rainyun-handler-count-update", countWrite); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Create().Before("gorm:create").Register("rainyun-handler-count-create", countWrite); err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{
		`{}`, `null`,
		`{"instanceId":0,"apiKey":""}`, `{"enabled":false,"apiKey":""}`, `{"enabled":false,"instanceId":0}`,
		`{"enabled":null,"instanceId":0,"apiKey":""}`, `{"enabled":false,"instanceId":null,"apiKey":""}`, `{"enabled":false,"instanceId":0,"apiKey":null}`,
	} {
		w := performanceRequest(t, router, http.MethodPatch, "/admin/settings/rainyun-monitor", body, cookie(model.UserRoleAdmin))
		if w.Code != http.StatusBadRequest || writes != 0 {
			t.Fatalf("incomplete input status=%d writes=%d: %s", w.Code, writes, body)
		}
		var after model.SystemSetting
		if err := db.First(&after, "key = ?", "rainyun_monitor").Error; err != nil {
			t.Fatal(err)
		}
		if after.ValueJSON != before.ValueJSON || !after.UpdatedAt.Equal(before.UpdatedAt) {
			t.Fatal("incomplete request changed stored configuration")
		}
	}
	w := performanceRequest(t, router, http.MethodPatch, "/admin/settings/rainyun-monitor", `{"enabled":false,"instanceId":0,"apiKey":""}`, cookie(model.UserRoleAdmin))
	if w.Code != http.StatusOK || writes == 0 {
		t.Fatalf("explicit false/0/empty rejected: %d %s", w.Code, w.Body.String())
	}
	var after model.SystemSetting
	if err := db.First(&after, "key = ?", "rainyun_monitor").Error; err != nil {
		t.Fatal(err)
	}
	var original, saved struct {
		Enabled    bool   `json:"enabled"`
		InstanceID int64  `json:"instanceId"`
		APIKey     string `json:"apiKey"`
	}
	if err := json.Unmarshal([]byte(before.ValueJSON), &original); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(after.ValueJSON), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Enabled || saved.InstanceID != 0 || saved.APIKey == "" || saved.APIKey != original.APIKey {
		t.Fatal("explicit disable did not preserve stored key")
	}
}

func TestAdminRainyunMonitorSettingPatchRejectsInvalidValuesAndOversize(t *testing.T) {
	router, cookie, _ := newPerformanceHandlerFixture(t)
	for _, body := range []string{
		`{"enabled":true,"instanceId":0,"apiKey":"key"}`,
		`{"enabled":true,"instanceId":123,"apiKey":""}`,
		`{"enabled":false,"instanceId":1.5,"apiKey":""}`,
		`{"enabled":false,"instanceId":-1,"apiKey":""}`,
		`{"enabled":false,"instanceId":123,"apiKey":"key\r\nInjected:true"}`,
		`{"enabled":false,"instanceId":123,"apiKey":"` + strings.Repeat("x", 9000) + `"}`,
	} {
		w := performanceRequest(t, router, http.MethodPatch, "/admin/settings/rainyun-monitor", body, cookie(model.UserRoleAdmin))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("invalid request accepted: %d", w.Code)
		}
		if strings.Contains(w.Body.String(), "Injected:true") || strings.Contains(w.Body.String(), strings.Repeat("x", 128)) {
			t.Fatal("validation response leaked request key")
		}
	}
}

func TestAdminRainyunRealtimeRouteRequiresAdminAndReturnsReadOnlyEnvelope(t *testing.T) {
	router, cookie, db := newPerformanceHandlerFixture(t)
	path := "/admin/system-performance/rainyun-realtime"
	if w := performanceRequest(t, router, http.MethodGet, path, "", ""); w.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous realtime: %d %s", w.Code, w.Body.String())
	}
	if w := performanceRequest(t, router, http.MethodGet, path, "", cookie(model.UserRoleUser)); w.Code != http.StatusForbidden {
		t.Fatalf("user realtime: %d %s", w.Code, w.Body.String())
	}
	writes := 0
	countWrite := func(*gorm.DB) { writes++ }
	if err := db.Callback().Create().Before("gorm:create").Register("realtime-handler-no-create", countWrite); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Update().Before("gorm:update").Register("realtime-handler-no-update", countWrite); err != nil {
		t.Fatal(err)
	}
	if err := db.Callback().Delete().Before("gorm:delete").Register("realtime-handler-no-delete", countWrite); err != nil {
		t.Fatal(err)
	}
	w := performanceRequest(t, router, http.MethodGet, path+"?instanceId=999&upstream=https%3A%2F%2Fprivate.invalid&start_date=0&apiKey=browser-secret", "", cookie(model.UserRoleAdmin))
	var envelope struct {
		Code int                                      `json:"code"`
		Data service.SystemPerformanceRainyunRealtime `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil || w.Code != http.StatusOK || envelope.Code != 0 {
		t.Fatalf("realtime envelope: %d %s", w.Code, w.Body.String())
	}
	got := envelope.Data
	if got.Enabled || got.Configured || got.Status != "disabled" || got.InstanceID != 0 || got.CheckedAt != nil || got.SampleIntervalSeconds != nil || got.RetryAfterSeconds < 1 || got.Points == nil || len(got.Points) != 0 || writes != 0 {
		t.Fatalf("default realtime=%+v writes=%d", got, writes)
	}
	for _, forbidden := range []string{"browser-secret", "private.invalid", "instanceId", "apiKey", "sampleIntervalSeconds", "checkedAt"} {
		if strings.Contains(w.Body.String(), forbidden) {
			t.Fatalf("default realtime accepted or leaked browser input: %s", forbidden)
		}
	}
	var count int64
	if err := db.Model(&model.SystemSetting{}).Where("key = ?", "rainyun_monitor").Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("realtime GET wrote settings: %d %v", count, err)
	}
	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		if w := performanceRequest(t, router, method, path, `{}`, cookie(model.UserRoleAdmin)); w.Code != http.StatusNotFound {
			t.Fatalf("realtime unexpectedly registered write method %s: %d", method, w.Code)
		}
	}
}

func TestAdminRainyunRealtimeInvalidStoredSecretIsNotReturnedOrMigrated(t *testing.T) {
	router, cookie, db := newPerformanceHandlerFixture(t)
	setting := model.SystemSetting{Key: "rainyun_monitor", ValueJSON: `{"enabled":true,"instanceId":123,"apiKey":"legacy-management-secret"}`}
	if err := db.Create(&setting).Error; err != nil {
		t.Fatal(err)
	}
	w := performanceRequest(t, router, http.MethodGet, "/admin/system-performance/rainyun-realtime", "", cookie(model.UserRoleAdmin))
	var envelope struct {
		Code int                                      `json:"code"`
		Data service.SystemPerformanceRainyunRealtime `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil || w.Code != 200 || envelope.Code != 0 || envelope.Data.Status != "unconfigured" || envelope.Data.Configured || envelope.Data.Points == nil || len(envelope.Data.Points) != 0 {
		t.Fatalf("invalid secret snapshot: %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "legacy-management-secret") {
		t.Fatal("realtime leaked stored credential")
	}
	var after model.SystemSetting
	if err := db.First(&after, "key = ?", setting.Key).Error; err != nil {
		t.Fatal(err)
	}
	if after.ValueJSON != setting.ValueJSON || !after.UpdatedAt.Equal(setting.UpdatedAt) {
		t.Fatal("realtime GET migrated stored credentials")
	}
}
