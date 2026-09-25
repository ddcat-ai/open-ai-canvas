package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
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

func TestSystemProxyFollowsAllowedModelOrigins(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var hits atomic.Int64
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer upstream.Close()

	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:%s_%d?mode=memory&cache=shared", t.Name(), time.Now().UnixNano())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
		id := string(role)
		if err := db.Create(&model.User{ID: id, Username: id, Email: id + "@example.invalid", Role: role, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	channel := model.ModelChannel{ID: "system-channel", Name: "系统渠道", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstream.URL + "/v1", APIKey: "system-key", ModelsJSON: `[]`}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	router := gin.New()
	RegisterOutboundPolicyRoutes(router.Group("/api"), svc)
	RegisterSystemProxyRoutes(router.Group("/api"), svc)
	call := func(role string, method string, path string, payload any) *httptest.ResponseRecorder {
		var body bytes.Buffer
		if payload != nil {
			_ = json.NewEncoder(&body).Encode(payload)
		}
		request := httptest.NewRequest(method, path, &body)
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: role + ".test-token"})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		return response
	}
	setOrigins := func(origins ...string) {
		t.Helper()
		if response := call("admin", http.MethodPatch, "/api/admin/settings/outbound-policy", map[string]any{"allowedModelOrigins": origins}); response.Code != http.StatusOK {
			t.Fatalf("PATCH outbound policy = %d %s", response.Code, response.Body.String())
		}
	}

	if response := call("user", http.MethodPatch, "/api/admin/settings/outbound-policy", map[string]any{"allowedModelOrigins": []string{}}); response.Code != http.StatusForbidden {
		t.Fatalf("ordinary user PATCH = %d %s", response.Code, response.Body.String())
	}
	if response := call("admin", http.MethodPatch, "/api/admin/settings/outbound-policy", map[string]any{"allowedModelOrigins": []string{"https://api.example.com/v1"}}); response.Code != http.StatusBadRequest {
		t.Fatalf("invalid origin PATCH = %d %s", response.Code, response.Body.String())
	}

	setOrigins("https://api.example.com")
	if response := call("user", http.MethodGet, "/api/ai/system/system-channel/models", nil); response.Code != http.StatusForbidden || hits.Load() != 0 {
		t.Fatalf("blocked proxy = %d %s, upstream hits %d", response.Code, response.Body.String(), hits.Load())
	}
	setOrigins(upstream.URL)
	if response := call("user", http.MethodGet, "/api/ai/system/system-channel/models", nil); response.Code != http.StatusOK || hits.Load() != 1 {
		t.Fatalf("allowed proxy = %d %s, upstream hits %d", response.Code, response.Body.String(), hits.Load())
	}
	setOrigins()
	if response := call("user", http.MethodGet, "/api/ai/system/system-channel/models", nil); response.Code != http.StatusOK || hits.Load() != 2 {
		t.Fatalf("empty allow list proxy = %d %s, upstream hits %d", response.Code, response.Body.String(), hits.Load())
	}
	if response := call("admin", http.MethodGet, "/api/admin/settings/outbound-policy", nil); response.Code != http.StatusOK {
		t.Fatalf("GET outbound policy = %d %s", response.Code, response.Body.String())
	}

	// PATCH 先读当前值再合并：不带字段的请求保留原列表。
	setOrigins(upstream.URL)
	if response := call("admin", http.MethodPatch, "/api/admin/settings/outbound-policy", map[string]any{}); response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(upstream.URL)) {
		t.Fatalf("empty PATCH = %d %s", response.Code, response.Body.String())
	}

	// 已保存的配置损坏时出站检查拒绝，但管理员可以通过 PATCH 直接覆盖修复。
	if err := db.Save(&model.SystemSetting{Key: "outbound_policy", ValueJSON: "not-json"}).Error; err != nil {
		t.Fatal(err)
	}
	if response := call("user", http.MethodGet, "/api/ai/system/system-channel/models", nil); response.Code == http.StatusOK {
		t.Fatalf("corrupted policy proxy = %d %s", response.Code, response.Body.String())
	}
	if response := call("admin", http.MethodGet, "/api/admin/settings/outbound-policy", nil); response.Code == http.StatusOK {
		t.Fatalf("corrupted policy GET = %d %s", response.Code, response.Body.String())
	}
	setOrigins(upstream.URL)
	if response := call("user", http.MethodGet, "/api/ai/system/system-channel/models", nil); response.Code != http.StatusOK {
		t.Fatalf("repaired policy proxy = %d %s", response.Code, response.Body.String())
	}
}
