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
	upload := func(admin bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			if admin {
				if err := svc.RequireAdmin(actor); err != nil {
					failService(c, err)
					return
				}
			}
			policy, available := loadRuntimePolicy(c, svc)
			if !available || !enforceRateLimit(c, "avatar-bundle-upload:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
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
			var result *service.AgentAvatarBundleImport
			if admin {
				result, err = svc.UploadAgentAvatarBundle(actor, file)
			} else {
				result, err = svc.UploadPersonalAgentAvatarBundle(actor, file)
			}
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"bundle": result})
		}
	}
	r.POST("/admin/settings/appearance/avatar-bundles", upload(true))
	r.POST("/appearance/avatar-bundles", upload(false))

	serve := func(scope string) gin.HandlerFunc {
		return func(c *gin.Context) {
			var actor *model.User
			if scope != "public" {
				var err error
				actor, err = currentUser(c, svc)
				if err != nil {
					failService(c, err)
					return
				}
				if scope == "admin" {
					if err := svc.RequireAdmin(actor); err != nil {
						failService(c, err)
						return
					}
				}
			}
			name := strings.TrimPrefix(c.Param("file"), "/")
			var data []byte
			var mimeType string
			var err error
			if scope == "personal" {
				data, mimeType, err = svc.PersonalAgentAvatarBundleAsset(actor, c.Param("id"), name)
			} else {
				data, mimeType, err = svc.AgentAvatarBundleAsset(actor, c.Param("id"), name)
			}
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("X-Content-Type-Options", "nosniff")
			c.Header("Content-Security-Policy", "default-src 'none'; media-src 'self'")
			c.Header("Content-Type", mimeType)
			if scope != "public" {
				c.Header("Cache-Control", "private, no-store")
			} else {
				c.Header("Cache-Control", "public, max-age=31536000, immutable")
			}
			http.ServeContent(c.Writer, c.Request, name, time.Time{}, bytes.NewReader(data))
		}
	}
	r.GET("/public/appearance/avatar/:id/*file", serve("public"))
	r.GET("/admin/settings/appearance/avatar/:id/*file", serve("admin"))
	r.GET("/appearance/avatar/:id/*file", serve("personal"))
}
