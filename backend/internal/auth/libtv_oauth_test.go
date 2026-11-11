package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

const testLibTVProjectUUID = "292a69d540774a9ab9872d8337c9fd0b"

type libTVFakeServer struct {
	registerCalls  atomic.Int32
	tokenCalls     atomic.Int32
	refreshCalls   atomic.Int32
	mcpCalls       atomic.Int32
	lastRegister   map[string]any
	accessToken    string
	refreshToken   string
	nextAccess     string
	nextRefresh    string
	expiredAccess  string
	readArgs       map[string]any
	targetArgs     map[string]any
	tools          []mcpTool
	projectPayload map[string]any
	accountPayload map[string]any
	tokenStatus    int
}

func newLibTVFakeServer() *libTVFakeServer {
	return &libTVFakeServer{
		accessToken:  "access-1",
		refreshToken: "refresh-1",
		nextAccess:   "access-2",
		nextRefresh:  "refresh-2",
		tools: []mcpTool{
			{Name: "account_user", InputSchema: map[string]any{"type": "object", "properties": map[string]any{}}},
			{Name: "target_project", InputSchema: map[string]any{"type": "object", "properties": map[string]any{"projectId": map[string]any{"type": "string"}}, "required": []any{"projectId"}}},
			{Name: "read_project", InputSchema: map[string]any{"type": "object", "properties": map[string]any{"projectId": map[string]any{"type": "string"}}, "required": []any{"projectId"}}},
		},
		projectPayload: map[string]any{
			"projectMeta": map[string]any{"uuid": testLibTVProjectUUID, "name": "测试画布", "effective": map[string]any{"canRead": true, "canCopy": true}},
			"nodeList": []any{
				map[string]any{
					"nodeKey":   "image-1",
					"name":      "示例图",
					"positionX": "12",
					"positionY": "34",
					"width":     "640",
					"height":    "360",
					"type":      "image",
					"url":       []any{"https://example.com/first.png"},
					"params":    map[string]any{"prompt": "prompt", "model": "model"},
				},
			},
			"connectionList": []any{},
		},
		accountPayload: map[string]any{"displayName": "画布管理员", "id": "user-1"},
	}
}

func (f *libTVFakeServer) start(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/.well-known/oauth-authorization-server"):
			base := "http://" + r.Host
			writeJSON(w, http.StatusOK, map[string]any{
				"issuer":                           base,
				"authorization_endpoint":           base + "/authorize",
				"token_endpoint":                   base + "/token",
				"registration_endpoint":            base + "/register",
				"code_challenge_methods_supported": []string{"S256"},
				"grant_types_supported":            []string{"authorization_code", "refresh_token"},
			})
		case r.Method == http.MethodPost && r.URL.Path == "/register":
			f.registerCalls.Add(1)
			body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
			var payload map[string]any
			_ = json.Unmarshal(body, &payload)
			f.lastRegister = payload
			redirects, _ := payload["redirect_uris"].([]any)
			redirect, _ := redirects[0].(string)
			if !strings.Contains(redirect, "127.0.0.1") && !strings.Contains(redirect, "localhost") && !strings.Contains(redirect, "[::1]") {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_redirect_uri", "error_description": "redirect URI is not allowed"})
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{"client_id": "client-1", "client_id_issued_at": time.Now().Unix()})
		case r.Method == http.MethodPost && r.URL.Path == "/token":
			f.tokenCalls.Add(1)
			_ = r.ParseForm()
			if f.tokenStatus != 0 {
				writeJSON(w, f.tokenStatus, map[string]any{"error": "invalid_grant"})
				return
			}
			if r.Form.Get("resource") == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_request", "error_description": "missing resource"})
				return
			}
			if r.Form.Get("grant_type") == "refresh_token" {
				f.refreshCalls.Add(1)
				writeJSON(w, http.StatusOK, map[string]any{"access_token": f.nextAccess, "refresh_token": f.nextRefresh, "token_type": "Bearer", "expires_in": 3600, "scope": "libtv:account:read libtv:project:read"})
				return
			}
			if r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("code") == "" || r.Form.Get("code_verifier") == "" {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_request"})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"access_token": f.accessToken, "refresh_token": f.refreshToken, "token_type": "Bearer", "expires_in": 3600, "scope": "libtv:account:read libtv:project:read"})
		case r.Method == http.MethodPost && r.URL.Path == "/mcp":
			f.mcpCalls.Add(1)
			if got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "); got == f.expiredAccess {
				w.WriteHeader(http.StatusUnauthorized)
				_, _ = w.Write([]byte(`{"error":"invalid_token"}`))
				return
			}
			body, _ := io.ReadAll(io.LimitReader(r.Body, 8<<20))
			var rpc struct {
				Method string          `json:"method"`
				Params json.RawMessage `json:"params"`
				ID     any             `json:"id"`
			}
			_ = json.Unmarshal(body, &rpc)
			switch rpc.Method {
			case "initialize":
				writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"protocolVersion": libTVMCPProtocolVersion, "capabilities": map[string]any{}, "serverInfo": map[string]any{"name": "libtv"}}})
			case "notifications/initialized":
				w.WriteHeader(http.StatusAccepted)
			case "tools/list":
				writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"tools": f.tools}})
			case "tools/call":
				var params struct {
					Name      string         `json:"name"`
					Arguments map[string]any `json:"arguments"`
				}
				_ = json.Unmarshal(rpc.Params, &params)
				switch params.Name {
				case "target_project":
					f.targetArgs = params.Arguments
					writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"structuredContent": map[string]any{"ok": true}}})
				case "account_user":
					writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"structuredContent": f.accountPayload}})
				case "read_project":
					f.readArgs = params.Arguments
					writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "result": map[string]any{"structuredContent": f.projectPayload}})
				default:
					writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "error": map[string]any{"code": -32601, "message": "unknown tool"}})
				}
			default:
				writeJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": rpc.ID, "error": map[string]any{"code": -32601, "message": "unknown method"}})
			}
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func newLibTVTestService(t *testing.T, server *httptest.Server) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.SystemSetting{}, &model.OAuthState{}, &model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin-1", Username: "admin", DisplayName: "管理员", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), nil, nil)
	if server != nil {
		svc.libtv = &libTVRuntime{issuer: server.URL, mcpURL: server.URL + "/mcp", resource: "https://mcp.liblib.tv/mcp", client: server.Client(), now: time.Now}
	}
	return svc, db, admin
}

