package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestMCPHTTPAuthenticationOwnershipAndSecretEnvelope(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
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
	for _, item := range []any{
		&model.User{ID: "mcp-user", Username: "mcp-user", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.User{ID: "mcp-admin", Username: "mcp-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		&model.AuthSession{ID: "mcp-user-session", UserID: "mcp-user", TokenHash: auth.HashToken("http-test"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.AuthSession{ID: "mcp-admin-session", UserID: "mcp-admin", TokenHash: auth.HashToken("http-test"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.MCPConnection{ID: "foreign", UserID: "other", Scope: "user", Name: "另一用户", Transport: "streamable_http", ServerURL: "http://127.0.0.1/mcp", ToolsJSON: "[]", AllowedToolsJSON: "[]"},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	router := gin.New()
	RegisterMCPRoutes(router.Group("/api"), svc)
	request := func(method, path, body, session string, wantStatus int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if session != "" {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: session + ".http-test"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != wantStatus {
			t.Fatalf("%s %s: got %d, want %d: %s", method, path, w.Code, wantStatus, w.Body.String())
		}
		var envelope struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil || ((wantStatus < 400) != (envelope.Code == 0)) {
			t.Fatalf("HTTP and business status disagree: %s", w.Body.String())
		}
		return w
	}
	valid := `{"name":"个人连接","transport":"streamable_http","serverUrl":"http://127.0.0.1/mcp","parameters":{}}`
	for _, tc := range []struct {
		method, path, body, session string
		status                      int
	}{
		{"GET", "/api/agent/mcp/catalog", "", "", 401},
		{"GET", "/api/agent/mcp/connections", "", "mcp-user-session", 200},
		{"GET", "/api/admin/mcp/connections", "", "mcp-user-session", 403},
		{"POST", "/api/admin/mcp/connections", valid, "mcp-user-session", 403},
		{"PUT", "/api/agent/mcp/connections/foreign", valid, "mcp-user-session", 404},
		{"DELETE", "/api/agent/mcp/connections/foreign", "", "mcp-user-session", 404},
		{"POST", "/api/agent/mcp/connections/foreign/test", "", "mcp-user-session", 404},
		{"POST", "/api/agent/mcp/connections", strings.TrimSuffix(valid, "}") + `,"userId":"other"}`, "mcp-user-session", 400},
		{"POST", "/api/agent/mcp/connections", strings.TrimSuffix(valid, "}") + `,"command":"arbitrary-process"}`, "mcp-user-session", 400},
		{"POST", "/api/agent/mcp/connections", strings.TrimSuffix(valid, "}") + `,"enabled":true}`, "mcp-user-session", 400},
	} {
		request(tc.method, tc.path, tc.body, tc.session, tc.status)
	}
	credential := "http-test-" + strings.Repeat("z", 24)
	body, _ := json.Marshal(map[string]any{"name": "个人连接", "transport": "streamable_http", "serverUrl": "http://127.0.0.1/mcp", "parameters": map[string]string{"token": credential}})
	w := request("POST", "/api/agent/mcp/connections", string(body), "mcp-user-session", 200)
	if strings.Contains(w.Body.String(), credential) {
		t.Fatal("creation response disclosed the secret parameter")
	}
	var saved struct {
		Data service.MCPConnectionView `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &saved); err != nil || saved.Data.ID == "" || saved.Data.Scope != "user" || len(saved.Data.ConfiguredSecrets) != 1 {
		t.Fatalf("invalid connection response: %s", w.Body.String())
	}
	var stored model.MCPConnection
	if err := db.Where("id = ?", saved.Data.ID).First(&stored).Error; err != nil || stored.UserID != "mcp-user" || strings.Contains(stored.ParametersCiphertext, credential) {
		t.Fatalf("connection owner/encryption invariant failed: owner=%q err=%v", stored.UserID, err)
	}
	request("DELETE", "/api/agent/mcp/connections/"+saved.Data.ID, "", "mcp-user-session", 200)
	request("GET", "/api/admin/mcp/connections", "", "mcp-admin-session", 200)
}
