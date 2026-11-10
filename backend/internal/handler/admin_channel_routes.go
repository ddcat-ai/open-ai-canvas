// 管理端系统渠道与提示词模板接口。

package handler

import (
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func registerAdminChannelRoutes(r *gin.RouterGroup, svc *service.Service) {
	registerChannelWebsiteRoutes(r, svc)
	r.GET("/admin/channels", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		channels, err := svc.AdminSystemChannelPage(user, service.AdminListQuery{Keyword: c.Query("keyword"), Status: c.Query("status"), Page: page, Limit: limit})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, channels)
	})
	r.POST("/admin/channels", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.ChannelRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		channel, err := svc.CreateSystemChannel(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channel": channel})
	})
	r.POST("/admin/channels/:id/duplicate", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		channel, err := svc.DuplicateSystemChannel(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channel": channel})
	})
	r.PATCH("/admin/channels/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.ChannelRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		channel, err := svc.UpdateSystemChannel(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channel": channel})
	})
	r.DELETE("/admin/channels/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteSystemChannel(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	// 导出不含任何密钥；ids 为空时导出全部系统渠道。
	r.POST("/admin/channels/export", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req struct {
			IDs []string `json:"ids"`
		}
		if c.Request.ContentLength != 0 {
			if err := c.ShouldBindJSON(&req); err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
		}
		exported, err := svc.ExportSystemChannels(user, req.IDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, exported)
	})
	r.POST("/admin/channels/import", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<20)
		var req service.SystemChannelExport
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ImportSystemChannels(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/provider-catalog", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.AdminProviderCatalog(c.Request.Context(), user, false)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.POST("/admin/provider-catalog/refresh", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.AdminProviderCatalog(c.Request.Context(), user, true)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.POST("/admin/provider-catalog/:id/verify", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.ProviderCatalogVerifyRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.VerifyProviderCatalogKey(c.Request.Context(), user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/provider-catalog/:id/install", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.ProviderCatalogInstallRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		channel, err := svc.InstallProviderCatalog(c.Request.Context(), user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channel": channel})
	})
	r.GET("/admin/prompt-templates", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		templates, definitions, err := svc.AdminPromptTemplates(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"templates": templates, "definitions": definitions})
	})
	r.POST("/admin/prompt-templates", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.PromptTemplateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		template, err := svc.CreatePromptTemplate(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"template": template})
	})
	r.PATCH("/admin/prompt-templates/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.PromptTemplateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		template, err := svc.UpdatePromptTemplate(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"template": template})
	})
	r.DELETE("/admin/prompt-templates/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeletePromptTemplate(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
}
