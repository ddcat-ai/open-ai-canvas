package handler

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/service"
)

const oidcStateCookie = "__Host-yingce-oidc-state"

func registerOIDCRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/auth/oidc/start", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		if c.GetHeader("Sec-Fetch-Site") == "cross-site" {
			failService(c, kernel.Forbidden("请从影策登录页发起 OIDC 登录"))
			return
		}
		if !enforceRateLimit(c, "oidc-start:"+c.ClientIP(), 20, 10*time.Minute) {
			return
		}
		target, state, err := svc.BeginOIDCLogin(c.Request.Context(), c.Query("next"), c.Query("acceptedTerms") == "true")
		if err != nil {
			failService(c, err)
			return
		}
		setOIDCStateCookie(c, state, 600)
		c.Redirect(http.StatusFound, target)
	})
	r.GET("/auth/oidc/callback", rejectedLoginAudit(svc, "oidc"), func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		if !enforceRateLimit(c, "oidc-callback:"+c.ClientIP(), 30, 10*time.Minute) {
			return
		}
		state := c.Query("state")
		cookie, err := c.Request.Cookie(oidcStateCookie)
		if err != nil || state == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(state)) != 1 {
			failService(c, kernel.BadAuthRequest("OIDC 登录状态与当前浏览器不匹配，请重新登录"))
			return
		}
		setOIDCStateCookie(c, "", -1)
		c.Set("login_audit_handled", true)
		result, err := svc.CompleteOIDCLogin(c.Request.Context(), state, c.Query("code"), loginRequestContext(c))
		if err != nil {
			message := "OIDC 登录失败，请重试"
			var appErr *kernel.AppError
			if errors.As(err, &appErr) {
				message = appErr.Message
			}
			c.Redirect(http.StatusFound, "/login?oauth_error="+url.QueryEscape(message))
			return
		}
		setSessionCookie(c, result.Session.Session, result.Session.MaxAgeSecs)
		c.Redirect(http.StatusFound, result.Next)
	})
}

// 回调只能使用发起登录的浏览器中保存的状态，避免登录 CSRF。
func setOIDCStateCookie(c *gin.Context, value string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: oidcStateCookie, Value: value, Path: "/",
		MaxAge: maxAge, HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode,
	})
}
