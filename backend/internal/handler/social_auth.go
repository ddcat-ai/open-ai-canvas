package handler

import (
	"net/http"
	"net/url"
	"time"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterSocialAuthRoutes mounts all public and administrative social auth endpoints.
func RegisterSocialAuthRoutes(api *gin.RouterGroup, svc *service.Service) {
	// 1. Public endpoints
	api.GET("/auth/social/providers", func(c *gin.Context) {
		res, err := svc.PublicSocialAuthProviders(c.Request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, res)
	})

	api.GET("/auth/social/:provider/start", func(c *gin.Context) {
		provider := c.Param("provider")
		if !enforceRateLimit(c, "social-start:"+provider+":"+c.ClientIP(), 30, 10*time.Minute) {
			return
		}
		nextPath := c.Query("next")
		acceptedTerms := c.Query("acceptedTerms") == "true"
		isMock := c.Query("mock") == "true"

		target, err := svc.BeginSocialAuth(c.Request, provider, nextPath, acceptedTerms, isMock)
		if err != nil {
			failService(c, err)
			return
		}
		c.Redirect(http.StatusFound, target)
	})

	callbackHandler := func(c *gin.Context, provider string) {
		if !enforceRateLimit(c, "social-cb:"+provider+":"+c.ClientIP(), 60, 10*time.Minute) {
			return
		}
		state := c.Query("state")
		code := c.Query("code")

		result, err := svc.CompleteSocialAuth(c.Request, provider, state, code, sessionCookie(c), loginRequestContext(c))
		if err != nil {
			redirectTarget := "/login?oauth_error=" + url.QueryEscape(err.Error())
			if c.Query("lang") == "zh" || c.GetHeader("Referer") != "" && urlContains(c.GetHeader("Referer"), "/zh/login") {
				redirectTarget = "/zh/login?oauth_error=" + url.QueryEscape(err.Error())
			}
			c.Redirect(http.StatusFound, redirectTarget)
			return
		}

		setSessionCookie(c, result.Session.Session, result.Session.MaxAgeSecs)
		c.Redirect(http.StatusFound, result.Next)
	}

	api.GET("/auth/social/:provider/callback", func(c *gin.Context) {
		callbackHandler(c, c.Param("provider"))
	})

	// Compatibility callback routes matching existing provider registration URLs
	api.GET("/auth/qq/callback", func(c *gin.Context) {
		callbackHandler(c, "qq")
	})
	api.GET("/auth/oauth/wechat/callback", func(c *gin.Context) {
		callbackHandler(c, "wechat")
	})
	api.GET("/auth/oauth/douyin/callback", func(c *gin.Context) {
		callbackHandler(c, "douyin")
	})
	api.GET("/auth/oauth/bilibili/callback", func(c *gin.Context) {
		callbackHandler(c, "bilibili")
	})

	// 2. Mock callback test harness JSON endpoint
	api.POST("/auth/social/mock-callback", func(c *gin.Context) {
		var req struct {
			Provider string `json:"provider"`
			State    string `json:"state"`
			Code     string `json:"code"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.CompleteSocialAuth(c.Request, req.Provider, req.State, req.Code, sessionCookie(c), loginRequestContext(c))
		if err != nil {
			failService(c, err)
			return
		}
		setSessionCookie(c, result.Session.Session, result.Session.MaxAgeSecs)
		ok(c, gin.H{
			"user":  result.User,
			"next":  result.Next,
			"isNew": result.IsNew,
		})
	})

	// 3. Admin Social Login Config Center endpoints
	admin := api.Group("/admin/social-auth")
	{
		admin.GET("/settings", func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			view, err := svc.SocialAuthAdminSettings(c.Request, actor)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, view)
		})

		admin.PUT("/settings", func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			var req service.SocialAuthSettingsUpdateRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			view, err := svc.UpdateSocialAuthAdminSettings(c.Request, actor, req)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, view)
		})

		admin.POST("/test/:provider", func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			result, err := svc.TestSocialAuthProvider(actor, c.Param("provider"))
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, result)
		})
	}
}

func urlContains(rawURL string, substr string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	return u.Path == substr || u.Path == substr+"/"
}