func TestPreferredLibTVRedirectUsesLoopbackForAutomaticCallback(t *testing.T) {
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "http://127.0.0.1:3080")
	uri, mode := preferredLibTVRedirectURI("")
	if uri != "http://127.0.0.1:3080/api/admin/settings/libtv/oauth/callback" || mode != libTVCallbackModeRedirect {
		t.Fatalf("preferred = %q %q", uri, mode)
	}
}

func TestPreferredLibTVRedirectFallsBackToPasteForPublicOrigin(t *testing.T) {
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "http://85.137.240.113:3080")
	uri, mode := preferredLibTVRedirectURI("http://85.137.240.113:3080")
	if uri != "http://85.137.240.113:3080/api/admin/settings/libtv/oauth/callback" || mode != libTVCallbackModePaste {
		t.Fatalf("first preferred = %q %q", uri, mode)
	}
	candidates := libTVRedirectCandidates("http://85.137.240.113:3080")
	if len(candidates) < 2 || candidates[len(candidates)-1].URI != libTVPasteRedirectURI {
		t.Fatalf("candidates = %#v", candidates)
	}
}

func TestParseLibTVCallbackURL(t *testing.T) {
	code, state, err := parseLibTVCallbackURL("http://127.0.0.1:8765/callback?code=abc&state=xyz")
	if err != nil || code != "abc" || state != "xyz" {
		t.Fatalf("parse = %q %q %v", code, state, err)
	}
	if _, _, err := parseLibTVCallbackURL("http://127.0.0.1:8765/callback?error=access_denied"); err == nil {
		t.Fatal("expected error for denied callback")
	}
}

