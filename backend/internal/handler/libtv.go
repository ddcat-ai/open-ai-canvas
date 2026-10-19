package handler

import (
	"net/http"
	"strings"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterLibTVRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/libtv/gallery", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if user == nil {
			failService(c, service.Unauthorized("请先登录"))
			return
		}
		var req service.LibTVGalleryRequest
		if err := c.ShouldBindQuery(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.LibTVGallery(c.Request.Context(), user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/libtv/works/:uuid", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.LibTVWork(c.Request.Context(), user, c.Param("uuid"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/canvas-projects/:id/import/libtv-template", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if user == nil {
			failService(c, service.Unauthorized("请先登录"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.LibTVImportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ImportLibTVTemplate(c.Request.Context(), user.ID, c.Param("id"), req.UUID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/settings/libtv", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.AdminLibTVSetting(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	r.PATCH("/admin/settings/libtv", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.LibTVSettingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		setting, err := svc.UpdateLibTVSetting(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	r.POST("/admin/settings/libtv/test", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.LibTVImportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.TestLibTV(user, strings.TrimSpace(req.UUID)); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	r.POST("/canvas-projects/:id/import/libtv", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if user == nil {
			failService(c, service.Unauthorized("请先登录"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.LibTVImportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ImportLibTV(user.ID, c.Param("id"), strings.TrimSpace(req.UUID))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
