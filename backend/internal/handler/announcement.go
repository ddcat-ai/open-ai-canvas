package handler

import (
	"net/http"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAnnouncementRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/banner-announcements", func(c *gin.Context) {
		banners, err := svc.ActiveBannerAnnouncements()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"banners": banners})
	})
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
		delivery, err := svc.PrepareAnnouncementImageDelivery(user, c.Param("id"), resourceAccessOptions(c), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		serveResourceDelivery(c, delivery, "private, no-cache", "")
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
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
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

	r.GET("/admin/banner-announcements", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		banners, err := svc.AdminBannerAnnouncementPage(user, service.AdminListQuery{
			Keyword: c.Query("keyword"),
			Status:  c.Query("status"),
			Page:    page,
			Limit:   limit,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, banners)
	})

	r.POST("/admin/banner-announcements", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.CreateBannerAnnouncementRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		banner, err := svc.CreateBannerAnnouncement(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"banner": banner})
	})

	r.PUT("/admin/banner-announcements/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.UpdateBannerAnnouncementRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		banner, err := svc.UpdateBannerAnnouncement(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"banner": banner})
	})

	r.DELETE("/admin/banner-announcements/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteBannerAnnouncement(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
}
