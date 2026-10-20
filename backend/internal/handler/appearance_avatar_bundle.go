package handler

import (
	"bytes"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func registerAgentAvatarBundleRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/admin/settings/appearance/avatar-bundles", func(c *gin.Context) {
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
		if !available || !enforceRateLimit(c, "admin-avatar-bundle-upload:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.AgentAvatarBundleMaxBytes+(1<<20))
		file, err := c.FormFile("file")
		if c.Request.MultipartForm != nil {
			defer c.Request.MultipartForm.RemoveAll()
		}
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.UploadAgentAvatarBundle(actor, file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"bundle": result})
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
			name := strings.TrimPrefix(c.Param("file"), "/")
			data, mimeType, err := svc.AgentAvatarBundleAsset(actor, c.Param("id"), name)
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("X-Content-Type-Options", "nosniff")
			c.Header("Content-Security-Policy", "default-src 'none'; media-src 'self'")
			c.Header("Content-Type", mimeType)
			if admin {
				c.Header("Cache-Control", "private, no-store")
			} else {
				c.Header("Cache-Control", "public, max-age=31536000, immutable")
			}
			http.ServeContent(c.Writer, c.Request, name, time.Time{}, bytes.NewReader(data))
		}
	}
	r.GET("/public/appearance/avatar/:id/*file", serve(false))
	r.GET("/admin/settings/appearance/avatar/:id/*file", serve(true))
}
