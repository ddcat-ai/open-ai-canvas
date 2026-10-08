// 管理端系统渠道与提示词模板接口。

package handler

import (
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func registerAdminChannelRoutes(r *gin.RouterGroup, svc *service.Service) {
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
