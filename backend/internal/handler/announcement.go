package handler

import (
	"net/http"
	"strconv"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAnnouncementRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/announcements", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		feed, err := svc.UserAnnouncements(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, feed)
	})
	r.GET("/announcements/:id/image", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		stream, err := svc.OpenAnnouncementImage(user, c.Param("id"), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		defer stream.Body.Close()
		mimeType := stream.Resource.MimeType
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		c.Header("Cache-Control", "private, max-age=3600")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("Accept-Ranges", stream.AcceptRanges)
		c.Header("X-Content-Type-Options", "nosniff")
		if stream.ContentRange != "" {
			c.Header("Content-Range", stream.ContentRange)
		}
		c.DataFromReader(stream.StatusCode, stream.ContentLength, mimeType, stream.Body, nil)
	})

	r.POST("/announcements/read", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			AnnouncementIDs []string `json:"announcementIds"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		unreadCount, err := svc.MarkAnnouncementsRead(user, req.AnnouncementIDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"unreadCount": unreadCount})
	})

	r.GET("/admin/announcements", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		announcements, err := svc.AdminAnnouncementPage(user, service.AdminListQuery{Keyword: c.Query("keyword"), Status: c.Query("status"), Page: page, Limit: limit})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, announcements)
	})

	r.POST("/admin/announcements", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.CreateAnnouncementRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		announcement, err := svc.CreateAnnouncement(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"announcement": announcement})
	})

	r.POST("/admin/announcement-images", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "admin-announcement-image-upload:"+user.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.AnnouncementImageMaxBytes+(1<<20))
		file, err := c.FormFile("file")
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		resource, err := svc.UploadAnnouncementImage(user, file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resource": resource})
	})

	r.DELETE("/admin/announcement-images/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DiscardAnnouncementImage(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})

	r.PATCH("/admin/announcements/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.UpdateAnnouncementRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		announcement, err := svc.UpdateAnnouncement(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"announcement": announcement})
	})

	r.POST("/admin/announcements/:id/close", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		announcement, err := svc.CloseAnnouncement(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"announcement": announcement})
	})
}
