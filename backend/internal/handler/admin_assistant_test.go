package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func assistantHTTPFixture(t *testing.T) (*gin.Engine, *service.Service, *model.User, *model.User) {
	t.Helper()
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.test")
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "assistant.db")+"?_journal_mode=WAL&_busy_timeout=5000"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err = database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	admin := &model.User{ID: "admin", Username: "admin", Role: "admin", Status: "active"}
	user := &model.User{ID: "user", Username: "user", Role: "user", Status: "active"}
	if err = db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	for _, u := range []*model.User{admin, user} {
		if err = db.Create(&model.AuthSession{ID: "session-" + u.ID, UserID: u.ID, TokenHash: auth.HashToken("test-token"), CreatedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() {
		if err := svc.Close(); err != nil {
			t.Errorf("close service: %v", err)
		}
	})
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	r := gin.New()
	RegisterAdminAssistantRoutes(r.Group("/api"), svc)
	RegisterAdminAssistantMetadata(r, svc)
	return r, svc, admin, user
}
func assistantHTTPRequest(r http.Handler, method, path, cookie, bearer, origin string, body any) *httptest.ResponseRecorder {
	var b []byte
	if body != nil {
		b, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(b))
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: cookie})
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}
func TestAssistantHTTPAuthenticationAndConfirmation(t *testing.T) {
	r, svc, admin, user := assistantHTTPFixture(t)
	if _, _, err := svc.CreateAssistantToken(user, service.AssistantTokenRequest{Name: "bad"}); err == nil {
		t.Fatal("ordinary user created token")
	}
	_, token, err := svc.CreateAssistantToken(admin, service.AssistantTokenRequest{Name: "test", Scopes: []string{"users:write", "users:read"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		cookie, bearer, origin string
		status                 int
	}{{"", "", "https://canvas.example.test", 401}, {"session-user.test-token", "", "https://canvas.example.test", 403}, {"session-admin.test-token", "", "https://evil.example", 403}, {"session-admin.test-token", token, "https://canvas.example.test", 403}, {"session-admin.test-token", "", "", 403}} {
		w := assistantHTTPRequest(r, "POST", "/api/admin-assistant/tokens", tc.cookie, tc.bearer, tc.origin, map[string]any{"name": "test"})
		if w.Code != tc.status {
			t.Errorf("token auth status=%d want %d", w.Code, tc.status)
		}
	}
	w := assistantHTTPRequest(r, "GET", "/api/admin-assistant/operations", "session-admin.test-token", "", "", nil)
	if w.Code != 401 {
		t.Fatal("operations accepted cookie")
	}
	w = assistantHTTPRequest(r, "POST", "/api/admin-assistant/operations/UpdateUser/execute", "", token, "", map[string]any{"arguments": map[string]any{"userID": user.ID, "req": map[string]any{"displayName": "updated"}}, "idempotencyKey": "http-update-user"})
	if w.Code != 200 {
		t.Fatalf("execute: %d %s", w.Code, w.Body.String())
	}
	var response struct {
		Data service.AssistantExecution `json:"data"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Data.Status != "pending_confirmation" {
		t.Fatalf("unexpected response %+v", response)
	}
	path := "/api/admin-assistant/calls/" + response.Data.ID + "/confirm"
	w = assistantHTTPRequest(r, "POST", path, "", token, "https://canvas.example.test", map[string]bool{"approve": true})
	if w.Code != 403 {
		t.Fatal("agent approved its own operation")
	}
	w = assistantHTTPRequest(r, "POST", path, "session-admin.test-token", "", "https://canvas.example.test", map[string]bool{"approve": true})
	if w.Code != 200 {
		t.Fatalf("confirm: %d %s", w.Code, w.Body.String())
	}
	w = assistantHTTPRequest(r, "POST", "/api/admin-assistant/operations/UpdateUser/execute", "", token, "", map[string]any{"arguments": map[string]any{"userID": user.ID, "req": map[string]any{"displayName": "updated"}}, "idempotencyKey": "http-update-user"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"status":"succeeded"`) {
		t.Fatalf("confirmed execute: %s", w.Body.String())
	}
}

type assistantTokenTransport struct{ token string }

func (t assistantTokenTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header = r.Header.Clone()
	r.Header.Set("Authorization", "Bearer "+t.token)
	return http.DefaultTransport.RoundTrip(r)
}
func TestAssistantMCPRealSDKTransport(t *testing.T) {
	r, svc, admin, _ := assistantHTTPFixture(t)
	credential, token, err := svc.CreateAssistantToken(admin, service.AssistantTokenRequest{Name: "mcp", Scopes: []string{"user-groups:read", "announcements:write"}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(r)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "test-client", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/api/admin-assistant/mcp", HTTPClient: &http.Client{Transport: assistantTokenTransport{token: token}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	tools, err := session.ListTools(ctx, &mcp.ListToolsParams{})
	if err != nil {
		t.Fatal(err)
	}
	if len(tools.Tools) != 3 {
		t.Fatalf("got %d tools", len(tools.Tools))
	}
	for _, call := range []struct {
		name string
		args map[string]any
	}{{"admin_list_operations", map[string]any{}}, {"admin_describe_operation", map[string]any{"operation": "AdminUserGroups"}}, {"admin_execute_operation", map[string]any{"operation": "AdminUserGroups", "arguments": map[string]any{}}}} {
		out, e := session.CallTool(ctx, &mcp.CallToolParams{Name: call.name, Arguments: call.args})
		if e != nil || out.IsError {
			t.Fatalf("%s: %+v %v", call.name, out, e)
		}
		if call.name == "admin_execute_operation" {
			data, _ := json.Marshal(out)
			if !bytes.Contains(data, []byte(`succeeded`)) {
				t.Fatalf("tool did not execute: %s", data)
			}
		}
	}
	write := map[string]any{"operation": "CreateAnnouncement", "arguments": map[string]any{"req": map[string]any{"title": "Real MCP write", "content": "SDK transport", "level": "info"}}, "idempotencyKey": "mcp-create-announcement"}
	for range 2 {
		out, e := session.CallTool(ctx, &mcp.CallToolParams{Name: "admin_execute_operation", Arguments: write})
		if e != nil {
			t.Fatal(e)
		}
		data, _ := json.Marshal(out)
		if out.IsError || !bytes.Contains(data, []byte(`succeeded`)) {
			t.Fatalf("MCP write: %s", data)
		}
	}
	announcements, err := svc.AdminAnnouncementPage(admin, service.AdminListQuery{Keyword: "Real MCP write"})
	if err != nil || announcements.Total != 1 {
		t.Fatalf("MCP idempotency: %+v %v", announcements, err)
	}
	dangerous := map[string]any{"operation": "CloseAnnouncement", "arguments": map[string]any{"id": announcements.Announcements[0].ID}, "idempotencyKey": "mcp-close-announcement"}
	out, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "admin_execute_operation", Arguments: dangerous})
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(out)
	if out.IsError || !bytes.Contains(data, []byte(`pending_confirmation`)) {
		t.Fatalf("MCP dangerous write bypassed confirmation: %s", data)
	}
	calls, err := svc.AssistantCalls(admin, 1)
	if err != nil || len(calls) == 0 {
		t.Fatal("missing MCP invocation", err)
	}
	w := assistantHTTPRequest(r, "POST", "/api/admin-assistant/calls/"+calls[0].ID+"/confirm", "session-admin.test-token", "", "https://canvas.example.test", map[string]bool{"approve": true})
	if w.Code != 200 {
		t.Fatalf("MCP confirmation: %d %s", w.Code, w.Body.String())
	}
	out, err = session.CallTool(ctx, &mcp.CallToolParams{Name: "admin_execute_operation", Arguments: dangerous})
	if err != nil {
		t.Fatal(err)
	}
	data, _ = json.Marshal(out)
	if out.IsError || !bytes.Contains(data, []byte(`succeeded`)) {
		t.Fatalf("MCP approved execution: %s", data)
	}
	if err = svc.RevokeAssistantAccess(admin, credential.ID, false); err != nil {
		t.Fatal(err)
	}
	if out, e := session.CallTool(ctx, &mcp.CallToolParams{Name: "admin_list_operations", Arguments: map[string]any{}}); e == nil && !out.IsError {
		t.Fatal("revoked token remained usable over MCP")
	}
	w = assistantHTTPRequest(r, "POST", "/api/admin-assistant/mcp", "", "", "", map[string]any{"jsonrpc": "2.0", "id": 1, "method": "initialize"})
	if w.Code != 401 || !strings.Contains(w.Header().Get("WWW-Authenticate"), "resource_metadata") {
		t.Fatal("missing MCP authorization discovery")
	}
}
func TestAssistantMCPIntegerPrecision(t *testing.T) {
	r, svc, admin, _ := assistantHTTPFixture(t)
	_, token, err := svc.CreateAssistantToken(admin, service.AssistantTokenRequest{Name: "precision", Scopes: []string{"users:write"}})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(r)
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	client := mcp.NewClient(&mcp.Implementation{Name: "precision-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: server.URL + "/api/admin-assistant/mcp", HTTPClient: &http.Client{Transport: assistantTokenTransport{token: token}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	raw := `{"operation":"AdminAdjustCredits","arguments":{"userID":"user","req":{"amountMicrocredits":9007199254740993,"note":"precision"}},"idempotencyKey":"mcp-precision-test"}`
	call := func(input string) *mcp.CallToolResult {
		t.Helper()
		out, e := session.CallTool(ctx, &mcp.CallToolParams{Name: "admin_execute_operation", Arguments: json.RawMessage(input)})
		if e != nil {
			t.Fatal(e)
		}
		return out
	}
	if out := call(raw); out.IsError {
		t.Fatalf("pending: %+v", out)
	}
	calls, err := svc.AssistantCalls(admin, 1)
	if err != nil || len(calls) != 1 || !strings.Contains(calls[0].PreviewJSON, "9007199254740993") {
		t.Fatalf("MCP input rounded: %+v %v", calls, err)
	}
	if err = svc.ConfirmAssistantCall(admin, calls[0].ID, true); err != nil {
		t.Fatal(err)
	}
	if out := call(strings.ReplaceAll(raw, "9007199254740993", "9007199254740992")); !out.IsError {
		t.Fatal("changed integer reused approval")
	}
	for range 2 {
		out := call(raw)
		text, ok := out.Content[0].(*mcp.TextContent)
		if out.IsError || !ok {
			t.Fatalf("execution: %+v", out)
		}
		var result struct {
			Status string              `json:"status"`
			Result model.CreditAccount `json:"result"`
		}
		if err = json.Unmarshal([]byte(text.Text), &result); err != nil || result.Status != "succeeded" || result.Result.AvailableMicrocredits != 9007199254740993 {
			t.Fatalf("execution/receipt rounded: %s %v", text.Text, err)
		}
	}
	for _, invalid := range []string{`{"operation":"AdminAdjustCredits","arguments":[]}`, `{"operation":"AdminAdjustCredits"}`, `{"operation":"AdminAdjustCredits","arguments":{},"extra":true}`} {
		if out := call(invalid); !out.IsError {
			t.Fatalf("invalid input accepted: %s", invalid)
		}
	}
}

func TestAssistantHTTPMetadataAndSkill(t *testing.T) {
	r, _, _, _ := assistantHTTPFixture(t)
	for _, path := range []string{"/.well-known/oauth-protected-resource/api/admin-assistant/mcp", "/.well-known/oauth-authorization-server/api/admin-assistant/oauth", "/api/admin-assistant/oauth/metadata"} {
		w := assistantHTTPRequest(r, "GET", path, "", "", "", nil)
		if w.Code != 200 {
			t.Fatalf("metadata %s: %d", path, w.Code)
		}
	}
	w := assistantHTTPRequest(r, "GET", "/api/admin-assistant/skill/latest", "", "", "", nil)
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("invalid public manifest")
	}
	installer := assistantHTTPRequest(r, "GET", "/api/admin-assistant/skill/install.py", "", "", "", nil)
	embedded, err := service.AssistantSkillInstaller()
	if err != nil || installer.Code != 200 || !bytes.Equal(installer.Body.Bytes(), embedded) || installer.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("public installer does not match embedded client")
	}
	var manifest struct {
		Data struct {
			DownloadURL string `json:"downloadUrl"`
			SHA256      string `json:"sha256"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &manifest); err != nil {
		t.Fatal(err)
	}
	w = assistantHTTPRequest(r, "GET", manifest.Data.DownloadURL, "", "", "", nil)
	if w.Code != 200 || !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("invalid static package")
	}
	archive := w.Body.Bytes()
	if len(archive) < 2 || string(archive[:2]) != "PK" {
		t.Fatal("not a ZIP archive")
	}
	w = assistantHTTPRequest(r, "POST", "/api/admin-assistant/mcp", "", "", "https://evil.example", nil)
	if w.Code != 403 {
		t.Fatal("cross-origin MCP request accepted")
	}
}
func TestAssistantHTTPOAuthDCR(t *testing.T) {
	r, _, _, _ := assistantHTTPFixture(t)
	w := assistantHTTPRequest(r, "POST", "/api/admin-assistant/oauth/register", "", "", "", map[string]any{"client_name": "test", "redirect_uris": []string{"http://untrusted.example/callback"}})
	if w.Code != 400 {
		t.Fatal("unsafe redirect registered")
	}
	w = assistantHTTPRequest(r, "POST", "/api/admin-assistant/oauth/register", "", "", "", map[string]any{"client_name": "test", "redirect_uris": []string{"http://127.0.0.1:1234/callback"}, "token_endpoint_auth_method": "none"})
	if w.Code != 201 {
		t.Fatalf("DCR %d %s", w.Code, w.Body.String())
	}
	q := url.Values{"client_id": {"unknown"}, "response_type": {"code"}, "resource": {"https://canvas.example.test/api/admin-assistant/mcp"}}
	w = assistantHTTPRequest(r, "GET", "/api/admin-assistant/oauth/authorize?"+q.Encode(), "", "", "", nil)
	if w.Code != 302 || !strings.HasPrefix(w.Header().Get("Location"), "https://canvas.example.test/admin/agent-access/authorize?") {
		t.Fatal("authorization does not lead to existing login UI")
	}
}

func TestAssistantHTTPOfficialResourceImportRoute(t *testing.T) {
	r, svc, _, _ := assistantHTTPFixture(t)
	RegisterOfficialAssetRoutes(r.Group("/api"), svc)
	for _, tc := range []struct {
		cookie string
		status int
	}{
		{"", http.StatusUnauthorized},
		{"session-user.test-token", http.StatusForbidden},
		{"session-admin.test-token", http.StatusBadRequest},
	} {
		w := assistantHTTPRequest(r, http.MethodPost, "/api/admin/official-assets/resources/import-url", tc.cookie, "", "", map[string]any{})
		if w.Code != tc.status {
			t.Fatalf("import route %d, want %d: %s", w.Code, tc.status, w.Body.String())
		}
	}
}

func TestAssistantHTTPOAuthDCRClientMetadata(t *testing.T) {
	r, _, _, _ := assistantHTTPFixture(t)
	for _, tc := range []struct {
		name   string
		extra  map[string]any
		status int
	}{
		{"codex native client", map[string]any{"application_type": "native"}, http.StatusCreated},
		{"extension metadata", map[string]any{"client_uri": "https://example.com", "custom_metadata": map[string]any{"version": 1}}, http.StatusCreated},
		{"unsafe redirect", map[string]any{"application_type": "native", "redirect_uris": []string{"http://untrusted.example/callback"}}, http.StatusBadRequest},
		{"unsupported authentication", map[string]any{"application_type": "native", "token_endpoint_auth_method": "client_secret_basic"}, http.StatusBadRequest},
		{"unsupported grant", map[string]any{"application_type": "native", "grant_types": []string{"client_credentials"}}, http.StatusBadRequest},
		{"unsupported response", map[string]any{"application_type": "native", "response_types": []string{"token"}}, http.StatusBadRequest},
		{"invalid redirect type", map[string]any{"application_type": "native", "redirect_uris": "http://127.0.0.1:1234/callback"}, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := map[string]any{
				"client_name": "Codex", "redirect_uris": []string{"http://127.0.0.1:1234/callback"},
				"grant_types":    []string{"authorization_code", "refresh_token"},
				"response_types": []string{"code"}, "token_endpoint_auth_method": "none",
			}
			for key, value := range tc.extra {
				body[key] = value
			}
			w := assistantHTTPRequest(r, "POST", "/api/admin-assistant/oauth/register", "", "", "", body)
			if w.Code != tc.status {
				t.Fatalf("DCR %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
		})
	}
}

func TestAssistantDecodeObjectBoundaries(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name         string
		body         string
		allowUnknown bool
		status       int
	}{
		{"strict unknown field", `{"client_name":"Codex","application_type":"native"}`, false, http.StatusBadRequest},
		{"registration metadata", `{"client_name":"Codex","application_type":"native"}`, true, http.StatusNoContent},
		{"multiple objects", `{"client_name":"Codex"} {}`, true, http.StatusBadRequest},
		{"invalid field type", `{"client_name":123}`, true, http.StatusBadRequest},
		{"malformed JSON", `{"client_name":`, true, http.StatusBadRequest},
		{"oversized metadata", `{"extension":"` + strings.Repeat("x", 1<<20) + `"}`, true, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.POST("/decode", func(c *gin.Context) {
				var req struct {
					Name string `json:"client_name"`
				}
				if assistantDecodeObject(c, &req, tc.allowUnknown) {
					c.Status(http.StatusNoContent)
				}
			})
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/decode", strings.NewReader(tc.body)))
			if w.Code != tc.status {
				t.Fatalf("decode %d, want %d: %s", w.Code, tc.status, w.Body.String())
			}
		})
	}
}
