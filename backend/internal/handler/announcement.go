package handler

import (
	"net/http"
	"strconv"

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