func TestStartLibTVOAuthFallsBackToLoopbackWhenPublicRedirectRejected(t *testing.T) {
	fake := newLibTVFakeServer()
	server := fake.start(t)
	svc, _, admin := newLibTVTestService(t, server)
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "http://85.137.240.113:3080")

	result, err := svc.StartLibTVOAuth(admin, LibTVConnectStartRequest{Origin: "http://85.137.240.113:3080"})
	if err != nil {
		t.Fatalf("StartLibTVOAuth() error = %v", err)
	}
	if result.CallbackMode != libTVCallbackModePaste || result.RedirectURI != libTVPasteRedirectURI {
		t.Fatalf("start result = %#v", result)
	}
	parsed, err := url.Parse(result.AuthorizeURL)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if query.Get("resource") != "https://mcp.liblib.tv/mcp" || query.Get("code_challenge_method") != "S256" || query.Get("client_id") != "client-1" {
		t.Fatalf("authorize query = %s", parsed.RawQuery)
	}
	if !strings.Contains(query.Get("scope"), "libtv:project:read") || strings.Contains(query.Get("scope"), "libtv:project:write") {
		t.Fatalf("scope = %q", query.Get("scope"))
	}
	if fake.registerCalls.Load() < 2 {
		t.Fatalf("register calls = %d, want public rejection then loopback", fake.registerCalls.Load())
	}
}

func TestStartAndCompleteLibTVOAuthStoresTokensWithoutEchoingSecrets(t *testing.T) {
	fake := newLibTVFakeServer()
	server := fake.start(t)
	svc, db, admin := newLibTVTestService(t, server)
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "http://127.0.0.1:3080")

	start, err := svc.StartLibTVOAuth(admin, LibTVConnectStartRequest{Origin: "http://127.0.0.1:3080"})
	if err != nil {
		t.Fatalf("StartLibTVOAuth() error = %v", err)
	}
	if start.CallbackMode != libTVCallbackModeRedirect {
		t.Fatalf("callback mode = %q", start.CallbackMode)
	}
	state := mustQueryParam(t, start.AuthorizeURL, "state")
	setting, err := svc.CompleteLibTVOAuth(admin, LibTVConnectCompleteRequest{Code: "auth-code", State: state})
	if err != nil {
		t.Fatalf("CompleteLibTVOAuth() error = %v", err)
	}
	if !setting.Connected || setting.HasToken != true || setting.AccountName != "画布管理员" || setting.Enabled {
		t.Fatalf("public setting after connect = %#v", setting)
	}
	encoded, err := json.Marshal(setting)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"access-1", "refresh-1", "accessToken", "refreshToken", "clientSecret", "auth-code"} {
		if strings.Contains(string(encoded), secret) && secret != "accessToken" && secret != "refreshToken" && secret != "clientSecret" {
			t.Fatalf("public setting leaked %q: %s", secret, encoded)
		}
	}
	for _, secret := range []string{"access-1", "refresh-1"} {
		if strings.Contains(string(encoded), secret) {
			t.Fatalf("public setting leaked token value %q: %s", secret, encoded)
		}
	}

	_, value, err := svc.readLibTVSetting()
	if err != nil {
		t.Fatal(err)
	}
	if value.AccessToken != "access-1" || value.RefreshToken != "refresh-1" || value.ClientID != "client-1" {
		t.Fatalf("stored credentials = %#v", value)
	}

	var stored model.SystemSetting
	if err := db.First(&stored, "key = ?", libTVSettingKey).Error; err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.ValueJSON, `"enabled":true`) && value.Enabled {
		t.Fatal("unexpected auto-enable")
	}

	if _, err := svc.UpdateLibTVSetting(admin, LibTVSettingRequest{Enabled: true}); err != nil {
		t.Fatalf("enable after connect error = %v", err)
	}
	public, err := svc.AdminLibTVSetting(admin)
	if err != nil || !public.Enabled || !public.Connected {
		t.Fatalf("enabled setting = %#v err=%v", public, err)
	}
}

func TestUpdateLibTVSettingRejectsEnableWithoutConnection(t *testing.T) {
	svc, _, admin := newLibTVTestService(t, nil)
	if _, err := svc.UpdateLibTVSetting(admin, LibTVSettingRequest{Enabled: true}); err == nil {
		t.Fatal("UpdateLibTVSetting() error = nil, want rejection")
	}
}

