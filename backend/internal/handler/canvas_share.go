package handler

import (
	"errors"
	"io"
	"net/http"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterCanvasShareRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/canvas-projects/:id/share", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		share, err := svc.CanvasShareStatus(user.ID, c.Param("id"))
		if err != nil {
			fail(c, http.StatusNotFound, errors.New("画布不存在"))
			return
		}
		ok(c, gin.H{"share": share})
	})

	r.POST("/canvas-projects/:id/share", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req service.CanvasShareRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		share, err := svc.CreateCanvasShare(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"share": share})
	})

	r.DELETE("/canvas-projects/:id/share", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteCanvasShare(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})

	r.GET("/public/canvas-shares/:token", func(c *gin.Context) {
		if !enforceRateLimit(c, "public-canvas:"+c.ClientIP(), 120, time.Minute) {
			return
		}
		share, err := svc.PublicCanvasShare(c.Param("token"))
		if err != nil {
			fail(c, http.StatusNotFound, errors.New("分享链接无效或已失效"))
			return
		}
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("X-Robots-Tag", "noindex, nofollow")
		ok(c, share)
	})

	r.GET("/public/canvas-shares/:token/resources/:resourceId/file", func(c *gin.Context) {
		if !enforceRateLimit(c, "public-canvas-resource:"+c.ClientIP(), 300, time.Minute) {
			return
		}
		stream, err := svc.OpenSharedCanvasResourceRange(c.Param("token"), c.Param("resourceId"), c.GetHeader("Range"))
		if err != nil {
			fail(c, http.StatusNotFound, errors.New("分享资源不存在"))
			return
		}
		defer stream.Body.Close()
		resource := stream.Resource
		mimeType := resource.MimeType
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		headers := map[string]string{
			"Cache-Control":           "no-store",
			"Content-Security-Policy": "sandbox",
			"Referrer-Policy":         "no-referrer",
			"X-Content-Type-Options":  "nosniff",
			"X-Robots-Tag":            "noindex, nofollow",
			"Accept-Ranges":           "bytes",
		}
		for key, value := range headers {
			c.Header(key, value)
		}
		if resource.Provider == "local" {
			if seeker, ok := stream.Body.(io.ReadSeeker); ok {
				c.Header("Content-Type", mimeType)
				http.ServeContent(c.Writer, c.Request, resource.ID, resource.UpdatedAt, seeker)
				return
			}
		}
		if stream.ContentRange != "" {
			c.Header("Content-Range", stream.ContentRange)
		}
		c.DataFromReader(stream.StatusCode, stream.ContentLength, mimeType, stream.Body, nil)
	})
}
