package handler

import (
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/service"
)

func registerBrowserResourceRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/resources/:id/generated-upload", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "resources-upload:"+user.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var input service.BrowserResourceUploadInput
		if err := c.ShouldBindJSON(&input); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.BeginGeneratedResourceUpload(user.ID, c.Param("id"), input)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, result)
	})
	r.POST("/resources/:id/generated-upload/:uploadId/complete", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		resource, err := svc.CompleteGeneratedResourceUpload(user.ID, c.Param("id"), c.Param("uploadId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resource": resource})
	})
	r.POST("/resources/:id/generated-upload/:uploadId/fallback", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		uploadID := c.Param("uploadId")
		if uploadID == "none" {
			uploadID = ""
		}
		if err := svc.RequestGeneratedResourceFallback(user.ID, c.Param("id"), uploadID); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	for _, operation := range []string{"begin", "complete"} {
		r.POST("/resources/:id/thumbnail-upload/"+operation, func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			policy, available := loadRuntimePolicy(c, svc)
			if !available || !enforceRateLimit(c, "resources-upload:"+user.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
				return
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
			var input service.BrowserResourceUploadInput
			if err := c.ShouldBindJSON(&input); err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			c.Header("Cache-Control", "private, no-store")
			if operation == "begin" {
				result, err := svc.BeginBrowserThumbnailUpload(user.ID, c.Param("id"), input)
				if err != nil {
					failService(c, err)
					return
				}
				ok(c, result)
			} else {
				resource, err := svc.CompleteBrowserThumbnailUpload(user.ID, c.Param("id"), input)
				if err != nil {
					failService(c, err)
					return
				}
				ok(c, gin.H{"resource": resource})
			}
		})
	}
	r.POST("/resources/uploads/direct", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "resources-upload:"+user.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var input service.BrowserResourceUploadInput
		if err := c.ShouldBindJSON(&input); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.BeginBrowserResourceUpload(user.ID, input)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, result)
	})
	r.POST("/resources/uploads/direct/:id/complete", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		resource, err := svc.CompleteBrowserResourceUpload(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resource": resource})
	})
	r.DELETE("/resources/uploads/direct/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.CancelBrowserResourceUpload(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	r.POST("/resources/:id/thumbnail", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "resources-upload:"+user.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, (1<<20)+(64<<10))
		file, err := c.FormFile("file")
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		input, err := file.Open()
		if err != nil {
			failService(c, err)
			return
		}
		defer input.Close()
		data, err := io.ReadAll(io.LimitReader(input, (1<<20)+1))
		if err != nil {
			failService(c, err)
			return
		}
		resource, err := svc.SaveBrowserResourceThumbnail(user.ID, c.Param("id"), data)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resource": resource, "delivery": "server", "reason": "bounded_thumbnail_upload"})
	})
	r.GET("/resources/:id/browser-file", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "resources-browser-read:"+user.ID, policy.Request.ResourceImportPerMinute, time.Minute) {
			return
		}
		delivery, err := svc.PrepareBrowserResourceFallback(user.ID, c.Param("id"), c.Query("reason"), assets.ResourceVariant(c.Query("variant")), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("X-Canvas-Resource-Fallback", "browser_cors_or_network")
		c.Header("Content-Security-Policy", "sandbox")
		serveResourceDelivery(c, delivery, "private, no-store", "attachment")
	})
}
