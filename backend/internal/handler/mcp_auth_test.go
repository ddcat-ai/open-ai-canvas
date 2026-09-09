package handler

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func newMCPHandlerTest(t *testing.T) (*gin.Engine, *service.Service, *model.User, string) {
	t.Helper()
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:mcp-handler-" + t.Name() + "?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.MCPDeviceSession{}, &model.MCPToken{}); err != nil {
		t.Fatal(err)
	}
	user := &model.User{ID: "cookie-user", Username: "cookie-user", Status: model.UserStatusActive}
	if err := db.Create(user).Error; err != nil {
		t.Fatal(err)
	}
	raw := "session-secret"
	sum := sha256.Sum256([]byte(raw))
	session := &model.AuthSession{ID: "cookie-session", UserID: user.ID, TokenHash: hex.EncodeToString(sum[:]), ExpiresAt: time.Now().Add(time.Hour)}
	if err := db.Create(session).Error; err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	svc := service.New(repository.New(db), t.TempDir())
	RegisterMCPAuthRoutes(r.Group("/api"), svc)
	RegisterMCPCanvasRoutes(r.Group("/api"), svc)
	return r, svc, user, session.ID + "." + raw
}

func TestMCPCanvasRoutesRejectMalformedBearer(t *testing.T) {
	r, _, _, _ := newMCPHandlerTest(t)
	paths := []string{
		"/api/mcp/projects",
		"/api/mcp/projects/canvas-1",
		"/api/mcp/projects/canvas-1/tools/validate",
		"/api/mcp/projects/canvas-1/tools/apply",
		"/api/mcp/projects/canvas-1/tools/generate",
	}
	for _, path := range paths {
		method := http.MethodGet
		if strings.Contains(path, "/tools/") {
			method = http.MethodPost
		}
		req := httptest.NewRequest(method, path, bytes.NewBufferString(`{}`))
		req.Header.Set("Authorization", "Bearer malformed")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("path %s status = %d body=%s", path, rec.Code, rec.Body.String())
		}
	}
}

func TestMCPHandlerApprovalIsCookieBoundAndEnvelopeHasHTTPStatus(t *testing.T) {
	r, svc, _, cookie := newMCPHandlerTest(t)
	created, err := svc.CreateMCPDeviceSession(service.CreateMCPDeviceSessionRequest{Scopes: []string{"canvas:read"}})
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"user_code":"` + created.UserCode + `","user_id":"attacker","approve":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/mcp/auth/device/ignored/approve", body)
	req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: cookie})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
		Msg  string         `json:"msg"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil || envelope.Code != 0 || envelope.Data["status"] != "approved" {
		t.Fatalf("envelope = %#v, err=%v", envelope, err)
	}
}

func TestMCPHandlerRejectsMalformedBearerWithEnvelope(t *testing.T) {
	r, _, _, _ := newMCPHandlerTest(t)
	for _, header := range []string{"", "Basic abc", "Bearer", "Bearer a b", "Bearer\tabc"} {
		req := httptest.NewRequest(http.MethodPost, "/api/mcp/auth/revoke", nil)
		req.Header.Set("Authorization", header)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("header %q status = %d body=%s", header, rec.Code, rec.Body.String())
		}
	}
}

func TestMCPHandlerApprovalRequiresCookie(t *testing.T) {
	r, svc, _, _ := newMCPHandlerTest(t)
	created, err := svc.CreateMCPDeviceSession(service.CreateMCPDeviceSessionRequest{Scopes: []string{"canvas:read"}})
	if err != nil {
		t.Fatal(err)
	}
	body := bytes.NewBufferString(`{"user_code":"` + created.UserCode + `","approve":true}`)
	req := httptest.NewRequest(http.MethodPost, "/api/mcp/auth/device/"+created.UserCode+"/approve", body)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var envelope map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil || envelope["code"] != float64(http.StatusUnauthorized) || envelope["data"] != nil {
		t.Fatalf("envelope = %#v, err=%v", envelope, err)
	}
}

func TestMCPRequireTokenChecksScope(t *testing.T) {
	r, svc, user, _ := newMCPHandlerTest(t)
	device, err := svc.CreateMCPDeviceSession(service.CreateMCPDeviceSessionRequest{Scopes: []string{"canvas:read"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApproveMCPDeviceSession(user.ID, device.UserCode, true); err != nil {
		t.Fatal(err)
	}
	pair, err := svc.ExchangeMCPDeviceToken(device.DeviceCode)
	if err != nil {
		t.Fatal(err)
	}
	r.GET("/api/mcp/test/read", func(c *gin.Context) {
		principal, err := RequireMCPToken(c, svc, "canvas:read")
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"userId": principal.UserID})
	})
	r.GET("/api/mcp/test/write", func(c *gin.Context) {
		if _, err := RequireMCPToken(c, svc, "canvas:write"); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	for path, want := range map[string]int{"/api/mcp/test/read": http.StatusOK, "/api/mcp/test/write": http.StatusForbidden} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Fatalf("%s status = %d body=%s", path, rec.Code, rec.Body.String())
		}
	}
}
