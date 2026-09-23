package handler

import (
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"
	"net/http"
	"time"
)

func registerNotificationRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/auth/verification", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.VerificationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, 400, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "verification-send:"+c.ClientIP(), policy.Request.EmailCodePerHour, time.Hour) {
			return
		}
		var actor *model.User
		if req.Purpose == "bind" {
			var err error
			actor, err = currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			if !enforceRateLimit(c, "verification-bind:"+actor.ID, 10, time.Hour) {
				return
			}
		}
		result, err := svc.StartVerification(c.Request.Context(), actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/auth/verification/login", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.VerificationConfirm
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, 400, err)
			return
		}
		if !enforceRateLimit(c, "verification-login:"+c.ClientIP(), 30, time.Hour) {
			return
		}
		result, err := svc.LoginVerification(req)
		if err != nil {
			failService(c, err)
			return
		}
		setSessionCookie(c, result.Session, result.MaxAgeSecs)
		ok(c, gin.H{"user": result.User})
	})
	r.POST("/auth/verification/bind", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.VerificationConfirm
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, 400, err)
			return
		}
		if !enforceRateLimit(c, "verification-bind-confirm:"+actor.ID, 30, time.Hour) {
			return
		}
		result, err := svc.BindVerification(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"user": result})
	})
	admin := r.Group("/admin")
	admin.Use(func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err == nil {
			err = svc.RequireAdmin(actor)
		}
		if err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Set("notificationActor", actor)
		c.Next()
	})
	actor := func(c *gin.Context) *model.User { return c.MustGet("notificationActor").(*model.User) }
	admin.GET("/settings/auth-policy", func(c *gin.Context) {
		result, err := svc.AdminVerificationPolicy(actor(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	admin.PUT("/settings/auth-policy", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.VerificationPolicy
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, 400, err)
			return
		}
		result, err := svc.UpdateVerificationPolicy(actor(c), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	admin.GET("/sms/channels", func(c *gin.Context) {
		result, err := svc.AdminSMSChannels(actor(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	save := func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req service.SMSChannelRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, 400, err)
			return
		}
		result, err := svc.SaveSMSChannel(actor(c), c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
	admin.POST("/sms/channels", save)
	admin.PUT("/sms/channels/:id", save)
	admin.DELETE("/sms/channels/:id", func(c *gin.Context) {
		if err := svc.DeleteSMSChannel(actor(c), c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})
	admin.POST("/sms/channels/:id/test", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var req struct {
			Phone   string `json:"phone"`
			Purpose string `json:"purpose"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, 400, err)
			return
		}
		if !enforceRateLimit(c, "sms-test:"+actor(c).ID, 5, time.Hour) {
			return
		}
		result, err := svc.TestSMSChannel(actor(c), c.Request.Context(), c.Param("id"), req.Purpose, req.Phone)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	admin.GET("/sms/records", func(c *gin.Context) {
		page, size, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, 400, err)
			return
		}
		result, err := svc.AdminSMSRecords(actor(c), c.Query("channelId"), c.Query("state"), page, size)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}
