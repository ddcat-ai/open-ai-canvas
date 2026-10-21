package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestInviteRoutesEnforceAuthenticationAndAdminRole(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.SystemSetting{},
		&model.AdminAuditEvent{}, &model.InviteRecord{}, &model.RewardAccount{},
		&model.InviteRewardRecord{}, &model.WithdrawRequest{}, &model.WithdrawAccount{},
		&model.TransferRecord{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	RegisterCanvasAPI(router.Group("/api"), svc)
	for _, user := range []model.User{
		{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		{ID: "member", Username: "member", Role: model.UserRoleUser, Status: model.UserStatusActive},
	} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.AuthSession{ID: "session-" + user.ID, UserID: user.ID, TokenHash: auth.HashToken("secret"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
	}
	request := func(method, path, body, userID string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "/api"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if userID != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "session-" + userID + ".secret"})
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		return recorder
	}
	for _, route := range []struct{ method, path, body string }{
		{http.MethodGet, "/invites/me/overview", ""},
		{http.MethodGet, "/invites/me/records", ""},
		{http.MethodGet, "/invites/me/withdrawals", ""},
		{http.MethodPost, "/invites/me/withdrawals", "{}"},
		{http.MethodGet, "/invites/me/withdraw-account", ""},
		{http.MethodPut, "/invites/me/withdraw-account", "{}"},
		{http.MethodGet, "/invites/me/transfers", ""},
		{http.MethodPost, "/invites/me/transfers", "{}"},
		{http.MethodGet, "/admin/settings/invite", ""},
		{http.MethodPatch, "/admin/settings/invite", "{}"},
		{http.MethodGet, "/admin/invites", ""},
		{http.MethodGet, "/admin/invites/member", ""},
		{http.MethodPost, "/admin/invites/member/approve", "{}"},
		{http.MethodPost, "/admin/invites/member/freeze", "{}"},
		{http.MethodPatch, "/admin/invites/member", "{}"},
		{http.MethodDelete, "/admin/invites/member", ""},
		{http.MethodGet, "/admin/withdrawals", ""},
		{http.MethodGet, "/admin/withdrawals/other-id", ""},
		{http.MethodPost, "/admin/withdrawals/other-id/approve", "{}"},
		{http.MethodPost, "/admin/withdrawals/other-id/reject", `{"reason":"No"}`},
	} {
		if response := request(route.method, route.path, route.body, ""); response.Code != http.StatusUnauthorized {
			t.Errorf("anonymous %s %s status=%d body=%s", route.method, route.path, response.Code, response.Body.String())
		}
		if strings.HasPrefix(route.path, "/admin/") {
			if response := request(route.method, route.path, route.body, "member"); response.Code != http.StatusForbidden {
				t.Errorf("member %s %s status=%d body=%s", route.method, route.path, response.Code, response.Body.String())
			}
		}
	}
	if response := request(http.MethodGet, "/invites/policy", "", ""); response.Code != http.StatusOK ||
		!strings.Contains(response.Body.String(), `"enabled":false`) ||
		!strings.Contains(response.Body.String(), `"withdrawEnabled":false`) ||
		!strings.Contains(response.Body.String(), `"transferEnabled":false`) {
		t.Fatalf("default public policy status=%d body=%s", response.Code, response.Body.String())
	}
}
