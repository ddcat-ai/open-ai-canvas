package handler

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func registerSpriteRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/admin/settings/appearance/sprite", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err = svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "admin-sprite-upload:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.SpriteMaxBytes+(1<<20))
		file, err := c.FormFile("file")
		if c.Request.MultipartForm != nil {
			defer c.Request.MultipartForm.RemoveAll()
		}
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.UploadSpritePet(actor, file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"pet": result})
	})
	serve := func(admin, thumbnail bool) gin.HandlerFunc {
		return func(c *gin.Context) {
			var actor *model.User
			if admin {
				var err error
				actor, err = currentUser(c, svc)
				if err != nil {
					failService(c, err)
					return
				}
				if err = svc.RequireAdmin(actor); err != nil {
					failService(c, err)
					return
				}
			}
			var data []byte
			var mime string
			var err error
			if thumbnail {
				var params [3]int
				for i, key := range []string{"w", "h", "frame"} {
					params[i], err = strconv.Atoi(c.Query(key))
					if err != nil {
						fail(c, http.StatusBadRequest, fmt.Errorf("缩略图帧参数无效"))
						return
					}
				}
				data, mime, err = svc.SpriteThumbnail(actor, c.Param("id"), params[0], params[1], params[2])
			} else {
				data, mime, err = svc.SpriteAsset(actor, c.Param("id"))
			}
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("X-Content-Type-Options", "nosniff")
			c.Header("Cache-Control", "private, no-cache")
			c.Header("Content-Security-Policy", "default-src 'none'")
			etag := fmt.Sprintf("\"%x\"", sha256.Sum256(data))
			c.Header("ETag", etag)
			for _, candidate := range strings.Split(c.GetHeader("If-None-Match"), ",") {
				if strings.TrimPrefix(strings.TrimSpace(candidate), "W/") == etag || strings.TrimSpace(candidate) == "*" {
					c.Status(http.StatusNotModified)
					return
				}
			}
			c.Data(http.StatusOK, mime, data)
		}
	}
	r.GET("/public/appearance/sprite/:id", serve(false, false))
	r.GET("/admin/settings/appearance/sprite/:id", serve(true, false))
	r.GET("/public/appearance/sprite/:id/thumbnail", serve(false, true))
	r.GET("/admin/settings/appearance/sprite/:id/thumbnail", serve(true, true))
}
