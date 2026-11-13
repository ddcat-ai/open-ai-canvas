package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func registerLive2DRoutes(r *gin.RouterGroup, svc *service.Service) {
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
			if !available || !enforceRateLimit(c, "live2d-upload:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
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
			var result *service.Live2DImport
			if admin {
				result, err = svc.UploadLive2D(actor, file)
			} else {
				result, err = svc.UploadPersonalLive2D(actor, file)
			}
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"model": result})
		}
	}
	r.POST("/admin/settings/appearance/live2d", upload(true))
	r.POST("/appearance/live2d", upload(false))
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
			var data []byte
			var mime string
			var err error
			name := strings.TrimPrefix(c.Param("file"), "/")
			if scope == "personal" {
				data, mime, err = svc.PersonalLive2DAsset(actor, c.Param("id"), name)
			} else {
				data, mime, err = svc.Live2DAsset(actor, c.Param("id"), name)
			}
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
	r.GET("/public/appearance/live2d/:id/*file", serve("public"))
	r.GET("/admin/settings/appearance/live2d/:id/*file", serve("admin"))
	r.GET("/appearance/live2d/:id/*file", serve("personal"))
}
