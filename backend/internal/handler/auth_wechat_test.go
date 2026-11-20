package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
)

func TestWechatRoutesRejectMissingBrowserStateAnonymousBindingAndNonAdminSettings(t *testing.T) {
	router, db, cookie := profileHandlerFixture(t)
	for _, path := range []string{"/api/auth/profile/wechat/bind", "/api/auth/profile/wechat/start", "/api/admin/settings/wechat"} {
		if response := profileRequest(router, "GET", path, "", ""); response.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous %s returned %d", path, response.Code)
		}
	}
	if response := profileRequest(router, "GET", "/api/admin/settings/wechat", "", cookie); response.Code != http.StatusForbidden {
		t.Fatalf("non-admin read status=%d", response.Code)
	}
	if response := profileRequest(router, "PATCH", "/api/admin/settings/wechat", `{"enabled":false}`, cookie); response.Code != http.StatusForbidden {
		t.Fatalf("non-admin write status=%d", response.Code)
	}
	response := profileRequest(router, "GET", "/api/auth/wechat/callback?state=attacker&code=code", "", cookie)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("missing state cookie returned %d", response.Code)
	}
	var count int64
	db.Model(&model.UserIdentity{}).Count(&count)
	if count != 0 {
		t.Fatal("untrusted callback wrote identity")
	}
}

func TestWechatStateCookiesAreHttpOnlySecureAndHostScoped(t *testing.T) {
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	setWechatCookie(ctx, wechatStateCookie, "random-state", 600)
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatal("missing cookie")
	}
	cookie := cookies[0]
	if !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Domain != "" || cookie.Path != "/" || cookie.MaxAge != 600 {
		t.Fatalf("unsafe cookie %#v", cookie)
	}
}
