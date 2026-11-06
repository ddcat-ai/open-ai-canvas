package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerEmailRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/email-logs", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		query := service.EmailLogQuery{Keyword: c.Query("keyword"), Purpose: c.Query("purpose"), Status: c.Query("status"), From: c.Query("from"), To: c.Query("to")}
		result, err := svc.AdminEmailLogs(actor, query, page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/settings/email/test", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			Recipient string `json:"recipient"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if !enforceRateLimit(c, "email-test:"+actor.ID, 10, 10*time.Minute) {
			return
		}
		if err := svc.SendTestEmail(actor, req.Recipient); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"sent": true})
	})
	r.GET("/auth/notification-settings", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.UserNotificationSettings(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"settings": result})
	})
	r.PUT("/auth/notification-settings", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			ConsumptionReportEnabled *bool `json:"consumptionReportEnabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.ConsumptionReportEnabled == nil {
			failService(c, service.BadAuthRequest("请提供 consumptionReportEnabled"))
			return
		}
		result, err := svc.UpdateUserNotificationSettings(actor, *req.ConsumptionReportEnabled)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"settings": result})
	})
}
