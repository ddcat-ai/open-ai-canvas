package handler

import (
	"io"
	"net/http"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAppearanceRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/public/appearance", func(c *gin.Context) {
		setting, err := svc.Appearance()
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"appearance": setting})
	})

	r.GET("/public/appearance/assets/:slot", func(c *gin.Context) {
		stream, err := svc.OpenAppearanceAsset(c.Param("slot"), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		defer stream.Body.Close()
		resource := stream.Resource
		mimeType := resource.MimeType
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		if c.Query("v") != "" {
			c.Header("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			c.Header("Cache-Control", "public, no-cache")
		}
		c.Header("Accept-Ranges", "bytes")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("X-Content-Type-Options", "nosniff")
		if stream.ContentRange != "" {
			c.Header("Content-Range", stream.ContentRange)
		}
		if seeker, available := stream.Body.(io.ReadSeeker); available {
			c.Header("Content-Type", mimeType)
			http.ServeContent(c.Writer, c.Request, resource.ID, resource.UpdatedAt, seeker)
			return
		}
		c.DataFromReader(stream.StatusCode, stream.ContentLength, mimeType, stream.Body, nil)
	})

	r.GET("/admin/settings/appearance", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.AdminAppearance(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})

	r.PATCH("/admin/settings/appearance", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		current, err := svc.AdminAppearance(actor)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		req := current.AppearanceSetting
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		setting, err := svc.UpdateAppearance(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})

	r.DELETE("/admin/settings/appearance", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.ResetAppearance(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})

	r.POST("/admin/settings/appearance/assets/:slot", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "admin-appearance-upload:"+actor.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		maxBytes, err := service.AppearanceAssetMaxBytes(c.Param("slot"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes+(1<<20))
		file, err := c.FormFile("file")
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		resource, err := svc.UploadAppearanceAsset(actor, c.Param("slot"), file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resource": resource})
	})
}