func TestCompleteLibTVOAuthRejectsInvalidState(t *testing.T) {
	fake := newLibTVFakeServer()
	server := fake.start(t)
	svc, _, admin := newLibTVTestService(t, server)
	if _, err := svc.StartLibTVOAuth(admin, LibTVConnectStartRequest{}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompleteLibTVOAuth(admin, LibTVConnectCompleteRequest{Code: "auth-code", State: "missing"}); err == nil {
		t.Fatal("CompleteLibTVOAuth() error = nil, want invalid state")
	}
}

func TestLibTVAccessTokenRefreshesAndPersistsRotatedRefreshToken(t *testing.T) {
	fake := newLibTVFakeServer()
	server := fake.start(t)
	svc, _, admin := newLibTVTestService(t, server)
	now := time.Now()
	svc.libtv.now = func() time.Time { return now }
	if err := seedLibTVConnection(svc, admin.ID, "old-access", "old-refresh", now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	token, err := svc.libTVAccessToken(false)
	if err != nil {
		t.Fatalf("libTVAccessToken() error = %v", err)
	}
	if token != "access-2" {
		t.Fatalf("token = %q, want access-2", token)
	}
	_, value, err := svc.readLibTVSetting()
	if err != nil {
		t.Fatal(err)
	}
	if value.AccessToken != "access-2" || value.RefreshToken != "refresh-2" {
		t.Fatalf("persisted tokens = %#v", value)
	}
	if fake.refreshCalls.Load() != 1 {
		t.Fatalf("refresh calls = %d", fake.refreshCalls.Load())
	}
}

func TestImportLibTVUsesAuthorizedMCPAndExistingAdapter(t *testing.T) {
	fake := newLibTVFakeServer()
	server := fake.start(t)
	svc, db, admin := newLibTVTestService(t, server)
	if err := seedLibTVConnection(svc, admin.ID, fake.accessToken, fake.refreshToken, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateLibTVSetting(admin, LibTVSettingRequest{Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "canvas-1", UserID: admin.ID, Title: "画布"}).Error; err != nil {
		t.Fatal(err)
	}
	result, err := svc.ImportLibTV(admin.ID, "canvas-1", testLibTVProjectUUID)
	if err != nil {
		t.Fatalf("ImportLibTV() error = %v", err)
	}
	if result.ImportedNodeCount != 1 || result.ProjectName != "测试画布" || result.Nodes[0].Content != "https://example.com/first.png" {
		t.Fatalf("import result = %#v", result)
	}
	if fake.readArgs["projectId"] != testLibTVProjectUUID {
		t.Fatalf("read_project args = %#v", fake.readArgs)
	}
	if fake.targetArgs["projectId"] != testLibTVProjectUUID {
		t.Fatalf("target_project args = %#v", fake.targetArgs)
	}
}

func TestPublicLibTVSettingJSONOmitsSecrets(t *testing.T) {
	setting := PublicLibTVSetting{Enabled: true, Connected: true, HasToken: true, AccountName: "Alice"}
	encoded, err := json.Marshal(setting)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"accessToken", "refreshToken", "clientSecret", "token", "clientId"} {
		if strings.Contains(string(encoded), `"`+key+`"`) {
			t.Fatalf("public JSON contained %s: %s", key, encoded)
		}
	}
}

func TestDisconnectLibTVClearsTokensAndDisablesImport(t *testing.T) {
	fake := newLibTVFakeServer()
	server := fake.start(t)
	svc, _, admin := newLibTVTestService(t, server)
	if err := seedLibTVConnection(svc, admin.ID, "access-1", "refresh-1", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateLibTVSetting(admin, LibTVSettingRequest{Enabled: true}); err != nil {
		t.Fatal(err)
	}
	setting, err := svc.DisconnectLibTV(admin)
	if err != nil {
		t.Fatal(err)
	}
	if setting.Enabled || setting.Connected || setting.HasToken {
		t.Fatalf("disconnected setting = %#v", setting)
	}
	_, value, err := svc.readLibTVSetting()
	if err != nil {
		t.Fatal(err)
	}
	if value.AccessToken != "" || value.RefreshToken != "" || value.Enabled {
		t.Fatalf("stored value after disconnect = %#v", value)
	}
}

func seedLibTVConnection(svc *Service, actorID, access, refresh string, expires time.Time) error {
	_, value, err := svc.readLibTVSetting()
	if err != nil {
		return err
	}
	value.ClientID = "client-1"
	value.AccessToken = access
	value.RefreshToken = refresh
	value.ExpiresAt = expires
	value.Issuer = svc.libTVRuntime().issuer
	_, err = svc.persistLibTVSetting(actorID, value)
	return err
}

func mustQueryParam(t *testing.T, raw, key string) string {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	value := parsed.Query().Get(key)
	if value == "" {
		t.Fatalf("missing query %s in %s", key, raw)
	}
	return value
}
