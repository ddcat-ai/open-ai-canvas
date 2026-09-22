package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"
)

func registerLive2DRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/admin/settings/appearance/live2d", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "admin-live2d-upload:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.Live2DMaxBytes+(1<<20))
		file, err := c.FormFile("file")
		if c.Request.MultipartForm != nil {
			defer c.Request.MultipartForm.RemoveAll()
		}
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.UploadLive2D(actor, file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"model": result})
	})
	serve := func(admin bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			var actor *model.User
			if admin {
				var err error
				actor, err = currentUser(c, svc)
				if err != nil {
					failService(c, err)
					return
				}
				if err := svc.RequireAdmin(actor); err != nil {
					failService(c, err)
					return
				}
			}
			data, mime, err := svc.Live2DAsset(actor, c.Param("id"), strings.TrimPrefix(c.Param("file"), "/"))
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("X-Content-Type-Options", "nosniff")
			c.Header("Cache-Control", "private, no-cache")
			c.Header("Content-Security-Policy", "default-src 'none'")
			c.Data(http.StatusOK, mime, data)
		}
	}
	r.GET("/public/appearance/live2d/:id/*file", serve(false))
	r.GET("/admin/settings/appearance/live2d/:id/*file", serve(true))
}
