// 管理端 Antigravity 渠道接口：安装官方 agy、登录方式、Google 登录与退出。

package handler

import (
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func registerAdminAntigravityRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/admin/antigravity/runtime/install", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		runtime, err := svc.InstallAdminAntigravityRuntime(c.Request.Context(), user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"runtime": runtime})
	})
	r.GET("/admin/channels/:id/antigravity", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		status, err := svc.AdminAntigravityStatus(c.Request.Context(), user, c.Param("id"), c.Query("refresh") == "1")
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"antigravity": status})
	})
	r.PUT("/admin/channels/:id/antigravity/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.AntigravitySettingsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		status, err := svc.SaveAdminAntigravitySettings(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"antigravity": status})
	})
	r.POST("/admin/channels/:id/antigravity/login", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		status, err := svc.StartAdminAntigravityLogin(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"antigravity": status})
	})
	r.POST("/admin/channels/:id/antigravity/login/code", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.AntigravityLoginCodeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		status, err := svc.SubmitAdminAntigravityLoginCode(c.Request.Context(), user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"antigravity": status})
	})
	r.POST("/admin/channels/:id/antigravity/login/cancel", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		status, err := svc.CancelAdminAntigravityLogin(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"antigravity": status})
	})
	r.POST("/admin/channels/:id/antigravity/logout", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		status, err := svc.LogoutAdminAntigravity(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"antigravity": status})
	})
}
