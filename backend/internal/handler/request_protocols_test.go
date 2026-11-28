package handler

import (
	"encoding/json"
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
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestRequestProtocolHTTPAuthorizationAndPersistence(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.ChannelModel{}, &model.PluginPlatformState{}, &model.SystemSetting{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
		id := string(role)
		if err := db.Create(&model.User{ID: id, Username: id, Role: role, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("fixture"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	r := gin.New()
	registerRequestProtocolRoutes(r.Group("/api"), svc)
	check := `{"manifest":{"apiVersion":"yingce.plugin/v2","id":"example","name":"HTTP 协议验收","version":"1.0.0","runtime":{"backend":"declarative"},"contributes":{"providers":[{"id":"example","label":"HTTP 协议验收","capabilities":["video"],"scopes":["admin.system-channel"],"auth":{"type":"bearer","field":"apiKey"},"create":{"method":"POST","path":"/v1/tasks","body":{"model":{"$ref":"request.model"}}},"response":{"status":{"$ref":"response.status"},"videos":{"$ref":"response.video_url"}}}]}},"request":{"model":"video"},"phase":"create","response":{"status":"completed","video_url":"https://example.com/result.mp4"}}`
	call := func(role, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/admin/request-protocols"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if role != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: role + ".fixture"})
		}
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec
	}
	publishV1 := `{"id":"http-test","expectedSha256":"","check":` + check + "}"
	for _, endpoint := range []struct{ method, path, body string }{{"GET", "", ""}, {"POST", "/check", check}, {"POST", "", publishV1}} {
		for _, role := range []string{"", "user"} {
			rec := call(role, endpoint.method, endpoint.path, endpoint.body)
			want := http.StatusForbidden
			if role == "" {
				want = http.StatusUnauthorized
			}
			if rec.Code != want {
				t.Fatalf("%s %s role=%q: status=%d body=%s", endpoint.method, endpoint.path, role, rec.Code, rec.Body)
			}
		}
	}
	if rec := call("admin", "POST", "/check", check); rec.Code != http.StatusOK {
		t.Fatalf("POST /check: status=%d body=%s", rec.Code, rec.Body)
	}
	pubRec := call("admin", "POST", "", publishV1)
	if pubRec.Code != http.StatusOK {
		t.Fatalf("POST publish v1: status=%d body=%s", pubRec.Code, pubRec.Body)
	}
	var pubEnvelope struct {
		Code int `json:"code"`
		Data struct {
			Protocol struct {
				ID      string `json:"id"`
				Version string `json:"version"`
				SHA256  string `json:"sha256"`
			} `json:"protocol"`
		} `json:"data"`
	}
	if err := json.Unmarshal(pubRec.Body.Bytes(), &pubEnvelope); err != nil || pubEnvelope.Code != 0 || pubEnvelope.Data.Protocol.Version != "1.0.0" || pubEnvelope.Data.Protocol.SHA256 == "" {
		t.Fatalf("unexpected publish envelope: %s", pubRec.Body)
	}
	if rec := call("admin", "GET", "", ""); rec.Code != http.StatusOK {
		t.Fatalf("GET list: status=%d body=%s", rec.Code, rec.Body)
	}
	// Duplicate publish with empty expectedSha256 must conflict with 409.
	if conflict := call("admin", "POST", "", publishV1); conflict.Code != http.StatusConflict {
		t.Fatalf("stale publication: %d %s", conflict.Code, conflict.Body)
	}
	// Publishing v2 with current sha256 succeeds.
	publishV2 := `{"id":"http-test","expectedSha256":"` + pubEnvelope.Data.Protocol.SHA256 + `","check":` + check + "}"
	pubV2Rec := call("admin", "POST", "", publishV2)
	if pubV2Rec.Code != http.StatusOK {
		t.Fatalf("POST publish v2: status=%d body=%s", pubV2Rec.Code, pubV2Rec.Body)
	}
	for _, path := range []string{"", "/check"} {
		rec := call("admin", "POST", path, "{")
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("malformed body for %q returned %d", path, rec.Code)
		}
	}
	invalidCheck := call("admin", "POST", "/check", "{}")
	if invalidCheck.Code != http.StatusBadRequest {
		t.Fatalf("invalid definition returned %d", invalidCheck.Code)
	}
}
