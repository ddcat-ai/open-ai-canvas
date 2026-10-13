package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestLoginLogsPasswordAndLogoutLifecycle(t *testing.T) {
	router, db, _ := profileHandlerFixture(t)
	rec := profileRequest(router, "POST", "/api/auth/login", `{"username":"profile-user","password":"old-password"}`, "")
	if rec.Code != 200 {
		t.Fatalf("login: %d %s", rec.Code, rec.Body.String())
	}
	var cookie string
	for _, c := range rec.Result().Cookies() {
		if c.Name == service.SessionCookieName {
			cookie = c.Value
		}
	}
	if cookie == "" {
		t.Fatal("missing session")
	}
	var logs []map[string]any
	if err := db.Table("login_logs").Order("created_at").Find(&logs).Error; err != nil {
		t.Fatal(err)
	}
	if len(logs) != 1 || logs[0]["event"] != "login" || logs[0]["result"] != "success" || logs[0]["method"] != "password" {
		t.Fatalf("login logs: %#v", logs)
	}
	for i := 0; i < 2; i++ {
		rec = profileRequest(router, "POST", "/api/auth/logout", "", cookie)
		if rec.Code != 200 {
			t.Fatalf("logout: %d %s", rec.Code, rec.Body.String())
		}
	}
	logs = nil
	if err := db.Table("login_logs").Order("created_at").Find(&logs).Error; err != nil {
		t.Fatal(err)
	}
	if len(logs) != 2 || logs[1]["event"] != "logout" || logs[0]["session_ref"] != logs[1]["session_ref"] {
		t.Fatalf("logout logs: %#v", logs)
	}
}

func TestLoginLogsForgedAndExpiredLogoutDoNotRevokeOrLog(t *testing.T) {
	router, db, cookie := profileHandlerFixture(t)
	for _, value := range []string{"profile-session.forged-token", "", "invalid"} {
		rec := profileRequest(router, "POST", "/api/auth/logout", "", value)
		if rec.Code != 200 {
			t.Fatalf("invalid logout: %d", rec.Code)
		}
	}
	var count int64
	db.Model(&model.AuthSession{}).Where("id = ?", "profile-session").Count(&count)
	if count != 1 {
		t.Fatal("forged token revoked a real session")
	}
	db.Model(&model.LoginLog{}).Count(&count)
	if count != 0 {
		t.Fatal("invalid logout generated success logs")
	}
	db.Model(&model.AuthSession{}).Where("id = ?", "profile-session").Update("expires_at", time.Now().Add(-time.Hour))
	profileRequest(router, "POST", "/api/auth/logout", "", cookie)
	db.Model(&model.LoginLog{}).Count(&count)
	if count != 0 {
		t.Fatal("expired session logged as active logout")
	}
}

func TestLoginLogsWriteFailureRollsBackSessionChanges(t *testing.T) {
	router, db, cookie := profileHandlerFixture(t)
	if err := db.Exec(`CREATE TRIGGER reject_success_login_log BEFORE INSERT ON login_logs WHEN NEW.result = 'success' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`).Error; err != nil {
		t.Fatal(err)
	}
	for _, req := range []struct{ path, body, cookie string }{
		{"/api/auth/login", `{"username":"profile-user","password":"old-password"}`, ""},
		{"/api/auth/logout", "", cookie},
	} {
		rec := profileRequest(router, "POST", req.path, req.body, req.cookie)
		if rec.Code != 500 {
			t.Fatalf("write failure %s: %d %s", req.path, rec.Code, rec.Body.String())
		}
		if len(rec.Result().Cookies()) != 0 {
			t.Fatal("failed auth changed session cookie")
		}
	}
	var count int64
	if err := db.Model(&model.AuthSession{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("session transaction: %d %v", count, err)
	}
	if err := db.Model(&model.LoginLog{}).Where("result = ?", "success").Count(&count).Error; err != nil || count != 0 {
		t.Fatal("failed operation logged as success")
	}
}

func TestLoginLogsRejectedJSONAndSessionRefresh(t *testing.T) {
	router, db, cookie := profileHandlerFixture(t)
	bad := profileRequest(router, "POST", "/api/auth/login", "{broken-json", "")
	if bad.Code != 400 {
		t.Fatalf("bad JSON: %d", bad.Code)
	}
	for i := 0; i < 2; i++ {
		profileRequest(router, "GET", "/api/auth/session", "", cookie)
	}
	var events []model.LoginLog
	if err := db.Find(&events).Error; err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Result != "failed" || events[0].Method != "password" || events[0].Account != "" {
		t.Fatalf("rejection/refresh: %#v", events)
	}
}

func TestLoginLogsAdminAccessAndFailedLogin(t *testing.T) {
	router, db, cookie := profileHandlerFixture(t)
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	RegisterAdminRoutes(router.Group("/api"), svc)
	for _, path := range []string{"/api/admin/login-logs", "/api/admin/login-logs/missing"} {
		if rec := profileRequest(router, "GET", path, "", ""); rec.Code != 401 {
			t.Fatalf("anonymous %s: %d", path, rec.Code)
		}
		if rec := profileRequest(router, "GET", path, "", cookie); rec.Code != 403 {
			t.Fatalf("member %s: %d", path, rec.Code)
		}
	}
	rec := profileRequest(router, "POST", "/api/auth/login", `{"username":"unknown@example.com","password":"never-store-this"}`, "")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("failed login: %d", rec.Code)
	}
	if err := db.Model(&model.User{}).Where("id = ?", "profile-user").Update("role", model.UserRoleAdmin).Error; err != nil {
		t.Fatal(err)
	}
	rec = profileRequest(router, "GET", "/api/admin/login-logs?result=failed&method=password", "", cookie)
	if rec.Code != 200 {
		t.Fatalf("admin: %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "never-store-this") || strings.Contains(rec.Body.String(), "unknown@example.com") {
		t.Fatal("sensitive login input exposed")
	}
	var body struct {
		Data struct {
			Logs []struct {
				ID     string  `json:"id"`
				UserID *string `json:"userId"`
			}
			Total int
		}
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Data.Total != 1 || len(body.Data.Logs) != 1 || body.Data.Logs[0].UserID != nil {
		t.Fatalf("failed page: %s", rec.Body.String())
	}
	detail := profileRequest(router, "GET", "/api/admin/login-logs/"+body.Data.Logs[0].ID, "", cookie)
	if detail.Code != 200 {
		t.Fatalf("detail: %d", detail.Code)
	}
	if bad := profileRequest(router, "GET", "/api/admin/login-logs?event=invalid", "", cookie); bad.Code != 400 {
		t.Fatalf("invalid filter: %d", bad.Code)
	}
	for _, query := range []string{"method=invalid", "result=invalid", "ip=invalid", "from=invalid", "from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z", "page=-1"} {
		if bad := profileRequest(router, "GET", "/api/admin/login-logs?"+query, "", cookie); bad.Code != 400 {
			t.Fatalf("invalid query %s: %d", query, bad.Code)
		}
	}
	if missing := profileRequest(router, "GET", "/api/admin/login-logs/missing", "", cookie); missing.Code != 404 {
		t.Fatalf("missing detail: %d", missing.Code)
	}
}
