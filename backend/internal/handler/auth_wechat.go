package handler

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

const wechatStateCookie = "__Host-yingce-wechat-state"
const wechatRegistrationCookie = "__Host-yingce-wechat-registration"

func setWechatCookie(c *gin.Context, name, value string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: maxAge, HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode})
}

func wechatCookieValue(c *gin.Context, name string) string { value, _ := c.Cookie(name); return value }

func wechatRequest(c *gin.Context) bool {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	if c.GetHeader("Sec-Fetch-Site") == "cross-site" {
		failService(c, kernel.Forbidden("请从本站发起微信登录操作"))
		return false
	}
	return true
}

func registerWechatRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/settings/wechat", func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.AdminWechatSetting(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	r.PATCH("/admin/settings/wechat", func(c *gin.Context) {
		if !wechatRequest(c) {
			return
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.WechatSettingRequest
		if c.ShouldBindJSON(&req) != nil {
			failService(c, kernel.BadAuthRequest("微信登录配置参数无效"))
			return
		}
		setting, err := svc.UpdateWechatSetting(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	start := func(purpose string) gin.HandlerFunc {
		return func(c *gin.Context) {
			if !wechatRequest(c) || !enforceRateLimit(c, "wechat-"+purpose+":"+c.ClientIP(), 20, 10*time.Minute) {
				return
			}
			var user *model.User
			if purpose != "login" {
				var err error
				user, err = currentUser(c, svc)
				if err != nil {
					failService(c, err)
					return
				}
			}
			target, state, err := svc.BeginWechatAuthorization(user, sessionCookie(c), c.Query("next"), purpose, c.Query("acceptedTerms") == "true")
			if err != nil {
				failService(c, err)
				return
			}
			setWechatCookie(c, wechatStateCookie, state, 600)
			c.Redirect(http.StatusFound, target)
		}
	}
	r.GET("/auth/wechat/start", start("login"))
	r.GET("/auth/profile/wechat/bind", start("bind"))
	r.GET("/auth/profile/wechat/start", start("reauth"))
	r.GET("/auth/wechat/callback", rejectedLoginAudit(svc, "wechat"), func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		if !enforceRateLimit(c, "wechat-callback:"+c.ClientIP(), 30, 10*time.Minute) {
			return
		}
		state := c.Query("state")
		browserState := wechatCookieValue(c, wechatStateCookie)
		if state == "" || browserState == "" || subtle.ConstantTimeCompare([]byte(state), []byte(browserState)) != 1 {
			failService(c, kernel.BadAuthRequest("微信登录状态与当前浏览器不匹配，请重新发起授权"))
			return
		}
		setWechatCookie(c, wechatStateCookie, "", -1)
		c.Set("login_audit_handled", true)
		result, err := svc.CompleteWechatLogin(c.Request.Context(), state, c.Query("code"), sessionCookie(c), loginRequestContext(c))
		if err != nil {
			if result != nil && result.ProfileOperation != "" {
				c.Redirect(http.StatusFound, "/settings?section=profile&"+result.ProfileOperation+"=error")
				return
			}
			message := "微信登录失败，请重试"
			var appErr *kernel.AppError
			if errors.As(err, &appErr) {
				message = appErr.Message
			}
			c.Redirect(http.StatusFound, "/login?oauth_error="+url.QueryEscape(message))
			return
		}
		if result.Session != nil {
			setSessionCookie(c, result.Session.Session, result.Session.MaxAgeSecs)
		}
		if result.RegistrationToken != "" {
			setWechatCookie(c, wechatRegistrationCookie, result.RegistrationToken, 600)
		}
		c.Redirect(http.StatusFound, result.Next)
	})
	r.GET("/auth/wechat/registration", func(c *gin.Context) {
		if !wechatRequest(c) || !enforceRateLimit(c, "wechat-registration-read:"+c.ClientIP(), 30, 10*time.Minute) {
			return
		}
		result, err := svc.WechatRegistration(wechatCookieValue(c, wechatRegistrationCookie))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.DELETE("/auth/wechat/registration", func(c *gin.Context) {
		if !wechatRequest(c) {
			return
		}
		setWechatCookie(c, wechatRegistrationCookie, "", -1)
		ok(c, gin.H{"cleared": true})
	})
	r.POST("/auth/wechat/registration", rejectedLoginAudit(svc, "wechat"), func(c *gin.Context) {
		if !wechatRequest(c) {
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "register:"+c.ClientIP(), policy.Request.RegisterPerHour, time.Hour) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.RegisterRequest
		if c.ShouldBindJSON(&req) != nil {
			failService(c, kernel.BadAuthRequest("微信注册参数无效"))
			return
		}
		ticket := wechatCookieValue(c, wechatRegistrationCookie)
		info, err := svc.WechatRegistration(ticket)
		if err != nil {
			failService(c, err)
			return
		}
		req.LoginContext = loginRequestContext(c)
		req.Context = c.Request.Context()
		result, err := svc.CompleteWechatRegistration(ticket, req)
		if err != nil {
			failService(c, err)
			return
		}
		setWechatCookie(c, wechatRegistrationCookie, "", -1)
		setSessionCookie(c, result.Session, result.MaxAgeSecs)
		ok(c, gin.H{"user": result.User, "next": info.Next})
	})
}
