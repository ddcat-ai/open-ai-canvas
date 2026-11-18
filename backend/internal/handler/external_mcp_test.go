package handler

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func externalAccessTestService(t *testing.T) *service.Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+t.TempDir()+"/access.db"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.UserAPIKey{}, &model.MCPClient{}, &model.MCPAuthorizationCode{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "owner", Username: "owner", Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "session", UserID: "owner", TokenHash: auth.HashToken("secret"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	return service.New(repository.New(db), t.TempDir())
}

func TestExternalMCPAuthorizationAndRevocation(t *testing.T) {
	svc := externalAccessTestService(t)
	// Building the server also verifies that every public tool has a valid MCP schema.
	_ = externalMCPServer(svc, &model.User{ID: "owner"})
	client, err := svc.RegisterMCPClient("Test Agent", []string{"http://127.0.0.1:4567/callback"})
	if err != nil {
		t.Fatal(err)
	}
	verifier := strings.Repeat("v", 43)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	resource := "https://yingce.example.com/api/mcp"
	code, err := svc.AuthorizeMCP("owner", client.ClientID, "http://127.0.0.1:4567/callback", challenge, resource)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ExchangeMCPCode(code, client.ClientID, "http://127.0.0.1:4567/callback", strings.Repeat("x", 43), resource); err == nil {
		t.Fatal("wrong PKCE verifier accepted")
	}
	issued, err := svc.ExchangeMCPCode(code, client.ClientID, "http://127.0.0.1:4567/callback", verifier, resource)
	if err != nil {
		t.Fatal(err)
	}
	if issued.Key.Kind != "mcp" || issued.Key.TokenHash == issued.Token {
		t.Fatal("MCP grant was not stored safely")
	}
	if _, err := svc.ExchangeMCPCode(code, client.ClientID, "http://127.0.0.1:4567/callback", verifier, resource); err == nil {
		t.Fatal("authorization code replay accepted")
	}
	if _, _, err := svc.UserForAPIKey(issued.Token); err != nil {
		t.Fatal(err)
	}
	if err := svc.RevokeUserAPIKey("owner", issued.Key.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.UserForAPIKey(issued.Token); err == nil {
		t.Fatal("revoked MCP key remained valid")
	}
	keys, err := svc.UserAPIKeys("owner")
	if err != nil || len(keys) != 1 || keys[0].RevokedAt == nil {
		t.Fatalf("revoked grant record missing: %v %#v", err, keys)
	}
}

func TestExternalMCPDiscoveryAndChallenge(t *testing.T) {
	t.Setenv("CANVAS_MCP_PUBLIC_ORIGIN", "https://yingce.example.com")
	svc := externalAccessTestService(t)
	ConfigureRuntime(svc)
	defer ConfigureRuntime(nil)
	router := gin.New()
	RegisterMCPDiscoveryRoutes(router)
	RegisterExternalMCPRoutes(router.Group("/api"), svc)
	request := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(`{}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 401 || !strings.Contains(response.Header().Get("WWW-Authenticate"), "/.well-known/oauth-protected-resource/api/mcp") {
		t.Fatalf("challenge: %d %v", response.Code, response.Header())
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource/api/mcp", nil))
	var metadata struct {
		Resource string `json:"resource"`
	}
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &metadata) != nil || metadata.Resource != "https://yingce.example.com/api/mcp" {
		t.Fatalf("metadata: %d %s", response.Code, response.Body.String())
	}
	issued, err := svc.CreateUserAPIKey("owner", "test")
	if err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`))
	request.Header.Set("Authorization", "Bearer "+issued.Token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 200 || !strings.Contains(response.Body.String(), "yingce-video-creation") {
		t.Fatalf("MCP initialize: %d %s", response.Code, response.Body.String())
	}
	request = httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`))
	request.Header.Set("Authorization", "Bearer "+issued.Token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	request.Header.Set("MCP-Protocol-Version", "2025-06-18")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"create_video"`) || !strings.Contains(response.Body.String(), `"create_drama"`) {
		t.Fatalf("MCP tools/list: %d %s", response.Code, response.Body.String())
	}
}

func TestExternalMCPLocalProxyOrigin(t *testing.T) {
	t.Setenv("CANVAS_MCP_PUBLIC_ORIGIN", "")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	request := httptest.NewRequest(http.MethodGet, "/api/mcp", nil)
	request.Host = "localhost"
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("X-Forwarded-Host", "localhost:3000")
	context.Request = request
	if got := mcpPublicOrigin(context); got != "http://localhost:3000" {
		t.Fatalf("local proxy origin = %q", got)
	}
	request.Header.Set("X-Forwarded-Host", "attacker.example.com")
	if got := mcpPublicOrigin(context); got != "" {
		t.Fatalf("untrusted forwarded host accepted: %q", got)
	}
	request.Header.Del("X-Forwarded-Host")
	request.Host = "203.0.113.10:3000"
	if got := mcpPublicOrigin(context); got != "" {
		t.Fatalf("unconfigured remote HTTP accepted: %q", got)
	}
	t.Setenv("CANVAS_MCP_PUBLIC_ORIGIN", "http://203.0.113.10:3000")
	if got := mcpPublicOrigin(context); got != "http://203.0.113.10:3000" {
		t.Fatalf("configured remote HTTP origin = %q", got)
	}
}

func TestExternalMCPOAuthHTTPFlow(t *testing.T) {
	const publicOrigin = "http://203.0.113.10:3000"
	t.Setenv("CANVAS_MCP_PUBLIC_ORIGIN", publicOrigin)
	svc := externalAccessTestService(t)
	ConfigureRuntime(svc)
	defer ConfigureRuntime(nil)
	router := gin.New()
	RegisterMCPDiscoveryRoutes(router)
	RegisterExternalAccessRoutes(router.Group("/api"), svc)
	RegisterExternalMCPRoutes(router.Group("/api"), svc)
	call := func(method, path, body, contentType string, cookie bool) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		if contentType != "" {
			req.Header.Set("Content-Type", contentType)
		}
		if cookie {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "session.secret"})
			req.Header.Set("Origin", publicOrigin)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		return w
	}
	metadata := call("GET", "/.well-known/oauth-protected-resource/api/mcp", "", "", false)
	if metadata.Code != 200 || !strings.Contains(metadata.Body.String(), publicOrigin+"/api/mcp") {
		t.Fatalf("HTTP discovery: %d %s", metadata.Code, metadata.Body.String())
	}
	registered := call("POST", "/api/mcp/oauth/register", `{"client_name":"Test Agent","redirect_uris":["http://127.0.0.1:4567/callback"],"token_endpoint_auth_method":"none"}`, "application/json", false)
	if registered.Code != 201 {
		t.Fatalf("register: %d %s", registered.Code, registered.Body.String())
	}
	var client struct {
		ClientID string `json:"client_id"`
	}
	if err := json.Unmarshal(registered.Body.Bytes(), &client); err != nil {
		t.Fatal(err)
	}
	verifier := strings.Repeat("v", 43)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	deniedBody, _ := json.Marshal(map[string]string{"client_id": client.ClientID, "redirect_uri": "http://127.0.0.1:4567/callback", "code_challenge": challenge, "code_challenge_method": "S256", "resource": publicOrigin + "/api/mcp", "response_type": "code", "scope": "mcp:tools", "state": "opaque-state", "decision": "deny"})
	denied := call("POST", "/api/mcp/oauth/consent", string(deniedBody), "application/json", true)
	var deniedResponse struct {
		Data struct {
			RedirectURL string `json:"redirectUrl"`
		} `json:"data"`
	}
	if denied.Code != 200 || json.Unmarshal(denied.Body.Bytes(), &deniedResponse) != nil {
		t.Fatalf("deny: %d %s", denied.Code, denied.Body.String())
	}
	deniedRedirect, err := url.Parse(deniedResponse.Data.RedirectURL)
	if err != nil || deniedRedirect.Query().Get("error") != "access_denied" || deniedRedirect.Query().Get("code") != "" || deniedRedirect.Query().Get("state") != "opaque-state" {
		t.Fatalf("deny callback: %s %v", deniedResponse.Data.RedirectURL, err)
	}
	consentBody, _ := json.Marshal(map[string]string{"client_id": client.ClientID, "redirect_uri": "http://127.0.0.1:4567/callback", "code_challenge": challenge, "code_challenge_method": "S256", "resource": publicOrigin + "/api/mcp", "response_type": "code", "scope": "mcp:tools", "state": "opaque-state"})
	consent := call("POST", "/api/mcp/oauth/consent", string(consentBody), "application/json", true)
	if consent.Code != 200 {
		t.Fatalf("consent: %d %s", consent.Code, consent.Body.String())
	}
	var response struct {
		Data struct {
			RedirectURL string `json:"redirectUrl"`
		} `json:"data"`
	}
	if err := json.Unmarshal(consent.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	redirect, err := url.Parse(response.Data.RedirectURL)
	if err != nil || redirect.Host != "127.0.0.1:4567" || redirect.Query().Get("state") != "opaque-state" {
		t.Fatalf("unsafe redirect: %s %v response=%s", response.Data.RedirectURL, err, consent.Body.String())
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {redirect.Query().Get("code")}, "client_id": {client.ClientID}, "redirect_uri": {"http://127.0.0.1:4567/callback"}, "code_verifier": {verifier}, "resource": {publicOrigin + "/api/mcp"}}
	token := call("POST", "/api/mcp/oauth/token", form.Encode(), "application/x-www-form-urlencoded", false)
	if token.Code != 200 || !strings.Contains(token.Body.String(), `"access_token":"yc_`) {
		t.Fatalf("token: %d %s", token.Code, token.Body.String())
	}
	var tokenResponse struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(token.Body.Bytes(), &tokenResponse); err != nil {
		t.Fatal(err)
	}
	mcpRequest := httptest.NewRequest(http.MethodPost, "/api/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`))
	mcpRequest.Header.Set("Authorization", "Bearer "+tokenResponse.AccessToken)
	mcpRequest.Header.Set("Content-Type", "application/json")
	mcpRequest.Header.Set("Accept", "application/json, text/event-stream")
	mcpRequest.Header.Set("MCP-Protocol-Version", "2025-06-18")
	mcpResponse := httptest.NewRecorder()
	router.ServeHTTP(mcpResponse, mcpRequest)
	if mcpResponse.Code != 200 || !strings.Contains(mcpResponse.Body.String(), `"create_video"`) {
		t.Fatalf("HTTP MCP tools: %d %s", mcpResponse.Code, mcpResponse.Body.String())
	}
	if replay := call("POST", "/api/mcp/oauth/token", form.Encode(), "application/x-www-form-urlencoded", false); replay.Code != 400 {
		t.Fatalf("code replay: %d", replay.Code)
	}
	keys := call("GET", "/api/auth/api-keys", "", "", true)
	if keys.Code != 200 || !strings.Contains(keys.Body.String(), `"kind":"mcp"`) || strings.Contains(keys.Body.String(), `"tokenHash"`) {
		t.Fatalf("key list: %d %s", keys.Code, keys.Body.String())
	}
}
